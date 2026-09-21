/**
 * CHG-052 — observed arrival clock for live ingest / Intent create.
 * Historical backtest stays on t_arrive_hat (REQ-058 hypothesized path).
 * Never copy oral/px_zhao or K-line/bar-open into px_arrive.
 */

export const ARRIVAL_KIND_OBSERVED = 'observed';

const FORBIDDEN_PX_ARRIVE_SOURCE = /oral|px_zhao|kline|bar[._\s-]?open|yahoo|session_anchor/;
const ALLOWED_PX_ARRIVE_SOURCE = new Set(['quote', 'poll_seen', 'broker_quote', 'observed']);

export function resolveObservedArrivalClock({ t_arrive, now = Date.now() } = {}) {
  const n = Number(t_arrive);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return now;
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

export function stampObservedArrival(fields = {}, now = Date.now()) {
  const pxZhaoRaw = Number(fields.px_zhao);
  const px = resolveObservedPxArrive(fields);
  return {
    t_arrive: resolveObservedArrivalClock({ t_arrive: fields.t_arrive, now }),
    t_arrive_kind: ARRIVAL_KIND_OBSERVED,
    px_zhao: Number.isFinite(pxZhaoRaw) && pxZhaoRaw > 0 ? pxZhaoRaw : null,
    px_arrive: px.px_arrive,
    px_arrive_source: px.px_arrive_source
  };
}
