/**
 * Exploratory IS/OOS holdout for the micro-band buy rule (CHG-050 / REQ-057 P2).
 *
 * This is a single calendar split with a pre-registered grid + frozen params.
 * It is not rolling walk-forward, not alpha, and not a production rule.
 * Confirm convention: close of bar i, fill next bar open. Band/ATR/EMA use i-1.
 */

import crypto from 'crypto';

export const METHOD_LABEL = 'exploratory_is_oos_holdout';
export const ZHAO_SPEAKER_ID = 'user_4yeplXgbguTu4';
export const TOP5_TICKERS = ['IREN', 'SOXL', 'MU', 'CRWV', 'COHR'];

export const PARAM_GRID = [
  { atrPctile: 0.70, volMult: 1.0 },
  { atrPctile: 0.70, volMult: 1.2 },
  { atrPctile: 0.70, volMult: 1.5 },
  { atrPctile: 0.80, volMult: 1.0 },
  { atrPctile: 0.80, volMult: 1.2 },
  { atrPctile: 0.80, volMult: 1.5 },
  { atrPctile: 0.90, volMult: 1.0 },
  { atrPctile: 0.90, volMult: 1.2 },
  { atrPctile: 0.90, volMult: 1.5 }
];

export const FROZEN_DEFAULTS = Object.freeze({
  cooldownBars: 12,
  trailRetrace: 0.382,
  pulseAtrMult: 1.0,
  costBpsRoundTrip: 0.0010,
  lookbackAtr: 100,
  emaPeriod: 26,
  atrPeriod: 14,
  volEmaPeriod: 20,
  confirmConvention: 'close_confirm_next_open_fill',
  isObjective: 'exitA_avgNet_minN8_tie_precision30',
  isDays: 40,
  oosDays: 20
});

const MS_THRESHOLD = 1e12;

export function assertMillisTimestamps(barTimes, zhaoTimes, label = 'timestamps') {
  const all = [...barTimes, ...zhaoTimes].map(Number).filter((t) => Number.isFinite(t));
  if (all.length === 0) {
    throw Object.assign(new Error(`${label}: empty timestamp set`), { exitCode: 1 });
  }
  const asMs = all.filter((t) => t >= MS_THRESHOLD);
  const asSec = all.filter((t) => t >= 1e9 && t < MS_THRESHOLD);
  if (asMs.length && asSec.length) {
    throw Object.assign(
      new Error(`${label}: mixed epoch units (ms vs seconds). bar/zhao must share milliseconds.`),
      { exitCode: 1 }
    );
  }
  if (asSec.length && !asMs.length) {
    throw Object.assign(
      new Error(`${label}: epoch seconds detected; refuse to align. Convert to milliseconds.`),
      { exitCode: 1 }
    );
  }
  return 'ms';
}

export function toMillis(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return n >= MS_THRESHOLD ? n : n * 1000;
}

export function etTradingDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function chooseSplitDays(nDates, { isDays = 40, oosDays = 20 } = {}) {
  if (nDates >= isDays + oosDays) return { isDays, oosDays, mode: 'calendar_40_20' };
  const isN = Math.max(1, Math.floor(nDates * 2 / 3));
  return { isDays: isN, oosDays: Math.max(1, nDates - isN), mode: 'short_window_proportional' };
}

