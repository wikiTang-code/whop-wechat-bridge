/**
 * @file monitoring/ingest-health.js
 * @description P1-11: Ingest 进程心跳状态机判定纯函数
 *
 * 状态机规范 (docs/p1-11-multiprocess-design.md §5.3):
 * - delay < 90s            -> status: 'ok'       (覆盖 60s 温和轮询 + 抖动)
 * - 90s <= delay < 180s    -> status: 'warn'     (覆盖背压 120s 档)
 * - delay >= 180s (或不存在) -> status: 'critical' (假死超时，驱动 /health 返回 HTTP 503)
 */

export function evaluateIngestStatus({ heartbeat = null, nowMs = Date.now() } = {}) {
  if (!heartbeat || !heartbeat.exists) {
    return {
      status: 'critical',
      delaySec: null,
      description: '未检测到 Ingest 心跳记录（Worker 可能未启动）',
      httpStatus: 503,
      heartbeat: null,
    };
  }

  const delayMs = Math.max(0, nowMs - (heartbeat.updatedAtMs || 0));
  const delaySec = Math.round((delayMs / 1000) * 10) / 10;

  if (delaySec < 90) {
    return {
      status: 'ok',
      delaySec,
      description: `Ingest 心跳活跃 (延迟 ${delaySec}s < 90s)`,
      httpStatus: 200,
      heartbeat,
    };
  }

  if (delaySec < 180) {
    return {
      status: 'warn',
      delaySec,
      description: `Ingest 心跳延迟偏高 (延迟 ${delaySec}s，位于 90s~180s 预警区间)`,
      httpStatus: 200,
      heartbeat,
    };
  }

  return {
    status: 'critical',
    delaySec,
    description: `Ingest 心跳假死超时 (延迟 ${delaySec}s >= 180s)`,
    httpStatus: 503,
    heartbeat,
  };
}
