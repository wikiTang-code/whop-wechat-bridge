/**
 * P0-3: Read-only health aggregator for GET /health.
 * Never writes whop_archive.db. Optional AI tunnel status injected later (P0-4).
 */
import { getEventLoopSnapshot } from './event-loop-probe.js';
import { getAlertSinkStats } from './alert-sink.js';
import { getQueueSnapshot } from './queue-watermark-probe.js';
import { getMonitoringDbStats, getIngestHeartbeat } from './monitoring-db.js';
import { getAssetFreshnessSnapshot } from './asset-freshness-probe.js';
import { getPushPipelineSnapshot } from './push-latency-probe.js';

let aiTunnelGetter = null;

/** Optional injector from P0-4 circuit breaker */
export function registerAiTunnelHealthGetter(fn) {
  aiTunnelGetter = typeof fn === 'function' ? fn : null;
}

function shouldExposeIngestHeartbeat() {
  const role = process.env.ROLE || '';
  return role === 'web_dashboard' || process.env.INGEST_HEARTBEAT_REQUIRED === '1';
}

export function buildHealthPayload() {
  const eventLoop = getEventLoopSnapshot();
  const aiTunnel = aiTunnelGetter ? aiTunnelGetter() : { enabled: false, status: 'unknown' };
  const alerts = getAlertSinkStats();
  const queues = getQueueSnapshot();
  const monDbStats = getMonitoringDbStats();
  const assets = getAssetFreshnessSnapshot();
  const pushPipeline = getPushPipelineSnapshot();

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
    assets: {
      status: assets.status || 'ok',
      ...assets,
    },
    monitoringDb: {
      status: monDbStats.status || 'ok',
      ...monDbStats,
    },
    pushPipeline: {
      status: pushPipeline.status || 'ok',
      ...pushPipeline,
    },
    alerts: {
      status: 'ok',
      ...alerts,
    },
  };

  // 仅 web 拆分模式要求跨进程 ingest 心跳；单体部署不启用，避免无写心跳时误 503
  if (shouldExposeIngestHeartbeat()) {
    const hb = getIngestHeartbeat('primary');
    subsystems.ingest = {
      status: hb.status || 'critical',
      ...hb,
    };
  }

  // 运行时 critical：eventLoop / process；拆分模式下 ingest critical 也抬升为 critical（对外 503）
  const runtimeLevels = [subsystems.process.status, subsystems.eventLoop.status];
  if (subsystems.ingest) runtimeLevels.push(subsystems.ingest.status);

  let overall = 'ok';
  if (runtimeLevels.includes('critical') || runtimeLevels.includes('down')) {
    overall = 'critical';
  } else if (
    runtimeLevels.includes('warn') ||
    subsystems.queues.status === 'warn' ||
    subsystems.assets.status === 'warn' ||
    subsystems.assets.status === 'critical' ||
    subsystems.pushPipeline.status === 'warn' ||
    subsystems.pushPipeline.status === 'critical'
  ) {
    overall = 'warn';
  }

  return {
    ok: overall === 'ok',
    status: overall,
    ts: new Date().toISOString(),
    subsystems,
  };
}
