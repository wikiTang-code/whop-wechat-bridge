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
import { getRouteCoverageSnapshot } from './route-coverage-probe.js';
import { getTunnelStatus } from './tunnel-launcher.js';

let aiTunnelGetter = null;
let ingestHeartbeatDbGetter = null;
let routeCoverageEnabled = false;

/** Optional injector from P0-4 circuit breaker */
export function registerAiTunnelHealthGetter(fn) {
  aiTunnelGetter = typeof fn === 'function' ? fn : null;
}

/** Web 进程注入只读 monitoring.db，避免误开写连接 */
export function registerIngestHeartbeatDbGetter(fn) {
  ingestHeartbeatDbGetter = typeof fn === 'function' ? fn : null;
}

/** 仅 web_dashboard 启用 routeCoverage 子系统（避免 ingest 误报） */
export function setRouteCoverageHealthEnabled(enabled) {
  routeCoverageEnabled = Boolean(enabled);
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
    tunnel: getTunnelStatus(),
  };

  if (shouldExposeIngestHeartbeat()) {
    const dbInstance = ingestHeartbeatDbGetter ? ingestHeartbeatDbGetter() : null;
    const hb = getIngestHeartbeat('primary', dbInstance ? { dbInstance } : {});
    subsystems.ingest = {
      status: hb.status || 'critical',
      ...hb,
    };
  }

  if (routeCoverageEnabled || process.env.ROLE === 'web_dashboard') {
    subsystems.routeCoverage = getRouteCoverageSnapshot();
  }

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
    subsystems.pushPipeline.status === 'critical' ||
    subsystems.routeCoverage?.status === 'warn' ||
    subsystems.routeCoverage?.status === 'critical' ||
    subsystems.tunnel?.status === 'warn'
  ) {
    // routeCoverage 只抬 overall 到 warn，不单独把 /health 打成 503（看门狗 page_smoke 负责硬告警）
    overall = 'warn';
  }

  return {
    ok: overall === 'ok',
    status: overall,
    ts: new Date().toISOString(),
    subsystems,
  };
}
