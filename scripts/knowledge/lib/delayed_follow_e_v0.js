/**
 * REQ-058 / delayed-follow E-layer v0 — pure functions.
 *
 * Hypothesized arrival: t_arrive_hat = t_msg + Δ. Δ is a poll-bin hypothesis,
 * not observed t_arrive. px_arrive is the open of the bar containing
 * t_arrive_hat. Oral px_zhao is never used as arrival price.
 *
 * Not autonomous alpha. Not 赵哥本人那笔赚多少. No invented t_fill.
 */

export const ZHAO_SPEAKER_ID = 'user_4yeplXgbguTu4';
export const ZHAO_SPEAKER_NAME = 'xiaozhaolucky';

export const TRADE_SIGNAL_CHANNELS = Object.freeze([
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN', // 历史股票期权记录区
  'chat_feed_1CTrCEx44dP13jW3RVkYiS' // 不用翻墙期权
]);

export const DEFAULT_UNIVERSE = Object.freeze(['IREN', 'SOXL', 'MU', 'CRWV', 'COHR']);
export const DEFAULT_DELTA_MINS = Object.freeze([0, 1, 3, 5]);
export const BAR_TZ = 'America/New_York';
export const METHOD_LABEL = 'delayed_follow_e_v0_hypothesized_arrival';

/**
 * Provisional A/B/C stub. Thresholds sit in ONE place.
 * Mapped loosely to FOLLOW_SPEC FIRE/REJECT (20/40bp) and CHG-051 wording:
 *   A = reconnect-pull if still close (adverse ≤ 20bp or favorable)
 *   B = limited-slip chase (20bp < adverse ≤ 40bp)
 *   C = abandon on excess slip (adverse > 40bp)
 * Fill for A/B is always px_arrive (bar open), never px_zhao.
 * Do NOT reverse-infer fill seconds from bar high/low.
 */
export const DELAYED_FOLLOW_POLICY = Object.freeze({
  policy_id: 'delayed_follow_abc_stub_v0',
  policy_status: 'provisional',
  slip_ref: 'px_zhao',
  px_arrive_source: 'bar_open_containing_t_arrive_hat',
  A_ADVERSE_SLIP_MAX_BPS: 20,
  B_ADVERSE_SLIP_MAX_BPS: 40,
  EXIT_HORIZON_BARS: 12,
  COST_BPS_ROUND_TRIP: 10,
  notes: [
    'Thresholds cite follow_execution_spec FIRE/REJECT 20/40bp (FOLLOW_SPEC).',
    'CHG-051 B is limited-slip chase, not SIZE_DOWN; this stub fills A/B at px_arrive full size.',
    'Not live Intent. Not wired to HUD / L2a / place_order.',
    'A/B fill price = hypothesized bar open, never oral px_zhao.',
    'Bar range (high/low) is not used as fill evidence.'
  ]
});

const MS_THRESHOLD = 1e12;
const BUY_ACTIONS = new Set(['BUY', 'ADD', 'OPEN', 'COVER']);

export function parseDeltaMins(raw) {
  const src = raw == null || raw === '' ? DEFAULT_DELTA_MINS : String(raw).split(',');
  const out = [];
  for (const token of src) {
    const n = Number(String(token).trim());
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`invalid delta-mins token: ${token}`);
    }
    out.push(n);
  }
  if (!out.length) throw new Error('delta-mins empty');
  return out;
}

