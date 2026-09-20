/**
 * test/test_hard_rules_engine.js
 * 
 * [Gap 3 验证] 8 大实战硬规则集策略引擎单测
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateHardRules,
  HardRuleId,
  RuleVerdict
} from '../tools/trade/hard_rules_engine.js';
import { TacticalState } from '../tools/trade/position_lifecycle_manager.js';

describe('Gap 3: 8 大实战硬规则集策略引擎单测 (Audited Hard Rules)', () => {

  it('RULE-006: 期权代码必须硬阻断 (Phase 0 物理门禁)', () => {
    const res = evaluateHardRules({
      ticker: 'TSLA260918C00250000',
      side: 'BUY',
      price: 15.0,
      quantity: 1
    });

    assert.equal(res.passed, false);
    assert.equal(res.verdict, RuleVerdict.REJECT);
    assert.ok(res.rejectReasons.some(r => r.includes('RULE-006')));
  });

  it('RULE-007: 卖单底仓为 0 必须硬阻断 (前面开仓未跟入)', () => {
    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'SELL',
      price: 390.0,
      quantity: 2,
      currentPosition: null // 无底仓
    });

    assert.equal(res.passed, false);
    assert.equal(res.verdict, RuleVerdict.REJECT);
    assert.ok(res.rejectReasons.some(r => r.includes('RULE-007')));
  });

  it('RULE-007: 卖单数量超出底仓触发 WARN 与数量裁剪提示', () => {
    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'SELL',
      price: 390.0,
      quantity: 10,
      currentPosition: { quantity: 4 } // 底仓仅 4 股
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-007')));
  });

  it('RULE-001: 早盘前60分钟跳空急拉追高触发 WARN 警示', () => {
    const res = evaluateHardRules({
      ticker: 'NVDA',
      side: 'BUY',
      price: 120.0,
      quantity: 5,
      dayChangePercent: 4.5, // 涨超 3%
      marketSession: { et: { timeNum: 945 } } // 09:45 ET 早盘
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-001')));
  });

  it('RULE-002: 尾盘三点到四点高位大涨追高触发 WARN 警示', () => {
    const res = evaluateHardRules({
      ticker: 'TSLL',
      side: 'BUY',
      price: 15.0,
      quantity: 10,
      dayChangePercent: 6.0,
      marketSession: { isPowerHour: true, et: { timeNum: 1530 } }
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-002')));
  });

  it('RULE-003: 持仓脉冲急拉浮盈 >= 5% 触发 TAC-002 半仓止盈建议', () => {
    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'HOLD',
      price: 212.0,
      quantity: 10,
      currentPosition: { quantity: 10, average_entry_price: 200.0 }, // 浮盈 +6%
      positionLifecycle: { state: TacticalState.INITIAL_PROBE }
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-003')));
  });

  it('RULE-004: 做T加回回调差价不足 2% 触发低吸空间狭窄警告', () => {
    const res = evaluateHardRules({
      ticker: 'WDC',
      side: 'BUY',
      price: 430.0,
      quantity: 5,
      positionLifecycle: {
        state: TacticalState.T_GAP_ACTIVE,
        lastSellPrice: 433.0 // 433 -> 430 回撤仅 0.69% < 2%
      }
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-004')));
  });

  it('RULE-005: 跌破保本损触发平仓保本警告', () => {
    const res = evaluateHardRules({
      ticker: 'COHR',
      side: 'HOLD',
      price: 98.0,
      quantity: 5,
      currentPosition: { quantity: 5, average_entry_price: 100.0 }, // 成本 100，现价 98
      positionLifecycle: { state: TacticalState.HALF_LOCKED } // 已经出过半仓
    });

    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.ok(res.warnings.some(w => w.includes('RULE-005')));
  });

  it('RULE-008: 【用户核心定案验证】周哥量化或GEX分歧严禁代码硬拦截，但必须出 WARN 提示人工裁决', () => {
    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'BUY',
      price: 220.0,
      quantity: 2,
      quantReference: {
        zhouSignal: 'BEARISH',               // 周哥空头
        gexRegime: 'PUT_WALL_BROKEN'         // GEX 破位
      }
    });

    // 必须允许通过 (passed: true)，不能越权阻断！
    assert.equal(res.passed, true);
    assert.equal(res.verdict, RuleVerdict.WARN);
    assert.equal(res.rejectReasons.length, 0); // 绝对无 reject

    // 但必须在 warnings 中清晰列出参谋预警
    assert.ok(res.warnings.some(w => w.includes('周哥')));
    assert.ok(res.warnings.some(w => w.includes('GEX')));
  });

  it('微观转弯 A: 检测异动直线拉升见顶回落 (Spike & Turn Down)', () => {
    // 模拟 K 线: 100 -> 101 -> 106 (直线急拉 +6%) -> 104.8 (高位回落 -1.13% 向下转弯)
    const mockBars = [
      { open: 100.0, high: 101.0, low: 99.5, close: 100.5 },
      { open: 100.5, high: 103.0, low: 100.2, close: 102.8 },
      { open: 102.8, high: 106.0, low: 102.5, close: 105.8 }, // 见顶
      { open: 105.8, high: 105.9, low: 104.5, close: 104.8 }  // 回撤 1.13% 转弯
    ];

    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'SELL',
      price: 104.8,
      quantity: 5,
      currentPosition: { quantity: 10 },
      recentBars: mockBars
    });

    assert.equal(res.passed, true);
    assert.ok(res.turningPoint);
    assert.equal(res.turningPoint.detected, true);
    assert.equal(res.turningPoint.isSpike, true);
    assert.equal(res.turningPoint.isTurnDown, true);
    assert.ok(res.turningPoint.description.includes('向下转弯确认'));
  });

  it('微观转弯 B: 检测急跌跳水探底企稳拉起 (Plunge & Turn Up)', () => {
    // 模拟 K 线: 100 -> 98 -> 96 (急跌 -4%) -> 97.2 (低点止跌拉起 +1.25% 向上转弯)
    const mockBars = [
      { open: 100.0, high: 100.2, low: 98.5, close: 98.8 },
      { open: 98.8, high: 99.0, low: 96.5, close: 96.8 },
      { open: 96.8, high: 97.0, low: 96.0, close: 96.2 }, // 探底 96.0
      { open: 96.2, high: 97.5, low: 96.1, close: 97.2 }  // 低位反弹 +1.25% 拐头向上
    ];

    const res = evaluateHardRules({
      ticker: 'TSLA',
      side: 'BUY',
      price: 97.2,
      quantity: 5,
      recentBars: mockBars
    });

    assert.equal(res.passed, true);
    assert.ok(res.turningPoint);
    assert.equal(res.turningPoint.detected, true);
    assert.equal(res.turningPoint.isPlunge, true);
    assert.equal(res.turningPoint.isTurnUp, true);
    assert.ok(res.turningPoint.description.includes('向上转弯确认'));
  });
});
