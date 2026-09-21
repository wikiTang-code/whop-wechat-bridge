/**
 * REQ-059 / Track 2 dual ledger (style S × expectancy R-precursor).
 *
 * Frozen OHLCV rules, causal bars, two independent ledgers.
 * Not copytrade. Not done-strat. Not CHG-050 retune.
 * px_zhao / oral never becomes entry.
 */

import crypto from 'crypto';

export const REQ_ID = 'REQ-059';
export const CHG_ID = 'CHG-055';
export const METHOD_LABEL = 'dual_ledger_track2_v0';
export const ZHAO_SPEAKER_ID = 'user_4yeplXgbguTu4';
export const ZHAO_SPEAKER_NAME = 'xiaozhaolucky';
export const TOP5_TICKERS = Object.freeze(['IREN', 'SOXL', 'MU', 'CRWV', 'COHR']);
export const TRADE_SIGNAL_CHANNELS = Object.freeze([
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS'
]);

export const BAR_TZ = 'America/New_York';
export const T_MSG_KIND_MESSAGE_CLOCK = 'message_clock';
export const STYLE_WINDOWS_MIN = Object.freeze([5, 15, 30]);
export const BANNED_STYLE_WINDOW_MIN = 120;
export const PERM_SEED = 59021;
export const PERM_B = 50;

export const FROZEN_DEFAULTS = Object.freeze({
  interval: '5m',
  lookbackDays: 60,
  volEmaPeriod: 20,
  atrPeriod: 14,
  breakLookback: 12,
  cooldownBars: 12,
  costBpsRoundTrip: 10,
  holdBars: 12,
  ddAtrMult: 1.0,
  isDays: 40,
  oosDays: 20,
  confirmConvention: 'bar_close_confirm_next_open_fill'
});

export const STATUS_BANNER = Object.freeze({
  status: 'REFERENCE_ONLY',
  hint_only: true,
  not_copytrade: true,
  not_done_strat: true,
  not_autonomous_alpha: true,
  chg050_sibling: 'negative_control',
  place_order: false,
  hud_auto: false,
  freeze_20_40: true
});

export const ARCHIVE_MISSING =
  'TRACK2_FAIL_CLOSED: readonly archive missing; use --events fixtures or run on machine/GCP with whop_archive.db';
export const CREATED_AT_MISSING =
  'TRACK2_FAIL_CLOSED: messages.created_at unavailable; refusing silent session_anchor fallback';
export const ORAL_ENTRY_FORBIDDEN = 'oral price leakage: entry must not be px_zhao/oral';
export const MERGED_PF_FORBIDDEN = 'ledgers must not merge into one PF headline';
export const WINDOW_2H_BANNED = 'style window ±2h banned (CHG-050 wide-window negative control)';

const MS_THRESHOLD = 1e12;
const BUY_ACTIONS = new Set(['BUY', 'ADD', 'OPEN', 'COVER']);
const SELL_ACTIONS = new Set(['SELL', 'TRIM', 'CLOSE', 'REDUCE']);

export const FROZEN_RULES = Object.freeze([
  {
    id: 'T2R-VOL_EXPANSION_UP',
    side: 'BUY',
    volMult: 1.5,
    note: 'close>open AND close>prev.close AND volume>1.5*volEMA[i-1]',
    predicateSrc: 'volume > volMult * volEmaPrev'
  },
  {
    id: 'T2R-VOL_EXPANSION_DOWN',
    side: 'SELL',
    volMult: 1.5,
    note: 'close<open AND close<prev.close AND volume>1.5*volEMA[i-1]',
    predicateSrc: 'volume > volMult * volEmaPrev'
  },
  {
    id: 'T2R-RANGE_BREAK_VOL',
    side: 'BUY',
    volMult: 1.2,
    note: 'close>max(high[-12:-1]) AND volume>1.2*volEMA[i-1]',
    predicateSrc: 'volume > volMult * volEmaPrev'
  },
  {
    id: 'T2R-ATR_SHOCK_VOL',
    side: 'BOTH',
    volMult: 1.2,
    atrMult: 1.5,
    note: '(high-low)>1.5*ATR[i-1] AND volume>1.2*volEMA[i-1]; side from close vs open',
    predicateSrc: 'volume > volMult * volEmaPrev'
  }
]);

export function frozenRuleIds() {
  return FROZEN_RULES.map((r) => r.id);
}

