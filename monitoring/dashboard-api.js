/**
 * @file monitoring/dashboard-api.js
 * @description P2-11: 健康看板只读聚合 API 契约实现 (GET /api/monitoring/dashboard)
 *
 * 契约规范: docs/p2-11-health-dashboard-wireframe.md §4
 * 严格只读: 绝不触发任何写操作，只读读取 /health 状态快照与 monitoring.db 时序
 */

import { buildHealthPayload } from './health.js';
import { getEasternTimeParts, isWeekendOrHoliday } from './market-calendar.js';
import { formatBeijingTime } from './alert-sink.js';
import { getReadOnlyMonitoringDb } from './db-readonly.js';
import { getIngestHeartbeat } from './monitoring-db.js';
import { evaluateIngestStatus } from './ingest-health.js';

export function getDashboardPayload({ nowMs = Date.now() } = {}) {
  const healthSnap = buildHealthPayload();
  const et = getEasternTimeParts(new Date(nowMs));
  const isClosed = isWeekendOrHoliday(new Date(nowMs));

  const mem = process.memoryUsage();
  const rssMb = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
  const heapUsedMb = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
  const budgetMb = 958.0;
  const budgetPercent = Math.round((rssMb / budgetMb) * 1000) / 10;

  // Ingest 进程心跳
  const monDb = getReadOnlyMonitoringDb();
  let heartbeat = null;
  let ingestHealth = { status: 'ok', delaySec: 0, description: '未配置独立 Ingest' };
  if (monDb) {
    heartbeat = getIngestHeartbeat('primary', { dbInstance: monDb, nowMs });
    ingestHealth = evaluateIngestStatus({ heartbeat, nowMs });
  }

  // 最近告警历史 (从 monitoring.db 读取，安全 fallback)
  let recentAlerts = [];
  let sparklines = {
    timestamps: [],
    memoryRss: [],
    pushP95: [],
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
        sparklines.pushP95 = samples.map(() => 180); // stub 占位
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
        rssMb,
        heapUsedMb,
        budgetMb,
        budgetPercent,
      },
    },
    subsystems: {
      ...(healthSnap.subsystems || {}),
      ingest_worker: {
        status: ingestHealth.status,
        delaySec: ingestHealth.delaySec,
        description: ingestHealth.description,
        lastOutcome: heartbeat?.outcome || 'unknown',
      },
    },
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