export function splitByTradingDays(bars, { isDays = 40, oosDays = 20 } = {}) {
  const dates = [...new Set(bars.map((b) => etTradingDate(b.time)))].sort();
  const n = dates.length;
  const isCount = Math.min(isDays, n);
  const isDates = dates.slice(0, isCount);
  const remaining = dates.slice(isCount);
  let oosDates;
  let gapDates = [];
  if (remaining.length <= oosDays) {
    oosDates = remaining;
  } else {
    gapDates = remaining.slice(0, remaining.length - oosDays);
    oosDates = remaining.slice(remaining.length - oosDays);
  }
  const isSet = new Set(isDates);
  const oosSet = new Set(oosDates);
  const gapSet = new Set(gapDates);
  return {
    dates,
    isDates,
    oosDates,
    gapDates,
    isDaysActual: isDates.length,
    oosDaysActual: oosDates.length,
    gapDaysActual: gapDates.length,
    classify(bar) {
      const d = etTradingDate(bar.time);
      if (isSet.has(d)) return 'IN_SAMPLE';
      if (oosSet.has(d)) return 'OUT_OF_SAMPLE';
      if (gapSet.has(d)) return 'GAP';
      return 'UNASSIGNED';
    }
  };
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function calcEma(values, period) {
  const k = 2 / (period + 1);
  const ema = new Float64Array(values.length);
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  return ema;
}

export function calcAtr(bars, period = 14) {
  const tr = new Float64Array(bars.length);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }
  const atr = new Float64Array(bars.length);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    atr[i] = i >= period - 1 ? sum / period : sum / (i + 1);
  }
  return atr;
}

export function calcMacd(closes) {
  const ema12 = calcEma(closes, 12);
  const ema26 = calcEma(closes, 26);
  const dif = new Float64Array(closes.length);
  for (let i = 0; i < closes.length; i++) dif[i] = ema12[i] - ema26[i];
  const dea = calcEma(dif, 9);
  return { dif, dea };
}

export function holdBarsForInterval(interval) {
  if (interval === '1m') return 120;
  return 24;
}

function stopFill(bar, stopPrice, costHalf) {
  if (bar.low >= stopPrice) return null;
  const raw = bar.open < stopPrice ? bar.open : stopPrice;
  return raw * (1 - costHalf);
}

export function detectTrades(bars, params, frozen = FROZEN_DEFAULTS, options = {}) {
  const interval = options.interval || '5m';
  const holdBars = options.holdBars || holdBarsForInterval(interval);
  const split = options.split || null;
  const sampleFilter = options.sampleFilter || null;
  const atrPctile = params.atrPctile;
  const volMult = params.volMult;
  const lookback = frozen.lookbackAtr;
  const cost = frozen.costBpsRoundTrip;
  const costHalf = cost / 2;

  const closes = bars.map((b) => b.close);
  const midLadder = calcEma(closes, frozen.emaPeriod);
  const atr = calcAtr(bars, frozen.atrPeriod);
  const { dif } = calcMacd(closes);
  const volEma = calcEma(bars.map((b) => b.volume), frozen.volEmaPeriod);

  const trades = [];
  const start = Math.max(lookback, frozen.emaPeriod, frozen.atrPeriod, 1);

  for (let i = start; i < bars.length - 1; i++) {
    if (i + 1 + holdBars >= bars.length) break;
    if (split && sampleFilter) {
      const kind = split.classify(bars[i]);
      if (kind !== sampleFilter) continue;
    }

    const b = bars[i];
    const prev = bars[i - 1];
    const ratios = [];
    for (let k = i - lookback; k < i; k++) ratios.push(atr[k] / closes[k]);
    const widthPct = percentile(ratios, atrPctile);
    const lowerBand = midLadder[i - 1] - widthPct * closes[i - 1];

    const isOversold = b.low <= lowerBand;
    const isHigherLow = b.low >= prev.low && b.close > prev.close && b.close > b.open;
    const isVolConfirmed = b.volume >= volMult * volEma[i - 1];
    const isMacdHook = dif[i] > dif[i - 1];
    if (!(isOversold && isHigherLow && isVolConfirmed && isMacdHook)) continue;

    const last = trades[trades.length - 1];
    if (last && i - last.confirmBarIdx < frozen.cooldownBars) continue;

    const entryBar = bars[i + 1];
    const entryPrice = entryBar.open * (1 + costHalf);
    const initialStopLoss = Math.min(b.low, prev.low);
    const pulseAtr = atr[i - 1];

    const fixedExitBar = bars[i + 1 + holdBars];
    const fixedExitPrice = fixedExitBar.close * (1 - costHalf);
    const fixedNetRet = (fixedExitPrice - entryPrice) / entryPrice;

    let dynamicExitPrice = fixedExitPrice;
    let dynamicExitReason = 'TIME_EXPIRE';
    let peakPrice = entryPrice;
    let dynamicBarOffset = holdBars;

    for (let f = i + 1; f <= i + 1 + holdBars; f++) {
      const curBar = bars[f];
      const stopPx = stopFill(curBar, initialStopLoss, costHalf);
      if (stopPx != null) {
        dynamicExitPrice = stopPx;
        dynamicExitReason = curBar.open < initialStopLoss ? 'STOP_GAP' : 'STOP_LOSS';
        dynamicBarOffset = f - (i + 1);
        break;
      }
      if (curBar.high > peakPrice) peakPrice = curBar.high;
      const curPulse = peakPrice - entryPrice;
      if (curPulse >= frozen.pulseAtrMult * pulseAtr && (peakPrice - curBar.close) >= frozen.trailRetrace * curPulse) {
        dynamicExitPrice = curBar.close * (1 - costHalf);
        dynamicExitReason = 'TRAIL_STOP_382';
        dynamicBarOffset = f - (i + 1);
        break;
      }
    }

    const dynamicNetRet = (dynamicExitPrice - entryPrice) / entryPrice;
    const forwardSlice = bars.slice(i + 1, i + 1 + holdBars + 1);
    const forwardMaxH = Math.max(...forwardSlice.map((x) => x.high));
    const forwardMinL = Math.min(...forwardSlice.map((x) => x.low));

    trades.push({
      confirmBarIdx: i,
      entryBarIdx: i + 1,
      entryTime: entryBar.time,
      entryDatetime: entryBar.datetime || new Date(entryBar.time).toISOString(),
      entryPrice,
      atrPctile,
      volMult,
      widthPct,
      sampleType: split ? split.classify(bars[i]) : 'UNSPLIT',
      fixedNetRet,
      dynamicNetRet,
      dynamicExitReason,
      dynamicBarOffset,
      netMfe: (forwardMaxH - entryPrice) / entryPrice,
      netMae: (forwardMinL - entryPrice) / entryPrice
    });
  }

  return trades;
}

