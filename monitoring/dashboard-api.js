/**
 * @file monitoring/dashboard-api.js
 * @description P2-11: 健康看板只读聚合 API 契约实现 (GET /api/monitoring/dashboard)
 *
 * 契约规范: docs/p2-11-health-dashboard-wireframe.md §4
 * 严格只读: 绝不触发任何写操作，只读读取 /health 状态快照与 monitoring.db 时序
 */

import { buildHealthPayload, registerIngestHeartbeatDbGetter } from './health.js';
import { getEasternTimeParts, isWeekendOrHoliday } from './market-calendar.js';
import { formatBeijingTime } from './alert-sink.js';
import { getReadOnlyMonitoringDb } from './db-readonly.js';
import { getIngestHeartbeat } from './monitoring-db.js';
import { evaluateIngestStatus } from './ingest-health.js';

// 看板聚合也强制只读读心跳
registerIngestHeartbeatDbGetter(() => getReadOnlyMonitoringDb());

export function getDashboardPayload({ nowMs = Date.now() } = {}) {
  const healthSnap = buildHealthPayload();
  const et = getEasternTimeParts(new Date(nowMs));
  const isClosed = isWeekendOrHoliday(new Date(nowMs));

  // 1. Ingest 进程心跳与内存读取
  const monDb = getReadOnlyMonitoringDb();
  let heartbeat = null;
  let ingestHealth = { status: 'ok', delaySec: 0, description: '未配置独立 Ingest' };
  let ingestRssMb = null;

  if (monDb) {
    heartbeat = getIngestHeartbeat('primary', { dbInstance: monDb, nowMs });
    ingestHealth = evaluateIngestStatus({ heartbeat, nowMs });

    if (heartbeat?.detail) {
      const detail = heartbeat.detail;
      const parsed = detail.rssMb ?? detail.memoryRssMb;
      if (typeof parsed === 'number' && !isNaN(parsed)) {
        ingestRssMb = Math.round(parsed * 10) / 10;
      }
    } else if (heartbeat?.detail_json) {
      try {
        const detail = typeof heartbeat.detail_json === 'string'
          ? JSON.parse(heartbeat.detail_json)
          : heartbeat.detail_json;
        const parsed = detail?.rssMb ?? detail?.memoryRssMb;
        if (typeof parsed === 'number' && !isNaN(parsed)) {
          ingestRssMb = Math.round(parsed * 10) / 10;
        }
      } catch (_) {}
    }
  }

  // 2. 双进程 Memory 计算 (遵守空值语义：ingest 缺失则 combinedRssMb = null)
  const mem = process.memoryUsage();
  const webRssMb = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
  const heapUsedMb = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
  const budgetMb = 958.0;

  const combinedRssMb = ingestRssMb !== null ? Math.round((webRssMb + ingestRssMb) * 10) / 10 : null;
  const budgetPercent = combinedRssMb !== null
    ? Math.round((combinedRssMb / budgetMb) * 1000) / 10
    : null;

  // 3. 子系统健康矩阵（严格对齐线框 §4: 7 大核心键名）
  const baseSubsystems = healthSnap.subsystems || {};
  const subsystems = {
    ingest: {
      status: ingestHealth.status,
      delaySec: ingestHealth.delaySec,
      description: ingestHealth.description,
      lastOutcome: heartbeat?.outcome || 'unknown',
    },
    aiTunnel: baseSubsystems.aiTunnel || {
      status: 'ok',
      state: 'CLOSED',
      description: 'AI 隧道熔断器闭合 (正常)',
    },
    eventLoop: baseSubsystems.eventLoop || {
      status: 'ok',
      meanDelayMs: 0,
      p99DelayMs: 0,
      maxDelayMs: 0,
    },
    monitoringDb: baseSubsystems.monitoringDb || {
      status: 'ok',
      readonlySafe: true,
      description: '只读模式连接正常',
    },
    queues: baseSubsystems.queues || {
      status: 'ok',
      mediaPending: 0,
      offlinePending: 0,
    },
    assets: baseSubsystems.assets || {
      status: 'ok',
      persona: { lagDays: 0.0, status: 'ok' },
      l2a: { lagDays: 0.0, status: 'ok' },
      news: { status: 'ok', description: '休市空窗免检（未生成）', marketClosed: isClosed },
    },
    pushPipeline: baseSubsystems.pushPipeline || {
      status: 'ok',
      recentP95TtlMs: null,
      consecutiveFailures: 0,
      circuitOpen: false,
    },
  };

  // 4. 最近告警历史与时序趋势（彻底消除假 P95）
  let recentAlerts = [];
  const sparklines = {
    timestamps: [],
    memoryRss: [],
    pushP95: [],
    notes: {
      memoryRss: 'from ingest metric_samples.memory_rss_mb',
      pushP95: 'not_sampled',
    },
  };

  if (monDb) {
    try {
      const alerts = monDb.prepare(`
        SELECT id, subsystem, level, title as message, sent_at as createdAt, sent_at_beijing as createdAtBeijing
        FROM alert_history
        ORDER BY sent_at DESC
        LIMIT 20
      `).all();
      recentAlerts = alerts || [];
    } catch (_) {}

    try {
      const oneHourAgo = nowMs - (3600 * 1000);
      const samples = monDb.prepare(`
        SELECT ts, memory_rss_mb
        FROM metric_samples
        WHERE ts > ?
        ORDER BY ts ASC
        LIMIT 60
      `).all(oneHourAgo);

      if (samples && samples.length > 0) {
        sparklines.timestamps = samples.map(s => s.ts);
        sparklines.memoryRss = samples.map(s => s.memory_rss_mb);
      }
    } catch (_) {}
  }

  return {
    success: true,
    timestamp: nowMs,
    serverTimeBeijing: formatBeijingTime(nowMs),
    market: {
      isClosed,
      currentET: `${et.etDateStr} ${String(et.hour).padStart(2, '0')}:${String(et.minute).padStart(2, '0')} ET`,
      statusText: isClosed ? '休市时段' : '美股交易中',
    },
    overall: {
      status: healthSnap.status || 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        webRssMb,
        ingestRssMb,
        combinedRssMb,
        rssMb: webRssMb, // 兼容旧版单一字段读取
        heapUsedMb,
        budgetMb,
        budgetPercent,
        note: 'ingestRss from heartbeat.detail_json if present; else null',
      },
    },
    subsystems,
    recentAlerts,
    sparklines,
  };
}

/**
 * Express 路由中间件处理器
 */
export function handleDashboardApi(req, res) {
  try {
    const data = getDashboardPayload();
    res.json(data);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

