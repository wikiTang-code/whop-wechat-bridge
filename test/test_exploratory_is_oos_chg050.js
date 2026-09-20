/**
 * CHG-050: exploratory IS/OOS holdout helpers (synthetic bars, no network/DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  METHOD_LABEL,
  PARAM_GRID,
  assertMillisTimestamps,
  etTradingDate,
  chooseSplitDays,
  splitByTradingDays,
  percentile,
  detectTrades,
  alignZhao,
  summarizeExit,
  scoreIsCandidate,
  selectFrozenParams,
  permutationPrecision,
  maxDrawdown,
  FROZEN_DEFAULTS
} from '../scripts/knowledge/lib/exploratory_is_oos.js';

function bar(t, o, h, l, c, v = 1000) {
  return { time: t, datetime: new Date(t).toISOString(), open: o, high: h, low: l, close: c, volume: v };
}

function sessionBars({ days = 60, barsPerDay = 8, startMs = Date.UTC(2026, 5, 1, 13, 30) }) {
  const out = [];
  let t = startMs;
  let px = 100;
  for (let d = 0; d < days; d++) {
    while (etTradingDate(t) === (out.length ? etTradingDate(out[out.length - 1].time) : null) && d > 0) {
      t += 24 * 3600 * 1000;
    }
    for (let i = 0; i < barsPerDay; i++) {
      const drift = ((d + i) % 17) * 0.02;
      const o = px;
      const c = px + ((i % 3) - 1) * 0.15 + (d % 5 === 0 && i === 3 ? -1.2 : 0.05);
      const h = Math.max(o, c) + 0.2;
      const l = Math.min(o, c) - (d % 5 === 0 && i === 3 ? 1.5 : 0.1);
      const vol = d % 5 === 0 && i === 3 ? 5000 : 800;
      out.push(bar(t, o, h, l, c, vol));
      px = c;
      t += 5 * 60 * 1000;
    }
    t += (24 * 3600 * 1000) - barsPerDay * 5 * 60 * 1000;
  }
  return out;
}

describe('CHG-050 exploratory IS/OOS holdout', () => {
  it('refuses mixed epoch units', () => {
    assert.equal(assertMillisTimestamps([1_780_000_000_000], [1_780_000_000_100]), 'ms');
    assert.throws(() => assertMillisTimestamps([1_780_000_000_000], [1_780_000_000]), /mixed epoch units/);
    assert.throws(() => assertMillisTimestamps([1_780_000_000], [1_780_000_100]), /epoch seconds/);
  });

  it('chooseSplitDays uses 40/20 only when enough sessions exist', () => {
    assert.deepEqual(chooseSplitDays(60), { isDays: 40, oosDays: 20, mode: 'calendar_40_20' });
    assert.equal(chooseSplitDays(7).mode, 'short_window_proportional');
    assert.equal(chooseSplitDays(7).isDays + chooseSplitDays(7).oosDays, 7);
  });

  it('splits by ET trading dates: first 40 / last 20, middle is GAP', () => {
    const bars = sessionBars({ days: 65, barsPerDay: 2 });
    const split = splitByTradingDays(bars, { isDays: 40, oosDays: 20 });
    assert.equal(split.isDaysActual, 40);
    assert.equal(split.oosDaysActual, 20);
    assert.equal(split.gapDaysActual, 5);
    assert.equal(split.classify(bars[0]), 'IN_SAMPLE');
    assert.equal(split.classify(bars[bars.length - 1]), 'OUT_OF_SAMPLE');
  });

  it('percentile is past-window only and independent of current value', () => {
    const xs = [1, 2, 3, 4, 5];
    assert.equal(percentile(xs, 0), 1);
    assert.equal(percentile(xs, 1), 5);
    assert.equal(percentile(xs, 0.5), 3);
  });

  it('band detection uses i-1 ATR/EMA path and next-open fill', () => {
    const bars = sessionBars({ days: 60, barsPerDay: 10 });
    const trades = detectTrades(bars, { atrPctile: 0.8, volMult: 1.2 }, FROZEN_DEFAULTS, { interval: '5m' });
    for (const tr of trades) {
      assert.equal(tr.entryBarIdx, tr.confirmBarIdx + 1);
      assert.equal(tr.entryPrice, bars[tr.entryBarIdx].open * (1 + FROZEN_DEFAULTS.costBpsRoundTrip / 2));
    }
  });

  it('nearest-neighbor alignment: unique recall != hit-count/zhaoCount; last-hit does not overwrite', () => {
    const trades = [
      { entryTime: 1_800_000_000_000, entryDatetime: 'a', sampleType: 'IN_SAMPLE' },
      { entryTime: 1_800_000_600_000, entryDatetime: 'b', sampleType: 'IN_SAMPLE' },
      { entryTime: 1_800_003_600_000, entryDatetime: 'c', sampleType: 'IN_SAMPLE' }
    ];
    const zhao = [
      { signal_id: 'z1', created_at: 1_800_000_120_000 },
      { signal_id: 'z2', created_at: 1_800_009_000_000 }
    ];
    const al = alignZhao(trades, zhao);
    assert.equal(al.events[0].nearestZhaoId, 'z1');
    assert.equal(al.events[1].nearestZhaoId, 'z1');
    assert.equal(al.tp30, 2);
    assert.equal(al.fp30, 1);
    assert.equal(al.fn30, 1);
    assert.equal(al.recallUnique[30], 0.5);
    assert.notEqual(al.recallUnique[30], al.tp30 / zhao.length);
  });

  it('IS grid freeze: OOS does not re-pick params', () => {
    const cands = PARAM_GRID.map((p, idx) => {
      const fake = scoreIsCandidate(
        { n: idx === 4 ? 12 : 12, avgNet: p.atrPctile === 0.8 && p.volMult === 1.2 ? 0.01 : -0.02 },
        { precision: { 30: 0.1 } }
      );
      return { ...p, ...fake };
    });
    const frozen = selectFrozenParams(cands);
    assert.deepEqual(frozen.params, { atrPctile: 0.8, volMult: 1.2 });
    assert.equal(frozen.selection, 'exitA_avgNet_minN8_tie_precision30');
    const oosFrozen = { ...frozen.params };
    assert.deepEqual(oosFrozen, frozen.params);
  });

  it('exit stats include n/wins/losses/avgWin/avgLoss/maxDD and do not treat PF as headline', () => {
    const s = summarizeExit([0.02, 0.01, -0.04, 0.03]);
    assert.equal(s.n, 4);
    assert.equal(s.wins, 3);
    assert.equal(s.losses, 1);
    assert.ok('avgWin' in s && 'avgLoss' in s && 'maxDD' in s);
    assert.ok(s.maxDD > 0);
    assert.ok(Number.isFinite(s.profitFactor));
  });

  it('maxDD compounds sequential returns', () => {
    assert.ok(maxDrawdown([-0.5, 0.1]) >= 0.5 - 1e-9);
  });

  it('permutation is seeded and reports a p-value', () => {
    const trades = [{ entryTime: 1_800_000_000_000 }];
    const zhao = [{ signal_id: 'z1', created_at: 1_800_000_060_000 }];
    const bars = [1_800_000_000_000, 1_800_003_600_000, 1_800_007_200_000, 1_800_010_800_000];
    const a = permutationPrecision(trades, zhao, bars, { b: 50, seed: 7, windowMin: 30 });
    const b = permutationPrecision(trades, zhao, bars, { b: 50, seed: 7, windowMin: 30 });
    assert.equal(a.pValue, b.pValue);
    assert.equal(a.observed, 1);
    assert.ok(a.pValue > 0 && a.pValue <= 1);
  });

  it('does not advertise industrial walk-forward', () => {
    assert.equal(METHOD_LABEL, 'exploratory_is_oos_holdout');
    assert.ok(!METHOD_LABEL.toLowerCase().includes('industrial'));
    assert.ok(!METHOD_LABEL.toLowerCase().includes('walk-forward'));
  });
});