function nearestNeighbor(tMs, zhaoBuys) {
  let best = null;
  let bestAbs = Infinity;
  for (const z of zhaoBuys) {
    const zMs = Number(z.created_at);
    const abs = Math.abs(tMs - zMs);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = z;
    }
  }
  return best ? { zhao: best, absMs: bestAbs, diffMs: tMs - Number(best.created_at) } : null;
}

export function alignZhao(trades, zhaoBuys, windowsMin = [5, 15, 30]) {
  const events = [];
  const coveredZhao = { 5: new Set(), 15: new Set(), 30: new Set() };

  for (const tr of trades) {
    const nn = nearestNeighbor(tr.entryTime, zhaoBuys);
    const row = {
      entryTime: tr.entryTime,
      entryDatetime: tr.entryDatetime,
      sampleType: tr.sampleType,
      nearestZhaoId: nn ? nn.zhao.signal_id : null,
      nearestAbsMin: nn ? nn.absMs / 60000 : null,
      leadMinutes: nn ? -nn.diffMs / 60000 : null,
      match5m: false,
      match15m: false,
      match30m: false,
      class30m: 'FP'
    };
    if (nn) {
      const absMin = nn.absMs / 60000;
      for (const w of windowsMin) {
        if (absMin <= w) {
          row[`match${w}m`] = true;
          coveredZhao[w].add(nn.zhao.signal_id || `${nn.zhao.created_at}`);
        }
      }
      row.class30m = row.match30m ? 'TP' : 'FP';
    }
    events.push(row);
  }

  const zhaoIds = zhaoBuys.map((z) => z.signal_id || String(z.created_at));
  const fn30 = zhaoBuys.filter((z) => !coveredZhao[30].has(z.signal_id || String(z.created_at)));

  return {
    events,
    tp30: events.filter((e) => e.class30m === 'TP').length,
    fp30: events.filter((e) => e.class30m === 'FP').length,
    fn30: fn30.length,
    fnZhaoIds: fn30.map((z) => z.signal_id || String(z.created_at)),
    precision: Object.fromEntries(
      windowsMin.map((w) => [w, trades.length ? events.filter((e) => e[`match${w}m`]).length / trades.length : 0])
    ),
    recallUnique: Object.fromEntries(
      windowsMin.map((w) => [w, zhaoIds.length ? coveredZhao[w].size / zhaoIds.length : 0])
    )
  };
}

