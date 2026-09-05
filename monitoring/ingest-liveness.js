/**
 * @file monitoring/ingest-liveness.js
 * @description P1-11: Ingest 心跳延迟 → ok/warn/critical（纯函数，供 /health 与单测）
 *
 * 阈值对齐修订设计：
 * - delay < 90s  → ok（覆盖 60s 温和轮询）
 * - 90–180s      → warn（覆盖背压 120s）
 * - ≥ 180s / 无心跳 → critical（整体 /health 应 503）
 */

export const INGEST_LIVENESS_DEFAULTS = {
  warnMs: 90_000,
  criticalMs: 180_000,
};

/**
 * @param {{ delayMs: number|null, exists?: boolean }} input
 * @param {{ warnMs?: number, criticalMs?: number }} [thresholds]
 */
export function evaluateIngestLiveness(input = {}, thresholds = {}) {
  const warnMs = thresholds.warnMs ?? INGEST_LIVENESS_DEFAULTS.warnMs;
  const criticalMs = thresholds.criticalMs ?? INGEST_LIVENESS_DEFAULTS.criticalMs;
  const exists = input.exists !== false && input.delayMs != null;
  const delayMs = exists ? Number(input.delayMs) : null;

  if (!exists || delayMs == null || Number.isNaN(delayMs)) {
    return {
      status: 'critical',
      delayMs: null,
      delaySec: null,
      httpSuggest: 503,
      description: '未检测到 Ingest 心跳',
      thresholds: { warnMs, criticalMs },
    };
  }

  if (delayMs >= criticalMs) {
    return {
      status: 'critical',
      delayMs,
      delaySec: Math.round((delayMs / 1000) * 10) / 10,
      httpSuggest: 503,
      description: `Ingest 心跳停滞 ${Math.round(delayMs / 1000)}s`,
      thresholds: { warnMs, criticalMs },
    };
  }

  if (delayMs >= warnMs) {
    return {
      status: 'warn',
      delayMs,
      delaySec: Math.round((delayMs / 1000) * 10) / 10,
      httpSuggest: 200,
      description: `Ingest 心跳延迟 ${Math.round(delayMs / 1000)}s（背压/慢轮询可观测）`,
      thresholds: { warnMs, criticalMs },
    };
  }

  return {
    status: 'ok',
    delayMs,
    delaySec: Math.round((delayMs / 1000) * 10) / 10,
    httpSuggest: 200,
    description: `Ingest 心跳正常（${Math.round(delayMs / 1000)}s 前）`,
    thresholds: { warnMs, criticalMs },
  };
}
