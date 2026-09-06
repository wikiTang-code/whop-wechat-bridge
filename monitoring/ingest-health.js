/**
 * @file monitoring/ingest-health.js
 * @description P1-11: Ingest 心跳状态机（薄封装，核心逻辑统一走 ingest-liveness.js）
 */
import { evaluateIngestLiveness } from './ingest-liveness.js';

/**
 * @param {{ heartbeat?: object|null, nowMs?: number }} opts
 */
export function evaluateIngestStatus({ heartbeat = null, nowMs = Date.now() } = {}) {
  const exists = !!(heartbeat && heartbeat.exists);
  const delayMs = exists
    ? Math.max(0, nowMs - (heartbeat.updatedAtMs || heartbeat.updated_at_ms || 0))
    : null;

  const live = evaluateIngestLiveness({ exists, delayMs });

  return {
    status: live.status,
    delaySec: live.delaySec,
    delayMs: live.delayMs,
    description: live.description,
    httpStatus: live.httpSuggest,
    thresholds: live.thresholds,
    heartbeat: exists ? heartbeat : null,
  };
}

export { evaluateIngestLiveness };
