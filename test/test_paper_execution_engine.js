import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ensurePaperTradingTables,
  saveTradeIntent,
  getTradeIntent,
  updateTradeIntent,
  listTradeIntents,
  savePaperPositions,
  getPaperPositions
} from '../database.js';
import {
  createTradeIntent,
  confirmAndSubmitIntent,
  cancelTradeIntent,
  getPaperIntentSummary,
  AUTO_SUBMIT_ENABLED
} from '../tools/trade/paper_execution_engine.js';
import { assertPaperMode } from '../brokers/longbridge.js';

describe('REQ-056: 长桥模拟盘 (Paper Trading) 执行闭环与 TradeIntent 最小执行状态机单测', () => {
  let testDb;

  beforeEach(() => {
    testDb = new Database(':memory:');
    ensurePaperTradingTables(testDb);
  });

  describe('1. 核心安全门禁与环境断言', () => {
    it('门禁 1: auto_submit 必须硬锁定为 false (严禁全自动报送)', () => {
      assert.equal(AUTO_SUBMIT_ENABLED, false, 'AUTO_SUBMIT_ENABLED 必须为 false');
    });

    it('门禁 2: BROKER_MODE 非 paper 时必须抛出安全拦截异常', () => {
      const prev = process.env.BROKER_MODE;
      try {
        process.env.BROKER_MODE = 'real';
        assert.throws(() => {
          assertPaperMode();
        }, /安全阻断/);

        delete process.env.BROKER_MODE;
        assert.throws(() => {
          assertPaperMode();
        }, /安全阻断/);
      } finally {
        process.env.BROKER_MODE = prev;
      }
    });

    it('门禁 3: BROKER_MODE 为 paper 时断言通过', () => {
      const prev = process.env.BROKER_MODE;
      try {
        process.env.BROKER_MODE = 'paper';
        assert.doesNotThrow(() => {
          assertPaperMode();
        });
      } finally {
        process.env.BROKER_MODE = prev;
      }
    });
  });

  describe('2. TradeIntent 生成与因果价格校验 (先薄后厚契约)', () => {
    it('正常生成意图，初始状态必须为 PENDING_HITL', () => {
      const intent = createTradeIntent({
        ticker: 'tsla',
        side: 'buy',
        quantity: 10,
        price_limit: 225.50,
        source: 'test_radar',
        evidence: [{ note: '回踩支撑位' }]
      }, { dbInstance: testDb });

      assert.ok(intent.intent_id.startsWith('intent_'));
      assert.equal(intent.ticker, 'TSLA');
      assert.equal(intent.side, 'BUY');
      assert.equal(intent.quantity, 10);
      assert.equal(intent.price_limit, 225.50);
      assert.equal(intent.status, 'PENDING_HITL');
      assert.ok(intent.expires_at);

      // 持久化检查
      const saved = getTradeIntent(intent.intent_id, testDb);
      assert.equal(saved.intent_id, intent.intent_id);
      assert.equal(saved.status, 'PENDING_HITL');
      assert.equal(saved.evidence[0].note, '回踩支撑位');
    });

    it('因果真实性: 无有效盘口限价 (<=0 或 NaN) 必须直接判定为 REJECTED', () => {
      const intent = createTradeIntent({
        ticker: 'NVDA',
        side: 'BUY',
        quantity: 5,
        price_limit: 0 // 价格缺失
      }, { dbInstance: testDb });

      assert.equal(intent.status, 'REJECTED');
      assert.equal(intent.reject_reason, 'NO_VALID_PRICE');

      const saved = getTradeIntent(intent.intent_id, testDb);
      assert.equal(saved.status, 'REJECTED');
      assert.equal(saved.reject_reason, 'NO_VALID_PRICE');
    });

    it('输入参数缺失校验', () => {
      assert.throws(() => {
        createTradeIntent({ ticker: '', side: 'BUY', quantity: 1, price_limit: 100 }, { dbInstance: testDb });
      }, /标的代码不能为空/);

      assert.throws(() => {
        createTradeIntent({ ticker: 'TSLA', side: 'HOLD', quantity: 1, price_limit: 100 }, { dbInstance: testDb });
      }, /无效买卖方向/);

      assert.throws(() => {
        createTradeIntent({ ticker: 'TSLA', side: 'BUY', quantity: 0, price_limit: 100 }, { dbInstance: testDb });
      }, /无效数量/);
    });
  });

  describe('3. HITL 模拟柜台流转与状态机闭环 (Mock 柜台)', () => {
    it('流转路径 A: 人工确认 -> 报送柜台 -> 撮合成交 (FILLED) -> 持仓第一真源刷新', async () => {
      const intent = createTradeIntent({
        ticker: 'TSLL',
        side: 'BUY',
        quantity: 20,
        price_limit: 12.80
      }, { dbInstance: testDb });

      let syncPositionsCalled = false;
      const mockBroker = {
        assertPaperMode: () => {},
        placeOrder: async ({ ticker, action, quantity, price }) => {
          assert.equal(ticker, 'TSLL');
          assert.equal(action, 'BUY');
          assert.equal(quantity, 20);
          assert.equal(price, 12.80);
          return { success: true, orderId: 'mock_order_123', status: 'SUBMITTED' };
        },
        pollOrderStatus: async (orderId) => {
          assert.equal(orderId, 'mock_order_123');
          return { status: 'FILLED', order: { order_id: orderId, status: 'Filled' } };
        },
        syncPaperPositions: async () => {
          syncPositionsCalled = true;
          savePaperPositions([{
            ticker: 'TSLL',
            quantity: 20,
            average_entry_price: 12.80,
            current_price: 12.85,
            market_value: 257.0,
            unrealized_pnl: 1.0
          }], testDb);
        }
      };

      const res = await confirmAndSubmitIntent(intent.intent_id, {
        broker: mockBroker,
        dbInstance: testDb,
        awaitFinalStatus: true,
        timeoutMs: 5000
      });

      assert.equal(res.success, true);
      assert.equal(res.intent.status, 'FILLED');
      assert.equal(res.intent.broker_order_id, 'mock_order_123');
      assert.equal(syncPositionsCalled, true);

      // 验证第一持仓真源 (broker_paper_positions) 已持久化
      const positions = getPaperPositions(testDb);
      assert.equal(positions.length, 1);
      assert.equal(positions[0].ticker, 'TSLL');
      assert.equal(positions[0].quantity, 20);
      assert.equal(positions[0].average_entry_price, 12.80);
    });

    it('流转路径 B: 人工确认 -> 报送柜台 -> 撮合超时 -> 自动撤单 (CANCELLED)', async () => {
      const intent = createTradeIntent({
        ticker: 'CONL',
        side: 'BUY',
        quantity: 10,
        price_limit: 45.00
      }, { dbInstance: testDb });

      let cancelOrderCalled = false;
      const mockBroker = {
        assertPaperMode: () => {},
        placeOrder: async () => ({ success: true, orderId: 'mock_timeout_999' }),
        pollOrderStatus: async () => ({ status: 'TIMEOUT', order: null }),
        cancelOrder: async (orderId) => {
          assert.equal(orderId, 'mock_timeout_999');
          cancelOrderCalled = true;
          return { success: true, orderId };
        }
      };

      const res = await confirmAndSubmitIntent(intent.intent_id, {
        broker: mockBroker,
        dbInstance: testDb,
        awaitFinalStatus: true,
        timeoutMs: 1000
      });

      assert.equal(res.success, true);
      assert.equal(res.intent.status, 'CANCELLED');
      assert.equal(res.intent.reject_reason, 'ORDER_TIMEOUT_AUTO_CANCELLED');
      assert.equal(cancelOrderCalled, true);
    });

    it('流转路径 C: 待确认阶段人工主动放弃 (REJECTED)', async () => {
      const intent = createTradeIntent({
        ticker: 'SPY',
        side: 'BUY',
        quantity: 5,
        price_limit: 580.0
      }, { dbInstance: testDb });

      const res = await cancelTradeIntent(intent.intent_id, 'USER_CLICK_SKIP', { dbInstance: testDb });
      assert.equal(res.success, true);
      assert.equal(res.intent.status, 'REJECTED');
      assert.equal(res.intent.reject_reason, 'USER_CLICK_SKIP');
    });

    it('流转路径 D: 超过 expires_at 未确认，提交时自动拒绝', async () => {
      const intent = createTradeIntent({
        ticker: 'QQQ',
        side: 'BUY',
        quantity: 10,
        price_limit: 490.0,
        expires_in_sec: -10 // 已经过期
      }, { dbInstance: testDb });

      const res = await confirmAndSubmitIntent(intent.intent_id, { dbInstance: testDb });
      assert.equal(res.success, false);
      assert.equal(res.reason, 'EXPIRED_BEFORE_HITL');
      assert.equal(res.intent.status, 'REJECTED');
    });
  });

  describe('4. 模拟盘统计与意图列表查询', () => {
    it('正确生成统计摘要', () => {
      createTradeIntent({ ticker: 'TSLA', side: 'BUY', quantity: 1, price_limit: 220 }, { dbInstance: testDb });
      createTradeIntent({ ticker: 'NVDA', side: 'BUY', quantity: 2, price_limit: 0 }, { dbInstance: testDb }); // REJECTED

      const summary = getPaperIntentSummary(testDb);
      assert.equal(summary.total, 2);
      assert.equal(summary.pending_hitl, 1);
      assert.equal(summary.rejected, 1);
      assert.equal(summary.recent_intents.length, 2);
    });
  });
});