function avg(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function maxDrawdown(returns) {
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function summarizeExit(returns) {
  const n = returns.length;
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + Math.abs(b), 0);
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    avgWin: avg(wins),
    avgLoss: avg(losses.map(Math.abs)),
    avgNet: avg(returns),
    maxDD: maxDrawdown(returns),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0)
  };
}

export function scoreIsCandidate(exitA, align, minN = 8) {
  if (exitA.n < minN) {
    return { eligible: false, score: -1e9 + exitA.n, tie: align.precision[30] || 0 };
  }
  return { eligible: true, score: exitA.avgNet, tie: align.precision[30] || 0 };
}

export function selectFrozenParams(candidates) {
  const eligible = candidates.filter((c) => c.eligible);
  const pool = eligible.length ? eligible : candidates;
  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.tie !== a.tie) return b.tie - a.tie;
    return a.atrPctile - b.atrPctile || a.volMult - b.volMult;
  });
  const best = pool[0];
  return {
    params: { atrPctile: best.atrPctile, volMult: best.volMult },
    selection: eligible.length ? 'exitA_avgNet_minN8_tie_precision30' : 'fallback_max_n_then_exitA',
    isEligible: Boolean(eligible.length),
    gridSize: candidates.length,
    chosen: best
  };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function permutationPrecision(trades, zhaoBuys, barTimes, { b = 200, seed = 502026, windowMin = 30 } = {}) {
  if (!trades.length || !zhaoBuys.length || !barTimes.length) {
    return { b, windowMin, observed: 0, nullMean: 0, percentile: null, pValue: null };
  }
  const observed = trades.filter((t) => {
    const nn = nearestNeighbor(t.entryTime, zhaoBuys);
    return nn && nn.absMs / 60000 <= windowMin;
  }).length / trades.length;

  const rng = mulberry32(seed);
  const nulls = [];
  for (let i = 0; i < b; i++) {
    const fake = zhaoBuys.map((z, idx) => ({
      ...z,
      signal_id: `perm_${i}_${idx}`,
      created_at: barTimes[Math.floor(rng() * barTimes.length)]
    }));
    const hit = trades.filter((t) => {
      const nn = nearestNeighbor(t.entryTime, fake);
      return nn && nn.absMs / 60000 <= windowMin;
    }).length / trades.length;
    nulls.push(hit);
  }
  const leq = nulls.filter((x) => x >= observed).length;
  const below = nulls.filter((x) => x < observed).length;
  return {
    b,
    windowMin,
    observed,
    nullMean: avg(nulls),
    nullP50: percentile(nulls, 0.5),
    nullP95: percentile(nulls, 0.95),
    percentile: below / nulls.length,
    pValue: (leq + 1) / (b + 1)
  };
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function formatPct(x, digits = 1) {
  if (!Number.isFinite(x)) return null;
  return Number((x * 100).toFixed(digits));
}

export function publicExitStats(s) {
  return {
    n: s.n,
    wins: s.wins,
    losses: s.losses,
    avgWin: Number((s.avgWin * 100).toFixed(4)),
    avgLoss: Number((s.avgLoss * 100).toFixed(4)),
    avgNet: Number((s.avgNet * 100).toFixed(4)),
    maxDD: Number((s.maxDD * 100).toFixed(4)),
    profitFactor: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(2)),
    profitFactorNote: 'exploratory_only_not_a_rule'
  };
}