export function assertVolumeInEveryRule() {
  for (const rule of FROZEN_RULES) {
    if (!/volume/i.test(rule.note) || !/volume/i.test(rule.predicateSrc)) {
      throw new Error(`rule ${rule.id} missing volume in the if`);
    }
    if (rule.volMult == null) throw new Error(`rule ${rule.id} missing volMult`);
  }
  return true;
}

export function toMillis(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return n >= MS_THRESHOLD ? n : n * 1000;
}

export function barIntervalMs(interval = FROZEN_DEFAULTS.interval) {
  const key = String(interval || '5m').toLowerCase();
  const m = key.match(/^(\d+)(m|h)$/);
  if (!m) throw new Error(`unsupported bar interval: ${interval}`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600 * 1000 : n * 60 * 1000;
}

export function etTradingDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BAR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function parseSymbols(raw) {
  const src = raw == null || raw === '' ? TOP5_TICKERS : String(raw).split(',');
  const out = [];
  for (const token of src) {
    const s = String(token).trim().toUpperCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  if (!out.length) throw new Error('symbols empty');
  return out;
}

export function isZhaoSpeaker(row) {
  const id = row?.speaker_id || row?.sender_id || '';
  if (!id) return false;
  return id === ZHAO_SPEAKER_ID;
}

export function isAllowedChannel(channelId) {
  if (!channelId) return false;
  return TRADE_SIGNAL_CHANNELS.includes(String(channelId));
}

export function normalizeSide(action) {
  const a = String(action || '').toUpperCase();
  if (BUY_ACTIONS.has(a)) return 'BUY';
  if (SELL_ACTIONS.has(a)) return 'SELL';
  return null;
}

export function assertStyleWindowAllowed(windowMin) {
  const w = Number(windowMin);
  if (w >= BANNED_STYLE_WINDOW_MIN) {
    throw new Error(WINDOW_2H_BANNED);
  }
  if (!STYLE_WINDOWS_MIN.includes(w)) {
    throw new Error(`style window not pre-registered: ${windowMin}`);
  }
  return w;
}

export function isCausalBar(bar, tMsg, intervalMs) {
  const bt = toMillis(bar?.time);
  const t = toMillis(tMsg);
  if (!Number.isFinite(bt) || !Number.isFinite(t) || !Number.isFinite(intervalMs)) return false;
  return bt + intervalMs <= t;
}

export function causalBarsBefore(bars, tMsg, intervalMs) {
  return (bars || []).filter((b) => isCausalBar(b, tMsg, intervalMs));
}

export function calcEma(values, period) {
  const k = 2 / (period + 1);
  const ema = new Float64Array(values.length);
  if (!values.length) return ema;
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  return ema;
}

export function calcAtr(bars, period = 14) {
  const atr = new Float64Array(bars.length);
  if (!bars.length) return atr;
  const tr = new Float64Array(bars.length);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    atr[i] = i >= period - 1 ? sum / period : sum / (i + 1);
  }
  return atr;
}

function ruleFires(rule, bars, i, volEma, atr) {
  if (i < 1) return false;
  const b = bars[i];
  const prev = bars[i - 1];
  const volEmaPrev = volEma[i - 1];
  const volume = Number(b.volume);
  if (!Number.isFinite(volume) || !Number.isFinite(volEmaPrev) || volEmaPrev <= 0) return false;
  const volOk = volume > rule.volMult * volEmaPrev;
  if (!volOk) return false;

  if (rule.id === 'T2R-VOL_EXPANSION_UP') {
    return b.close > b.open && b.close > prev.close;
  }
  if (rule.id === 'T2R-VOL_EXPANSION_DOWN') {
    return b.close < b.open && b.close < prev.close;
  }
  if (rule.id === 'T2R-RANGE_BREAK_VOL') {
    const look = FROZEN_DEFAULTS.breakLookback;
    if (i < look) return false;
    let mx = -Infinity;
    for (let k = i - look; k < i; k++) mx = Math.max(mx, bars[k].high);
    return b.close > mx;
  }
  if (rule.id === 'T2R-ATR_SHOCK_VOL') {
    const a = atr[i - 1];
    if (!Number.isFinite(a) || a <= 0) return false;
    return b.high - b.low > rule.atrMult * a;
  }
  return false;
}

function sideForRule(rule, bar) {
  if (rule.side === 'BUY' || rule.side === 'SELL') return rule.side;
  return bar.close >= bar.open ? 'BUY' : 'SELL';
}

export function detectRuleTriggers(bars, { interval = FROZEN_DEFAULTS.interval, tMsgCutoff = null } = {}) {
  assertVolumeInEveryRule();
  const intervalMs = barIntervalMs(interval);
  const universe = tMsgCutoff == null ? bars : causalBarsBefore(bars, tMsgCutoff, intervalMs);
  if (!universe.length) return [];
  const volEma = calcEma(universe.map((b) => Number(b.volume) || 0), FROZEN_DEFAULTS.volEmaPeriod);
  const atr = calcAtr(universe, FROZEN_DEFAULTS.atrPeriod);
  const start = Math.max(FROZEN_DEFAULTS.volEmaPeriod, FROZEN_DEFAULTS.atrPeriod, FROZEN_DEFAULTS.breakLookback, 1);
  const lastByKey = new Map();
  const out = [];

  for (let i = start; i < universe.length; i++) {
    const b = universe[i];
    if (i + 1 >= universe.length) break;
    for (const rule of FROZEN_RULES) {
      if (!ruleFires(rule, universe, i, volEma, atr)) continue;
      const key = `${rule.id}`;
      const last = lastByKey.get(key);
      if (last != null && i - last < FROZEN_DEFAULTS.cooldownBars) continue;
      lastByKey.set(key, i);
      const triggerMs = toMillis(b.time) + intervalMs;
      out.push({
        rule_id: rule.id,
        side: sideForRule(rule, b),
        confirmBarIdx: i,
        entryBarIdx: i + 1,
        bar_time: toMillis(b.time),
        trigger_ms: triggerMs,
        trigger_iso: new Date(triggerMs).toISOString(),
        volume: Number(b.volume),
        vol_ema_prev: volEma[i - 1],
        atr_prev: atr[i - 1],
        close: b.close,
        open: b.open
      });
    }
  }
  return out;
}

function costHalf() {
  return FROZEN_DEFAULTS.costBpsRoundTrip / 10000 / 2;
}

export function assertOralNeverEntry(row) {
  const src = String(row.entry_px_source || '');
  if (/oral|px_zhao/i.test(src)) throw new Error(ORAL_ENTRY_FORBIDDEN);
  if (row.entry_px != null && row.px_zhao != null && Number(row.entry_px) === Number(row.px_zhao)) {
    throw new Error(ORAL_ENTRY_FORBIDDEN);
  }
  if (Object.prototype.hasOwnProperty.call(row, 'px_arrive') && row.px_arrive_source === 'px_zhao') {
    throw new Error(ORAL_ENTRY_FORBIDDEN);
  }
  return true;
}

function maxDrawdown(returns) {
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

function avg(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function summarizeReturns(returns) {
  const n = returns.length;
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + Math.abs(b), 0);
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    avgNet: avg(returns),
    avgWin: avg(wins),
    avgLoss: avg(losses.map(Math.abs)),
    maxDD: maxDrawdown(returns),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    profitFactorNote: 'ledger_R_column_only_not_a_headline'
  };
}

export function chooseSplitDays(nDates, { isDays = 40, oosDays = 20 } = {}) {
  if (nDates >= isDays + oosDays) return { isDays, oosDays, mode: 'calendar_40_20' };
  const isN = Math.max(1, Math.floor(nDates * 2 / 3));
  return { isDays: isN, oosDays: Math.max(1, nDates - isN), mode: 'short_window_proportional' };
}

export function splitByTradingDays(bars, { isDays = 40, oosDays = 20 } = {}) {
  const dates = [...new Set(bars.map((b) => etTradingDate(toMillis(b.time))))].sort();
  const chosen = chooseSplitDays(dates.length, { isDays, oosDays });
  const isCount = Math.min(chosen.isDays, dates.length);
  const isDates = dates.slice(0, isCount);
  const remaining = dates.slice(isCount);
  let oosDates;
  let gapDates = [];
  if (remaining.length <= chosen.oosDays) {
    oosDates = remaining;
  } else {
    gapDates = remaining.slice(0, remaining.length - chosen.oosDays);
    oosDates = remaining.slice(remaining.length - chosen.oosDays);
  }
  const isSet = new Set(isDates);
  const oosSet = new Set(oosDates);
  const gapSet = new Set(gapDates);
  return {
    dates,
    isDates,
    oosDates,
    gapDates,
    mode: chosen.mode,
    isDaysActual: isDates.length,
    oosDaysActual: oosDates.length,
    gapDaysActual: gapDates.length,
    classify(barOrMs) {
      const ms = typeof barOrMs === 'number' || typeof barOrMs === 'string'
        ? toMillis(barOrMs)
        : toMillis(barOrMs.time || barOrMs.trigger_ms || barOrMs.bar_time);
      const d = etTradingDate(ms);
      if (isSet.has(d)) return 'IN_SAMPLE';
      if (oosSet.has(d)) return 'OUT_OF_SAMPLE';
      if (gapSet.has(d)) return 'GAP';
      return 'UNASSIGNED';
    }
  };
}

function exitFixed(bars, entryIdx, holdBars, entryPx, half) {
  const exitIdx = Math.min(bars.length - 1, entryIdx + holdBars);
  const exitBar = bars[exitIdx];
  if (!exitBar) return null;
  const exitPx = Number(exitBar.close) * (1 - half);
  return {
    kind: 'fixed_hold_bars',
    hold_bars: holdBars,
    exit_bar_idx: exitIdx,
    exit_px: exitPx,
    net_ret: (exitPx - entryPx) / entryPx
  };
}

function exitDrawdown(bars, entryIdx, holdBars, entryPx, half, atrPrev) {
  const stopDist = FROZEN_DEFAULTS.ddAtrMult * (Number(atrPrev) || 0);
  const stopPx = Number(entryPx) - stopDist;
  let peak = entryPx;
  for (let f = entryIdx; f <= Math.min(bars.length - 1, entryIdx + holdBars); f++) {
    const bar = bars[f];
    const close = Number(bar.close);
    if (close > peak) peak = close;
    if (Number.isFinite(stopPx) && stopDist > 0 && bar.low <= stopPx) {
      const raw = bar.open < stopPx ? bar.open : stopPx;
      const exitPx = raw * (1 - half);
      return {
        kind: 'drawdown_atr_stop',
        hold_bars: f - entryIdx,
        exit_bar_idx: f,
        exit_px: exitPx,
        net_ret: (exitPx - entryPx) / entryPx,
        reason: bar.open < stopPx ? 'STOP_GAP' : 'STOP_ATR'
      };
    }
  }
  const timed = exitFixed(bars, entryIdx, holdBars, entryPx, half);
  return timed ? { ...timed, kind: 'drawdown_time_stop', reason: 'TIME_EXPIRE' } : null;
}

export function buildExpectancyRows(bars, triggers, { symbol, split = null, interval = FROZEN_DEFAULTS.interval } = {}) {
  const half = costHalf();
  const hold = FROZEN_DEFAULTS.holdBars;
  const rows = [];
  for (const tr of triggers) {
    const entryBar = bars[tr.entryBarIdx];
    if (!entryBar) continue;
    const rawOpen = Number(entryBar.open);
    if (!Number.isFinite(rawOpen) || rawOpen <= 0) continue;
    const entryPx = rawOpen * (1 + half);
    const sampleType = split ? split.classify(tr.trigger_ms) : 'UNSPLIT';
    const exA = exitFixed(bars, tr.entryBarIdx, hold, entryPx, half);
    const exB = exitDrawdown(bars, tr.entryBarIdx, hold, entryPx, half, tr.atr_prev);
    const row = {
      schema: 'dual_ledger_r_precursor_v0',
      ledger: 'R',
      method: METHOD_LABEL,
      symbol,
      rule_id: tr.rule_id,
      side: tr.side,
      trigger_ms: tr.trigger_ms,
      entry_time: toMillis(entryBar.time),
      entry_px: entryPx,
      entry_px_source: 'next_bar_open_plus_half_cost',
      px_zhao: null,
      cost_bps_round_trip: FROZEN_DEFAULTS.costBpsRoundTrip,
      sample_type: sampleType,
      exit_a: exA,
      exit_b: exB,
      zhao_spoken: 'IGNORED',
      status: STATUS_BANNER.status,
      hint_only: true
    };
    assertOralNeverEntry(row);
    rows.push(row);
  }
  return rows;
}

function nearestZhaoAfter(triggerMs, events, windowMin, side = null) {
  const hi = triggerMs + windowMin * 60 * 1000;
  let best = null;
  for (const ev of events) {
    if (ev.t_msg <= triggerMs || ev.t_msg > hi) continue;
    if (side && ev.side !== side) continue;
    if (!best || ev.t_msg < best.t_msg) best = ev;
  }
  return best;
}

function nearestTriggerBefore(tMsg, triggers, windowMin, side = null) {
  const lo = tMsg - windowMin * 60 * 1000;
  let best = null;
  for (const tr of triggers) {
    if (tr.trigger_ms >= tMsg || tr.trigger_ms < lo) continue;
    if (side && tr.side !== side) continue;
    if (!best || tr.trigger_ms > best.trigger_ms) best = tr;
  }
  return best;
}

export function buildStyleRows(triggers, zhaoEvents, { symbol } = {}) {
  for (const w of STYLE_WINDOWS_MIN) assertStyleWindowAllowed(w);
  const rows = [];
  for (const tr of triggers) {
    const match = {};
    let cls30 = 'FP';
    let zhao = null;
    for (const w of STYLE_WINDOWS_MIN) {
      const hit = nearestZhaoAfter(tr.trigger_ms, zhaoEvents, w, null);
      match[`match_${w}m`] = Boolean(hit);
      if (w === 30 && hit) {
        cls30 = 'TP';
        zhao = hit;
      }
      if (hit && !zhao) zhao = hit;
    }
    rows.push({
      schema: 'dual_ledger_s_style_v0',
      ledger: 'S',
      method: METHOD_LABEL,
      symbol,
      rule_id: tr.rule_id,
      side: tr.side,
      trigger_ms: tr.trigger_ms,
      trigger_iso: tr.trigger_iso,
      class_30m: cls30,
      match_5m: match.match_5m,
      match_15m: match.match_15m,
      match_30m: match.match_30m,
      zhao_event_id: zhao ? zhao.event_id : null,
      zhao_t_msg: zhao ? zhao.t_msg : null,
      px_zhao: zhao ? zhao.px_zhao : null,
      entry_px: null,
      entry_px_source: 'style_ledger_no_entry',
      status: STATUS_BANNER.status,
      hint_only: true,
      banned_window_min: BANNED_STYLE_WINDOW_MIN
    });
  }
  const fn = [];
  for (const ev of zhaoEvents) {
    const prior = nearestTriggerBefore(ev.t_msg, triggers, 30, null);
    if (!prior) {
      fn.push({
        schema: 'dual_ledger_s_style_v0',
        ledger: 'S',
        method: METHOD_LABEL,
        symbol,
        rule_id: null,
        side: ev.side,
        trigger_ms: null,
        class_30m: 'FN',
        match_5m: false,
        match_15m: false,
        match_30m: false,
        zhao_event_id: ev.event_id,
        zhao_t_msg: ev.t_msg,
        px_zhao: ev.px_zhao,
        entry_px: null,
        entry_px_source: 'style_ledger_no_entry',
        status: STATUS_BANNER.status,
        hint_only: true
      });
    }
  }
  return { triggers: rows, fn };
}

export function summarizeStyle(triggerRows, fnRows) {
  const tp = triggerRows.filter((r) => r.class_30m === 'TP').length;
  const fp = triggerRows.filter((r) => r.class_30m === 'FP').length;
  const fn = fnRows.length;
  const prec = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  return {
    n_triggers: triggerRows.length,
    tp30: tp,
    fp30: fp,
    fn30: fn,
    precision_30m: prec,
    recall_30m: rec,
    match_5m: triggerRows.filter((r) => r.match_5m).length,
    match_15m: triggerRows.filter((r) => r.match_15m).length,
    match_30m: triggerRows.filter((r) => r.match_30m).length,
    banned_window_min: BANNED_STYLE_WINDOW_MIN,
    note: 'style ledger only; not expectancy; not a PF headline'
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function permutationStylePrecision(triggers, zhaoEvents, barTimes, { b = PERM_B, seed = PERM_SEED, windowMin = 30 } = {}) {
  assertStyleWindowAllowed(windowMin);
  if (!triggers.length || !zhaoEvents.length || !barTimes.length) {
    return { b, windowMin, observed: 0, pValue: null, seed };
  }
  const observedHit = triggers.filter((t) => nearestZhaoAfter(t.trigger_ms, zhaoEvents, windowMin)).length;
  const observed = triggers.length ? observedHit / triggers.length : 0;
  const rng = mulberry32(seed);
  const nulls = [];
  for (let i = 0; i < b; i++) {
    const fake = zhaoEvents.map((z, idx) => ({
      ...z,
      event_id: `perm_${i}_${idx}`,
      t_msg: toMillis(barTimes[Math.floor(rng() * barTimes.length)])
    }));
    const hit = triggers.filter((t) => nearestZhaoAfter(t.trigger_ms, fake, windowMin)).length;
    nulls.push(triggers.length ? hit / triggers.length : 0);
  }
  const leq = nulls.filter((x) => x >= observed).length;
  return {
    b,
    windowMin,
    seed,
    observed,
    nullMean: avg(nulls),
    pValue: (leq + 1) / (b + 1),
    note: 'timestamp permutation on style precision_30m; not R expectancy'
  };
}

export function tradeEventFromNormalized(raw, symbols) {
  if (!isZhaoSpeaker(raw)) return null;
  const symbol = String(raw.symbol || raw.ticker || '').toUpperCase();
  if (symbols && !symbols.includes(symbol)) return null;
  const side = normalizeSide(raw.side || raw.action);
  if (!side) return null;
  const tMsg = toMillis(raw.t_msg ?? raw.created_at ?? raw.msg_created_at);
  if (!Number.isFinite(tMsg)) return null;
  const kind = raw.t_msg_kind || T_MSG_KIND_MESSAGE_CLOCK;
  if (kind !== T_MSG_KIND_MESSAGE_CLOCK) return null;
  const px = Number(raw.px_zhao ?? raw.price ?? raw.call_price);
  const channel = raw.channel_id || raw.channel || null;
  if (!isAllowedChannel(channel)) return null;
  return {
    event_id: raw.event_id || raw.signal_id || `${symbol}_${side}_${tMsg}`,
    symbol,
    side,
    t_msg: tMsg,
    t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK,
    px_zhao: Number.isFinite(px) && px > 0 ? px : null,
    speaker_id: raw.speaker_id || raw.sender_id,
    channel_id: channel,
    source: raw.source || 'jsonl'
  };
}

export function loadZhaoEventsFromJsonlLines(lines, { symbols } = {}) {
  const events = [];
  const seen = new Set();
  for (const line of lines || []) {
    const s = String(line).trim();
    if (!s || s.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    const ev = tradeEventFromNormalized(obj, symbols);
    if (!ev) continue;
    const k = `${ev.symbol}|${ev.side}|${ev.t_msg}|${ev.event_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push(ev);
  }
  return events;
}

export function loadZhaoEventsFromSqliteRows(rows, { symbols } = {}) {
  return loadZhaoEventsFromJsonlLines(
    (rows || []).map((row) =>
      JSON.stringify({
        event_id: row.signal_id,
        symbol: row.ticker,
        action: row.action,
        px_zhao: row.price,
        t_msg: row.created_at,
        t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK,
        speaker_id: row.speaker_id,
        channel_id: row.channel_id,
        source: 'trade_signals'
      })
    ),
    { symbols }
  );
}

export function sqliteZhaoQuery() {
  return `
    SELECT ts.signal_id, ts.ticker, ts.action, ts.price,
           m.created_at AS created_at,
           ts.speaker_id, ts.channel_id, ts.message_id
    FROM trade_signals ts
    INNER JOIN messages m ON m.id = ts.message_id
    WHERE ts.speaker_id = ?
      AND ts.speaker_id IS NOT NULL
      AND ts.action IN ('BUY', 'ADD', 'OPEN', 'COVER', 'SELL', 'TRIM', 'CLOSE', 'REDUCE')
      AND ts.channel_id IN (?, ?)
      AND m.created_at IS NOT NULL
    ORDER BY m.created_at ASC
  `;
}

export function hasMessagesCreatedAtColumn(db) {
  if (!db) return false;
  try {
    const cols = db.prepare(`PRAGMA table_info(messages)`).all();
    return Array.isArray(cols) && cols.some((c) => c.name === 'created_at');
  } catch {
    return false;
  }
}

export function resolveTrack2Source({ eventsPath = null, archiveExists = false, hasMessagesCreatedAt = false } = {}) {
  if (eventsPath) {
    return { source: 'jsonl_fixtures', t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK, not_for_strategy: false };
  }
  if (!archiveExists) throw new Error(ARCHIVE_MISSING);
  if (!hasMessagesCreatedAt) throw new Error(CREATED_AT_MISSING);
  return { source: 'sqlite_messages_created_at', t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK, not_for_strategy: false };
}

export function filterLookback(events, lookbackDays, nowMs = Date.now()) {
  if (!lookbackDays) return events;
  const minT = nowMs - Number(lookbackDays) * 86400 * 1000;
  return events.filter((e) => e.t_msg >= minT);
}

export function assertLedgersNotMerged(summary) {
  if (!summary || typeof summary !== 'object') throw new Error(MERGED_PF_FORBIDDEN);
  const banned = ['merged_pf', 'combined_profit_factor', 'headline_pf', 'profitFactor'];
  for (const k of banned) {
    if (Object.prototype.hasOwnProperty.call(summary, k)) throw new Error(MERGED_PF_FORBIDDEN);
  }
  if (!summary.ledger_S || !summary.ledger_R) throw new Error(MERGED_PF_FORBIDDEN);
  if (summary.ledger_S.profitFactor != null) throw new Error(MERGED_PF_FORBIDDEN);
  return true;
}

function round4(n) {
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(4));
}

export function publicRStats(s) {
  return {
    n: s.n,
    wins: s.wins,
    losses: s.losses,
    avgNet: round4(s.avgNet),
    maxDD: round4(s.maxDD),
    profitFactor: s.profitFactor === Infinity ? null : round4(s.profitFactor),
    profitFactorNote: s.profitFactorNote
  };
}

export function runDualLedger({
  symbol,
  bars,
  zhaoEvents,
  interval = FROZEN_DEFAULTS.interval
} = {}) {
  const split = splitByTradingDays(bars, {
    isDays: FROZEN_DEFAULTS.isDays,
    oosDays: FROZEN_DEFAULTS.oosDays
  });
  const triggers = detectRuleTriggers(bars, { interval });
  const style = buildStyleRows(triggers, zhaoEvents, { symbol });
  const styleRows = [...style.triggers, ...style.fn];
  const rRows = buildExpectancyRows(bars, triggers, { symbol, split, interval });
  const rIs = rRows.filter((r) => r.sample_type === 'IN_SAMPLE');
  const rOos = rRows.filter((r) => r.sample_type === 'OUT_OF_SAMPLE');
  const styleSum = summarizeStyle(style.triggers, style.fn);
  const perm = permutationStylePrecision(
    triggers,
    zhaoEvents,
    bars.map((b) => toMillis(b.time)),
    { b: PERM_B, seed: PERM_SEED, windowMin: 30 }
  );
  return {
    symbol,
    split: {
      mode: split.mode,
      isDaysActual: split.isDaysActual,
      oosDaysActual: split.oosDaysActual,
      gapDaysActual: split.gapDaysActual
    },
    n_triggers: triggers.length,
    style_rows: styleRows,
    r_rows: rRows,
    ledger_S: {
      ...styleSum,
      permutation_30m: perm
    },
    ledger_R: {
      ignore_zhao: true,
      exit_a_all: publicRStats(summarizeReturns(rRows.map((r) => r.exit_a?.net_ret).filter((x) => Number.isFinite(x)))),
      exit_b_all: publicRStats(summarizeReturns(rRows.map((r) => r.exit_b?.net_ret).filter((x) => Number.isFinite(x)))),
      exit_a_is: publicRStats(summarizeReturns(rIs.map((r) => r.exit_a?.net_ret).filter((x) => Number.isFinite(x)))),
      exit_a_oos: publicRStats(summarizeReturns(rOos.map((r) => r.exit_a?.net_ret).filter((x) => Number.isFinite(x)))),
      exit_b_is: publicRStats(summarizeReturns(rIs.map((r) => r.exit_b?.net_ret).filter((x) => Number.isFinite(x)))),
      exit_b_oos: publicRStats(summarizeReturns(rOos.map((r) => r.exit_b?.net_ret).filter((x) => Number.isFinite(x)))),
      note: 'ExitA=fixed 12 bars and ExitB=drawdown reported separately; Zhao ignored'
    }
  };
}

export function emptySummaryShell() {
  return {
    banner: { ...STATUS_BANNER, method: METHOD_LABEL, req: REQ_ID, chg: CHG_ID },
    frozen_rule_ids: frozenRuleIds(),
    frozen_defaults: FROZEN_DEFAULTS,
    speaker_lock: ZHAO_SPEAKER_ID,
    t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK,
    style_windows_min: STYLE_WINDOWS_MIN,
    banned_style_window_min: BANNED_STYLE_WINDOW_MIN,
    ledger_S: { note: 'style only' },
    ledger_R: { note: 'expectancy precursor only; ignore Zhao' },
    archive_note:
      'Cloud/CI: fixtures only. Full 60d archive run is on machine/GCP with whop_archive.db; paste summaries back into 059 report.'
  };
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function yahooBarsFromChartJson(json) {
  const res0 = json?.chart?.result?.[0];
  const ts = res0?.timestamp;
  if (!ts?.length) return [];
  const q = res0.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue;
    bars.push({
      time: ts[i] * 1000,
      datetime: new Date(ts[i] * 1000).toISOString(),
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] || 0
    });
  }
  return bars;
}

/**
 * Deterministic 60 ET-session fixture bars. Volume spike days are planted
 * so frozen rules fire without retuning.
 */
export function buildFixtureBars(symbol, { days = 60, barsPerDay = 8, startMs = Date.UTC(2026, 5, 1, 13, 30) } = {}) {
  const out = [];
  let t = startMs;
  let px = symbol === 'SOXL' ? 30 : symbol === 'MU' ? 120 : 40;
  const interval = 5 * 60 * 1000;
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < barsPerDay; i++) {
      const spikeUp = d === 10 && i === 3;
      const spikeDown = d === 18 && i === 3;
      const oosSpike = d === 50 && i === 3;
      const shock = d === 22 && i === 4;
      const rangeBreak = d === 14 && i === 5;
      let o = px;
      let c = px + 0.02;
      let vol = 800 + (d + i) % 7;
      if (spikeUp || oosSpike) {
        c = o + 0.8;
        vol = 8000;
      } else if (spikeDown) {
        c = o - 0.8;
        vol = 8000;
      } else if (shock) {
        c = o + 0.1;
        vol = 5000;
      } else if (rangeBreak) {
        c = o + 2.5;
        vol = 4000;
      }
      const h = Math.max(o, c) + (shock ? 3.0 : 0.05);
      const l = Math.min(o, c) - (shock ? 3.0 : 0.05);
      out.push({
        time: t,
        datetime: new Date(t).toISOString(),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: vol,
        symbol
      });
      px = c;
      t += interval;
    }
    t += 24 * 3600 * 1000 - barsPerDay * interval;
  }
  return out;
}

export function buildFixtureEvents(barsBySymbol) {
  const iren = barsBySymbol.IREN || [];
  const intervalMs = barIntervalMs('5m');
  const events = [];
  const barAt = (arr, day, idx, days = 60, bpd = 8) => arr[day * bpd + idx];
  const up = barAt(iren, 10, 3);
  if (up) {
    const trigger = toMillis(up.time) + intervalMs;
    events.push({
      event_id: 'fx_iren_tp_buy',
      symbol: 'IREN',
      side: 'BUY',
      t_msg: trigger + 8 * 60 * 1000,
      px_zhao: 999.99,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: TRADE_SIGNAL_CHANNELS[0],
      t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
    });
  }
  const dn = barAt(iren, 18, 3);
  if (dn) {
    const trigger = toMillis(dn.time) + intervalMs;
    events.push({
      event_id: 'fx_iren_tp_sell',
      symbol: 'IREN',
      side: 'SELL',
      t_msg: trigger + 6 * 60 * 1000,
      px_zhao: 1.23,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: TRADE_SIGNAL_CHANNELS[1],
      t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
    });
  }
  const quiet = barAt(iren, 12, 1);
  if (quiet) {
    events.push({
      event_id: 'fx_iren_fn_buy',
      symbol: 'IREN',
      side: 'BUY',
      t_msg: toMillis(quiet.time) + intervalMs + 60 * 1000,
      px_zhao: 42,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: TRADE_SIGNAL_CHANNELS[0],
      t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
    });
  }
  events.push({
    event_id: 'fx_reject_zhou',
    symbol: 'IREN',
    side: 'BUY',
    t_msg: Date.UTC(2026, 5, 10, 14, 0),
    px_zhao: 10,
    speaker_id: 'user_HnSG7BJWMTfDz',
    channel_id: TRADE_SIGNAL_CHANNELS[0],
    t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
  });
  events.push({
    event_id: 'fx_reject_channel',
    symbol: 'SOXL',
    side: 'BUY',
    t_msg: Date.UTC(2026, 5, 10, 14, 0),
    px_zhao: 10,
    speaker_id: ZHAO_SPEAKER_ID,
    channel_id: 'chat_feed_NOT_TRADE',
    t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
  });
  const soxl = barsBySymbol.SOXL || [];
  const sUp = soxl[10 * 8 + 3];
  if (sUp) {
    events.push({
      event_id: 'fx_soxl_tp',
      symbol: 'SOXL',
      side: 'BUY',
      t_msg: toMillis(sUp.time) + intervalMs + 10 * 60 * 1000,
      px_zhao: 55,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: TRADE_SIGNAL_CHANNELS[0],
      t_msg_kind: T_MSG_KIND_MESSAGE_CLOCK
    });
  }
  return events;
}
