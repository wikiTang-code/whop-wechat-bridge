/**
 * test/test_signal_intent_bridge.js
 * 
 * 赵哥喊单/交易单转化为待确认 TradeIntent 桥接器与底仓拦截单测
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables } from '../database.js';
import {
  convertSignalToTradeIntent,
  ZHAO_SENDER_ID,
  ALLOWED_CHANNELS
} from '../tools/trade/signal_intent_bridge.js';

describe('赵哥喊单 -> TradeIntent 桥接与底仓核验硬门禁单测', () => {
  let testDb;

  beforeEach(() => {
    testDb = new Database(':memory:');
    ensurePaperTradingTables(testDb);
  });

  it('门禁 1: 正常买单生成待确认 Intent (PENDING_HITL)', () => {
    const res = convertSignalToTradeIntent({
      signal_id: 'sig_001',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'TSLA',
      action: 'BUY',
      price: 220.0,
      quantity: 5,
      reason: '回踩买入'
    }, { dbInstance: testDb });

    assert.equal(res.success, true);
    assert.ok(res.intent);
    assert.equal(res.intent.status, 'PENDING_HITL');
    assert.equal(res.intent.ticker, 'TSLA');
    assert.equal(res.intent.side, 'BUY');
    assert.equal(res.intent.quantity, 5);
    assert.equal(res.intent.price_limit, 220.0);
  });

  it('门禁 2: 非赵哥发言绝对硬拦截 (红线 9)', () => {
    const res = convertSignalToTradeIntent({
      signal_id: 'sig_002',
      speaker_id: 'user_stranger_123',
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'TSLA',
      action: 'BUY',
      price: 220.0
    }, { dbInstance: testDb });

    assert.equal(res.success, false);
    assert.ok(res.reason.includes('SECURITY_REJECT_INVALID_SENDER'));
    assert.equal(res.intent, null);
  });

  it('门禁 3: 非专属交易频道硬拦截 (红线 10)', () => {
    const res = convertSignalToTradeIntent({
      signal_id: 'sig_003',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: 'chat_feed_random_chat_area',
      ticker: 'TSLA',
      action: 'BUY',
      price: 220.0
    }, { dbInstance: testDb });

    assert.equal(res.success, false);
    assert.ok(res.reason.includes('SECURITY_REJECT_INVALID_CHANNEL'));
  });

  it('门禁 4: 卖单无底仓硬核拦截 (前面开仓没跟，卖单不可执行)', () => {
    // 此时数据库中无任何持仓
    const res = convertSignalToTradeIntent({
      signal_id: 'sig_004',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'TSLA',
      action: 'SELL',
      price: 240.0,
      quantity: 10,
      reason: '平仓止盈'
    }, { dbInstance: testDb });

    assert.equal(res.success, false);
    assert.ok(res.reason.includes('REJECTED_NO_UNDERLYING_POSITION'));
    assert.equal(res.intent, null);
  });

  it('门禁 5: 卖单有底仓正常生成待确认 Intent', () => {
    // 预置 10 股 TSLA 底仓
    testDb.prepare(`
      INSERT INTO broker_paper_positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl, updated_at)
      VALUES ('TSLA', 10, 220.0, 240.0, 2400.0, 200.0, ?)
    `).run(Date.now());

    const res = convertSignalToTradeIntent({
      signal_id: 'sig_005',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'TSLA',
      action: 'SELL',
      price: 240.0,
      quantity: 5,
      reason: '半仓止盈'
    }, { dbInstance: testDb });

    assert.equal(res.success, true);
    assert.ok(res.intent);
    assert.equal(res.intent.status, 'PENDING_HITL');
    assert.equal(res.intent.side, 'SELL');
    assert.equal(res.intent.quantity, 5);
  });

  it('门禁 6: 卖单超额底仓自动裁剪至现有底仓量', () => {
    // 预置 4 股 TSLA 底仓
    testDb.prepare(`
      INSERT INTO broker_paper_positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl, updated_at)
      VALUES ('TSLA', 4, 220.0, 240.0, 960.0, 80.0, ?)
    `).run(Date.now());

    const res = convertSignalToTradeIntent({
      signal_id: 'sig_006',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'TSLA',
      action: 'SELL',
      price: 240.0,
      quantity: 10 // 企图卖 10 股
    }, { dbInstance: testDb });

    assert.equal(res.success, true);
    assert.equal(res.intent.quantity, 4); // 自动截断为 4 股
  });
});
