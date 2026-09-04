/**
 * P0-3: Read-only health aggregator for GET /health.
 * Never writes whop_archive.db. Optional AI tunnel status injected later (P0-4).
 */
import { getEventLoopSnapshot } from './event-loop-probe.js';
import { getAlertSinkStats } from './alert-sink.js';
import { getQueueSnapshot } from './queue-watermark-probe.js';
import { getMonitoringDbStats } from './monitoring-db.js';

let aiTunnelGetter = null;

/** Optional injector from P0-4 circuit breaker */
export function registerAiTunnelHealthGetter(fn) {
  aiTunnelGetter = typeof fn === 'function' ? fn : null;
}

export function buildHealthPayload() {
  const eventLoop = getEventLoopSnapshot();
  const aiTunnel = aiTunnelGetter ? aiTunnelGetter() : { enabled: false, status: 'unknown' };
  const alerts = getAlertSinkStats();
  const queues = getQueueSnapshot();
  const monDbStats = getMonitoringDbStats();

  const subsystems = {
    process: {
      status: 'ok',
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    eventLoop: {
      status: eventLoop.level || 'unknown',
      ...eventLoop,
    },
    aiTunnel: {
      status: aiTunnel.status || aiTunnel.level || 'unknown',
      ...aiTunnel,
    },
    queues: {
      status: queues.status || 'ok',
      ...queues,
    },
    monitoringDb: {
      status: monDbStats.status || 'ok',
      ...monDbStats,
    },
    alerts: {
      status: 'ok',
      ...alerts,
    },
  };

  const levels = Object.values(subsystems).map((s) => s.status);
  let overall = 'ok';
  if (levels.includes('critical') || levels.includes('open') || levels.includes('down')) {
    overall = 'critical';
  } else if (levels.includes('warn') || levels.includes('half-open')) {
    overall = 'warn';
  }

  return {
    ok: overall === 'ok',
    status: overall,
    ts: new Date().toISOString(),
    subsystems,
  };
}
