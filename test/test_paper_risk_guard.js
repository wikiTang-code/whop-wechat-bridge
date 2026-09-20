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
});
