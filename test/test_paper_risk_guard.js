import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables } from '../database.js';
import { evaluatePreTradeRisk, RISK_CONFIG } from '../tools/trade/paper_risk_guard.js';

describe('REQ-056: 模拟盘事前硬风控引擎单测 (Pre-Trade Risk Guard)', () => {
  let testDb;

  beforeEach(() => {
    testDb = new Database(':memory:');
    ensurePaperTradingTables(testDb);
  });

  it('风控规则 1: 正常正股意图，金额合规，必须 PASS', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'BUY',
      quantity: 10,
      price_limit: 220.0
    }, { dbInstance: testDb });

    assert.equal(res.passed, true);
    assert.equal(res.reject_reason, null);
    assert.equal(res.details.notional, 2200.0);
  });

  it('风控规则 2: 单笔名义金额超额 (> $5,000) 必须硬阻断', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'BUY',
      quantity: 50,
      price_limit: 220.0 // 50 * 220 = $11,000 > $5,000
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_EXCEED_MAX_NOTIONAL'));
  });

  it('风控规则 3: 严禁期权代码进入 Phase 0 自动流转 (硬门禁)', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'TSLA260918C00250000',
      side: 'BUY',
      quantity: 1,
      price_limit: 15.0
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_DISALLOWED_ASSET_TYPE'));
  });

  it('风控规则 4: 价格偏离度超过 10% 必须硬阻断 (防手抖与滑点穿仓)', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price_limit: 130.0,
      reference_price: 110.0 // 偏离 (130-110)/110 = 18.1% > 10%
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_PRICE_DEVIATION_TOO_LARGE'));
  });

  it('风控规则 5: 非法价格 (0 或负数) 必须拦截', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'SPY',
      side: 'BUY',
      quantity: 1,
      price_limit: 0
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_INVALID_PRICE'));
  });

  it('风控规则 6: 卖单无底仓必须硬阻断 (前面开仓未跟则平仓不可执行)', () => {
    const res = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'SELL',
      quantity: 5,
      price_limit: 390.0
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_NO_UNDERLYING_POSITION'));
  });

  it('风控规则 7: 卖单超出可用底仓必须硬阻断', () => {
    // 预置 2 股 TSLA 底仓
    testDb.prepare(`
      INSERT INTO broker_paper_positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl, updated_at)
      VALUES ('TSLA', 2, 380.0, 390.0, 780.0, 20.0, ?)
    `).run(Date.now());

    const res = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'SELL',
      quantity: 5, // 卖 5 股 > 2 股底仓
      price_limit: 390.0
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_INSUFFICIENT_POSITION'));

    // 卖 2 股则应该允许通过
    const passRes = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'SELL',
      quantity: 2,
      price_limit: 390.0
    }, { dbInstance: testDb });
    assert.equal(passRes.passed, true);
  });

  it('风控规则 8: 账户日内浮亏触及最大熔断门槛必须阻断新开仓', () => {
    // 预置严重浮亏持仓 (-$1,200 < -$1,000)
    testDb.prepare(`
      INSERT INTO broker_paper_positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl, updated_at)
      VALUES ('NVDA', 50, 140.0, 116.0, 5800.0, -1200.0, ?)
    `).run(Date.now());

    const res = evaluatePreTradeRisk({
      ticker: 'TSLA',
      side: 'BUY',
      quantity: 2,
      price_limit: 390.0
    }, { dbInstance: testDb });

    assert.equal(res.passed, false);
    assert.ok(res.reject_reason.includes('RISK_ACCOUNT_CIRCUIT_BREAKER_TRIGGERED'));
  });
});
