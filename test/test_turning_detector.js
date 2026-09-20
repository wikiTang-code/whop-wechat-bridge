/**
 * test/test_turning_detector.js
 * 
 * [turning_v1] 独立微观转弯形态特征检测器单测
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSpikeTurnDown,
  detectPlungeTurnUp,
  createTurningEvent,
  TurningEventType,
  TurningSourceType,
  TURNING_DETECTOR_VERSION
} from '../tools/trade/turning_detector.js';

describe('微观形态特征引擎单测 (turning_v1 Feature Detector)', () => {

  describe('1. TurningEvent Schema 规范性测试', () => {
    it('正确生成符合规范的结构化 TurningEvent 对象', () => {
      const event = createTurningEvent({
        type: TurningEventType.SPIKE_TURN_DOWN,
        symbol: 'tsla',
        tAnchor: 1789900000000,
        pathWindow: [1789899000000, 1789900000000],
        impulse: { ret: 0.058, duration_bars: 4, extreme_price: 220.0 },
        confirm: { retrace_from_extreme: 0.012, bars_after_extreme: 2, structure: 'lower_high', is_confirmed: true },
        indexContext: { qqq_ret: 0.003, qqq_turn_lag_minutes: 5 },
        source: TurningSourceType.AUDITED_FILL,
        evidenceNotes: ['冲高 5.8% 后回撤 1.2%']
      });

      assert.equal(event.version, TURNING_DETECTOR_VERSION);
      assert.equal(event.type, 'spike_turn_down');
      assert.equal(event.symbol, 'TSLA');
      assert.equal(event.impulse.ret, 0.058);
      assert.equal(event.confirm.retrace_from_extreme, 0.012);
      assert.equal(event.confirm.is_confirmed, true);
      assert.equal(event.index_context.qqq_ret, 0.003);
      assert.equal(event.source, 'audited_fill');
      assert.ok(event.created_at > 0);
    });
  });

  describe('2. 异动直线后见顶转弯回落 (Spike -> Turn Down)', () => {
    it('冲动段达标 (+6%) 且回撤达标 (-1.13%) 触发转弯特征事件', () => {
      const bars = [
        { open: 100.0, high: 101.0, low: 99.5, close: 100.5, time: 1000 },
        { open: 100.5, high: 103.0, low: 100.2, close: 102.8, time: 2000 },
        { open: 102.8, high: 106.0, low: 102.5, close: 105.8, time: 3000 }, // 冲高 +6%
        { open: 105.8, high: 105.9, low: 104.5, close: 104.8, time: 4000 }  // 自高点回撤 1.13%
      ];
      const qqqBars = [
        { open: 490.0, close: 491.0 },
        { open: 491.0, close: 492.0 }
      ];

      const res = detectSpikeTurnDown(bars, {
        symbol: 'TSLA',
        minSpikeRatio: 0.035,
        minRetraceRatio: 0.008,
        indexBars: qqqBars
      });

      assert.equal(res.detected, true);
      assert.ok(res.event);
      assert.equal(res.event.type, TurningEventType.SPIKE_TURN_DOWN);
      assert.equal(res.event.impulse.extreme_price, 106.0);
      assert.ok(res.event.confirm.retrace_from_extreme >= 0.01);
      assert.ok(res.event.index_context.qqq_ret !== null);
    });

    it('回撤不足门槛时静默 (防假阳性)', () => {
      const bars = [
        { open: 100.0, high: 101.0, low: 99.5, close: 100.5 },
        { open: 100.5, high: 106.0, low: 100.2, close: 105.9 }, // 仅回撤 0.1%
        { open: 105.9, high: 106.0, low: 105.7, close: 105.8 }
      ];

      const res = detectSpikeTurnDown(bars, {
        minSpikeRatio: 0.035,
        minRetraceRatio: 0.01 // 要求回撤 1%
      });

      assert.equal(res.detected, false);
      assert.equal(res.event, null);
    });
  });

  describe('3. 急跌探底企稳向上转弯 (Plunge -> Turn Up)', () => {
    it('急跌达标 (-4%) 且止跌反抽达标 (+1.25%) 触发向上拐头特征事件', () => {
      const bars = [
        { open: 100.0, high: 100.2, low: 98.5, close: 98.8, time: 1000 },
        { open: 98.8, high: 99.0, low: 96.5, close: 96.8, time: 2000 },
        { open: 96.8, high: 97.0, low: 96.0, close: 96.2, time: 3000 }, // 探底 96.0 (-4%)
        { open: 96.2, high: 97.5, low: 96.1, close: 97.2, time: 4000 }  // 反抽 1.25%
      ];

      const res = detectPlungeTurnUp(bars, {
        symbol: 'NVDA',
        minPlungeRatio: 0.025,
        minReboundRatio: 0.008
      });

      assert.equal(res.detected, true);
      assert.ok(res.event);
      assert.equal(res.event.type, TurningEventType.PLUNGE_TURN_UP);
      assert.equal(res.event.impulse.extreme_price, 96.0);
      assert.ok(res.event.confirm.retrace_from_extreme >= 0.01);
    });
  });
});