export function parseSymbols(raw) {
  const src = raw == null || raw === '' ? DEFAULT_UNIVERSE : String(raw).split(',');
  const out = [];
  for (const token of src) {
    const s = String(token).trim().toUpperCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  if (!out.length) throw new Error('symbols empty');
  return out;
}

export function toMillis(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return n >= MS_THRESHOLD ? n : n * 1000;
}

export function hypothesizedArrivalMs(tMsg, deltaMin) {
  const t = toMillis(tMsg);
  const d = Number(deltaMin);
  if (!Number.isFinite(t) || !Number.isFinite(d) || d < 0) {
    throw new Error('hypothesizedArrivalMs: t_msg and delta_min must be finite, delta_min ≥ 0');
  }
  return t + d * 60 * 1000;
}

export function barIntervalMs(interval) {
  const key = String(interval || '5m').toLowerCase();
  const m = key.match(/^(\d+)(m|h)$/);
  if (!m) throw new Error(`unsupported bar interval: ${interval}`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600 * 1000 : n * 60 * 1000;
}

export function formatInTz(ms, timeZone = BAR_TZ) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * Convert an America/New_York wall clock to UTC ms (DST-safe).
 */
export function etWallClockToUtcMs(etDate, hhmmss = '09:30:00') {
  const [y, mo, d] = String(etDate).split('-').map(Number);
  const [hh, mm, ss] = String(hhmmss).split(':').map(Number);
  if (![y, mo, d, hh, mm].every(Number.isFinite)) {
    throw new Error(`etWallClockToUtcMs: bad date/time ${etDate} ${hhmmss}`);
  }
  const asUtc = Date.UTC(y, mo - 1, d, hh, mm, ss || 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BAR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const wallAsUtc = (ms) => {
    const parts = dtf.formatToParts(new Date(ms));
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };
  const offset = wallAsUtc(asUtc) - asUtc;
  let utc = asUtc - offset;
  utc -= wallAsUtc(utc) - asUtc;
  return utc;
}

export const SESSION_ANCHOR_ET = Object.freeze({
  regular: '09:30:00',
  pre_market: '04:00:00',
  post_market: '16:00:00',
  overnight: '20:00:00'
});

export function sessionAnchorMs(etDate, etSession) {
  const key = String(etSession || 'regular').toLowerCase();
  const clock = SESSION_ANCHOR_ET[key] || SESSION_ANCHOR_ET.regular;
  return etWallClockToUtcMs(etDate, clock);
}

export function isAllowedChannel(channelId) {
  if (!channelId) return false;
  return TRADE_SIGNAL_CHANNELS.includes(String(channelId));
}

export function isZhaoSpeaker(row) {
  const id = row?.speaker_id || row?.sender_id || '';
  if (id) return id === ZHAO_SPEAKER_ID;
  const name = String(row?.speaker_name || row?.sender_name || '').toLowerCase();
  if (name) return name === ZHAO_SPEAKER_NAME;
  return false;
}

export function normalizeSide(action) {
  const a = String(action || '').toUpperCase();
  if (BUY_ACTIONS.has(a)) return 'BUY';
  return null;
}

/**
 * Last bar with bar.time ≤ tMs that still covers tMs in [time, time+intervalMs).
 * Does not search high/low for "price appeared".
 */
export function findBarContaining(bars, tMs, intervalMs) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const t = toMillis(tMs);
  if (!Number.isFinite(t) || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  let lo = 0;
  let hi = bars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bt = toMillis(bars[mid].time);
    if (bt <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const bar = bars[best];
  const bt = toMillis(bar.time);
  if (t < bt || t >= bt + intervalMs) return null;
  return bar;
}

export function pxArriveFromBar(bar) {
  if (!bar) return null;
  const px = Number(bar.open);
  if (!Number.isFinite(px) || px <= 0) return null;
  return px;
}

/** Signed slip vs oral px_zhao. BUY: + if arrive > zhao (adverse). */
export function signedSlipBps(side, pxZhao, pxArrive) {
  const z = Number(pxZhao);
  const a = Number(pxArrive);
  if (!Number.isFinite(z) || z <= 0 || !Number.isFinite(a) || a <= 0) return null;
  const raw = ((a - z) / z) * 10000;
  const signed = side === 'SELL' ? -raw : raw;
  return round2(signed);
}

export function adverseSlipBps(signed) {
  if (signed == null || !Number.isFinite(signed)) return null;
  return Math.max(0, signed);
}

export function decideExecAbc(side, pxZhao, pxArrive, policy = DELAYED_FOLLOW_POLICY) {
  const signed = signedSlipBps(side, pxZhao, pxArrive);
  if (signed == null) {
    return {
      exec_policy: 'NO_PX',
      exec_policy_label: 'missing_price',
      slip_bps: null,
      adverse_slip_bps: null,
      exec_px: null
    };
  }
  const adverse = adverseSlipBps(signed);
  const aMax = policy.A_ADVERSE_SLIP_MAX_BPS;
  const bMax = policy.B_ADVERSE_SLIP_MAX_BPS;
  let exec_policy;
  let exec_policy_label;
  if (adverse <= aMax) {
    exec_policy = 'A';
    exec_policy_label = 'reconnect_pull';
  } else if (adverse <= bMax) {
    exec_policy = 'B';
    exec_policy_label = 'limited_slip_chase';
  } else {
    exec_policy = 'C';
    exec_policy_label = 'abandon_excess_slip';
  }
  return {
    exec_policy,
    exec_policy_label,
    slip_bps: round2(signed),
    adverse_slip_bps: round2(adverse),
    exec_px: exec_policy === 'C' ? null : Number(pxArrive)
  };
}

export function stubExitAndCosts(bars, arriveBar, pxArrive, intervalMs, policy = DELAYED_FOLLOW_POLICY) {
  if (!arriveBar || !Number.isFinite(Number(pxArrive)) || pxArrive <= 0) {
    return { exit: null, costs: null };
  }
  const idx = bars.indexOf(arriveBar);
  const horizon = policy.EXIT_HORIZON_BARS;
  const exitBar = idx >= 0 ? bars[Math.min(bars.length - 1, idx + horizon)] : null;
  const exitPx = exitBar && Number.isFinite(Number(exitBar.close)) ? Number(exitBar.close) : null;
  const exitRet = exitPx != null ? ((exitPx - pxArrive) / pxArrive) * 10000 : null;
  const cost = policy.COST_BPS_ROUND_TRIP;
  return {
    exit: {
      kind: 'stub_horizon_bar_close',
      horizon_bars: horizon,
      interval_ms: intervalMs,
      exit_px: exitPx,
      exit_bar_time: exitBar ? toMillis(exitBar.time) : null,
      exit_ret_bps: exitRet == null ? null : round2(exitRet),
      note: 'Exit is a modeled stub, reported separately from entry/slip. Not a strategy.'
    },
    costs: {
      kind: 'modeled_round_trip',
      cost_bps: cost,
      residual_after_costs_bps: exitRet == null ? null : round2(exitRet - cost),
      note: 'Modeled costs only; not broker fees or Zhao PnL.'
    }
  };
}

export function buildEventRow({
  buyEvent,
  bars,
  deltaMin,
  interval = '5m',
  barSource = 'fixture',
  includePrepost = false,
  policy = DELAYED_FOLLOW_POLICY
}) {
  const intervalMs = barIntervalMs(interval);
  const tMsg = toMillis(buyEvent.t_msg);
  const tHat = hypothesizedArrivalMs(tMsg, deltaMin);
  const bar = findBarContaining(bars, tHat, intervalMs);
  const pxArrive = pxArriveFromBar(bar);
  const pxZhao = Number(buyEvent.px_zhao);

  let decision;
  if (!bar || pxArrive == null) {
    decision = {
      exec_policy: 'NO_BAR',
      exec_policy_label: 'no_bar_at_t_arrive_hat',
      slip_bps: null,
      adverse_slip_bps: null,
      exec_px: null
    };
  } else {
    decision = decideExecAbc(buyEvent.side || 'BUY', pxZhao, pxArrive, policy);
  }

  const filled = decision.exec_policy === 'A' || decision.exec_policy === 'B';
  const { exit, costs } = filled
    ? stubExitAndCosts(bars, bar, pxArrive, intervalMs, policy)
    : { exit: null, costs: null };

  const row = {
    schema: 'delayed_follow_e_v0',
    method: METHOD_LABEL,
    event_id: buyEvent.event_id || null,
    symbol: buyEvent.symbol,
    side: buyEvent.side || 'BUY',
    t_msg: tMsg,
    t_msg_iso: new Date(tMsg).toISOString(),
    t_msg_et: formatInTz(tMsg),
    t_msg_kind: buyEvent.t_msg_kind || 'message_clock',
    t_msg_tz: BAR_TZ,
    px_zhao: pxZhao,
    delta_min: Number(deltaMin),
    t_arrive_hat: tHat,
    t_arrive_hat_iso: new Date(tHat).toISOString(),
    t_arrive_hat_et: formatInTz(tHat),
    arrival_kind: 'hypothesized',
    px_arrive: pxArrive,
    px_arrive_source: pxArrive == null ? null : policy.px_arrive_source,
    bar_time: bar ? toMillis(bar.time) : null,
    bar_time_iso: bar ? new Date(toMillis(bar.time)).toISOString() : null,
    bar_interval: interval,
    bar_source: barSource,
    include_prepost: Boolean(includePrepost),
    exec_policy: decision.exec_policy,
    exec_policy_label: decision.exec_policy_label,
    slip_bps: decision.slip_bps,
    adverse_slip_bps: decision.adverse_slip_bps,
    exec_px: decision.exec_px,
    exec_px_kind: filled ? 'hypothesized_bar_open' : null,
    exit,
    costs,
    policy_id: policy.policy_id,
    policy_status: policy.policy_status,
    speaker_id: buyEvent.speaker_id || null,
    channel_id: buyEvent.channel_id || null,
    claims_not_made: [
      'not_observed_t_arrive',
      'not_autonomous_alpha',
      'not_zhao_own_pnl',
      'not_industrial_self_funding',
      'no_invented_t_fill'
    ]
  };
  return row;
}

export function sweepEvent(buyEvent, bars, deltaMins, opts = {}) {
  return deltaMins.map((d) => buildEventRow({ ...opts, buyEvent, bars, deltaMin: d }));
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function mean(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bySymbol = {};
  const byDelta = {};

  for (const r of list) {
    const sym = r.symbol;
    bySymbol[sym] = bySymbol[sym] || { n_buy_events: new Set(), n_rows: 0 };
    if (r.event_id) bySymbol[sym].n_buy_events.add(r.event_id);
    else bySymbol[sym].n_buy_events.add(`${r.symbol}|${r.t_msg}|${r.px_zhao}`);
    bySymbol[sym].n_rows += 1;

    const d = String(r.delta_min);
    byDelta[d] = byDelta[d] || [];
    byDelta[d].push(r);
  }

  const perSymbol = {};
  for (const [sym, v] of Object.entries(bySymbol)) {
    perSymbol[sym] = { n_events: v.n_buy_events.size, n_rows: v.n_rows };
  }

  const perDelta = {};
  for (const [d, rs] of Object.entries(byDelta)) {
    const scored = rs.filter((r) => r.exec_policy === 'A' || r.exec_policy === 'B' || r.exec_policy === 'C');
    const n = scored.length;
    const nA = scored.filter((r) => r.exec_policy === 'A').length;
    const nB = scored.filter((r) => r.exec_policy === 'B').length;
    const nC = scored.filter((r) => r.exec_policy === 'C').length;
    const nNoBar = rs.filter((r) => r.exec_policy === 'NO_BAR').length;
    const slips = scored.map((r) => r.slip_bps);
    const residuals = scored
      .filter((r) => r.exec_policy === 'A' || r.exec_policy === 'B')
      .map((r) => r.costs?.residual_after_costs_bps);
    perDelta[d] = {
      n_rows: rs.length,
      n_scored: n,
      n_A: nA,
      n_B: nB,
      n_C: nC,
      n_no_bar: nNoBar,
      A_rate: n ? nA / n : null,
      B_rate: n ? nB / n : null,
      C_rate: n ? nC / n : null,
      mean_slip_bps: mean(slips) == null ? null : round2(mean(slips)),
      median_slip_bps: median(slips) == null ? null : round2(median(slips)),
      mean_residual_after_costs_bps: mean(residuals) == null ? null : round2(mean(residuals)),
      median_residual_after_costs_bps: median(residuals) == null ? null : round2(median(residuals))
    };
  }

  return {
    n_rows: list.length,
    n_events: new Set(list.map((r) => r.event_id || `${r.symbol}|${r.t_msg}|${r.px_zhao}`)).size,
    per_symbol: perSymbol,
    per_delta: perDelta
  };
}

export function assertNoOralPriceLeakage(row) {
  if (row.px_arrive != null && Number(row.px_arrive) === Number(row.px_zhao) && row.exec_policy !== 'NO_BAR') {
    if (row.px_arrive_source === 'px_zhao' || row.px_arrive_source === 'oral') {
      throw new Error('oral price leakage: px_arrive sourced from px_zhao');
    }
  }
  if (Object.prototype.hasOwnProperty.call(row, 't_fill')) {
    throw new Error('forbidden field t_fill');
  }
  if (Object.prototype.hasOwnProperty.call(row, 't_arrive')) {
    throw new Error('forbidden field t_arrive (use t_arrive_hat)');
  }
  if (row.arrival_kind !== 'hypothesized') {
    throw new Error('arrival_kind must be hypothesized');
  }
  return true;
}

function parseL2aActions(obj) {
  const parsed = obj.parsed || obj;
  const actions = parsed.actions || obj.actions || [];
  return Array.isArray(actions) ? actions : [];
}

export function buyEventFromNormalized(raw, symbols) {
  if (raw.speaker_id && raw.speaker_id !== ZHAO_SPEAKER_ID) return null;
  if (raw.sender_id && raw.sender_id !== ZHAO_SPEAKER_ID) return null;
  const symbol = String(raw.symbol || raw.ticker || '').toUpperCase();
  if (symbols && !symbols.includes(symbol)) return null;
  const side = normalizeSide(raw.side || raw.action);
  if (side !== 'BUY') return null;
  const px = Number(raw.px_zhao ?? raw.price ?? raw.call_price);
  if (!Number.isFinite(px) || px <= 0) return null;
  const tMsg = toMillis(raw.t_msg ?? raw.created_at ?? raw.msg_created_at);
  if (!Number.isFinite(tMsg)) return null;
  return {
    event_id: raw.event_id || raw.signal_id || `${symbol}_${tMsg}_${px}`,
    symbol,
    side,
    t_msg: tMsg,
    t_msg_kind: raw.t_msg_kind || 'message_clock',
    px_zhao: px,
    speaker_id: raw.speaker_id || raw.sender_id || null,
    channel_id: raw.channel_id || raw.channel || null,
    source: raw.source || 'jsonl'
  };
}

export function extractBuysFromL2aRecord(obj, symbols) {
  const channel = obj.channel || obj.channel_id || obj.feed_id;
  if (!isAllowedChannel(channel)) return [];
  const etDate = obj.et_date;
  if (!etDate) return [];
  const tMsg = sessionAnchorMs(etDate, obj.et_session || 'regular');
  const out = [];
  for (const act of parseL2aActions(obj)) {
    const side = normalizeSide(act.action);
    if (side !== 'BUY') continue;
    const status = String(act.status || '').toLowerCase();
    if (status && status !== 'filled') continue;
    const symbol = String(act.ticker || '').toUpperCase();
    if (symbols && !symbols.includes(symbol)) continue;
    const px = Number(act.price);
    if (!Number.isFinite(px) || px <= 0) continue;
    out.push({
      event_id: `${obj.cu_id || 'l2a'}_${symbol}_${tMsg}_${px}`,
      symbol,
      side: 'BUY',
      t_msg: tMsg,
      t_msg_kind: 'session_anchor',
      px_zhao: px,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: channel || TRADE_SIGNAL_CHANNELS[0],
      source: 'l2a_ledger',
      et_date: etDate,
      et_session: obj.et_session || 'regular'
    });
  }
  return out;
}

export function loadBuyEventsFromJsonlLines(lines, { symbols, requireZhaoLock = false } = {}) {
  const events = [];
  for (const line of lines) {
    const s = String(line).trim();
    if (!s || s.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    if (obj.parsed || (obj.et_date && (obj.channel || obj.channel_id))) {
      events.push(...extractBuysFromL2aRecord(obj, symbols));
      continue;
    }
    if (obj.speaker_id && obj.speaker_id !== ZHAO_SPEAKER_ID) continue;
    if (obj.sender_id && obj.sender_id !== ZHAO_SPEAKER_ID) continue;
    const ev = buyEventFromNormalized(obj, symbols);
    if (ev) {
      if (!isAllowedChannel(ev.channel_id)) continue;
      events.push(ev);
    }
  }
  return dedupeBuys(events);
}

export function loadBuyEventsFromSqliteRows(rows, { symbols } = {}) {
  const events = [];
  for (const row of rows || []) {
    if (row.speaker_id && row.speaker_id !== ZHAO_SPEAKER_ID) continue;
    if (row.channel_id && !isAllowedChannel(row.channel_id)) continue;
    const ev = buyEventFromNormalized(
      {
        event_id: row.signal_id,
        symbol: row.ticker,
        action: row.action,
        px_zhao: row.price,
        t_msg: row.created_at,
        t_msg_kind: 'message_clock',
        speaker_id: row.speaker_id || ZHAO_SPEAKER_ID,
        channel_id: row.channel_id,
        source: 'trade_signals'
      },
      symbols
    );
    if (ev) events.push(ev);
  }
  return dedupeBuys(events);
}

export function sqliteBuyQuery() {
  return `
    SELECT signal_id, ticker, action, price, created_at, speaker_id, channel_id, message_id
    FROM trade_signals
    WHERE speaker_id = ?
      AND action IN ('BUY', 'ADD', 'OPEN')
      AND price > 0
      AND channel_id IN (?, ?)
    ORDER BY created_at ASC
  `;
}

function dedupeBuys(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const k = `${e.symbol}|${e.t_msg}|${e.px_zhao}|${e.event_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export function filterLookback(events, lookbackDays, nowMs = Date.now()) {
  if (!lookbackDays) return events;
  const minT = nowMs - Number(lookbackDays) * 86400 * 1000;
  return events.filter((e) => e.t_msg >= minT);
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
