/**
 * CHG-052 / CHG-054 — observed arrival clock for live ingest / Intent create.
 * Historical backtest stays on t_arrive_hat (REQ-058 hypothesized path).
 * Never copy oral/px_zhao or K-line/bar-open into px_arrive.
 * CHG-054: persist first-see (poll-seen); do not invent t_arrive on historical sources.
 */

export const ARRIVAL_KIND_OBSERVED = 'observed';

export const HISTORICAL_SIGNAL_SOURCES = new Set([
  'manual_correct',
  'manual_correct_verified',
  'paired_sync',
  'historical',
  'replay',
  'historical_pair'
]);

const FORBIDDEN_PX_ARRIVE_SOURCE = /oral|px_zhao|kline|bar[._\s-]?open|yahoo|session_anchor/;
const ALLOWED_PX_ARRIVE_SOURCE = new Set(['quote', 'poll_seen', 'broker_quote', 'observed']);

export function isHistoricalSignalSource(source) {
  return HISTORICAL_SIGNAL_SOURCES.has(String(source || '').trim());
}

export function resolveObservedArrivalClock({ t_arrive, now = Date.now(), inventIfMissing = true } = {}) {
  const n = Number(t_arrive);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return inventIfMissing ? now : null;
}

export function resolveObservedPxArrive({ px_arrive, px_arrive_source } = {}) {
  const src = String(px_arrive_source || '').trim();
  if (!src) return { px_arrive: null, px_arrive_source: null };
  const srcKey = src.toLowerCase();
  if (FORBIDDEN_PX_ARRIVE_SOURCE.test(srcKey) || !ALLOWED_PX_ARRIVE_SOURCE.has(srcKey)) {
    return { px_arrive: null, px_arrive_source: null };
  }
  const px = Number(px_arrive);
  if (!Number.isFinite(px) || px <= 0) {
    return { px_arrive: null, px_arrive_source: null };
  }
  return { px_arrive: px, px_arrive_source: srcKey };
}

export function stampPollSeenOnNewMessages(messages, now = Date.now()) {
  if (!Array.isArray(messages)) return now;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const existing = Number(msg.poll_seen_at || msg.t_arrive);
    if (Number.isFinite(existing) && existing > 0) continue;
    msg.poll_seen_at = now;
  }
  return now;
}

export function stampObservedArrival(fields = {}, now = Date.now(), opts = {}) {
  const inventIfMissing = opts.inventIfMissing !== false;
  const pxZhaoRaw = Number(fields.px_zhao);
  const px = resolveObservedPxArrive(fields);
  const tArrive = resolveObservedArrivalClock({
    t_arrive: fields.t_arrive,
    now,
    inventIfMissing
  });
  return {
    t_arrive: tArrive,
    t_arrive_kind: tArrive != null ? ARRIVAL_KIND_OBSERVED : null,
    px_zhao: Number.isFinite(pxZhaoRaw) && pxZhaoRaw > 0 ? pxZhaoRaw : null,
    px_arrive: px.px_arrive,
    px_arrive_source: px.px_arrive_source
  };
}
