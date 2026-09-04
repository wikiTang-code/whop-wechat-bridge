/**
 * @file monitoring/monitoring-db.js
 * @description P1-7: 独立监控时序库管理器 (严格恪守 R3 红线：绝不写入 whop_archive.db)
 *
 * 核心设计：
 * 1. 独立文件：monitoring.db，开启独立 WAL 模式 (journal_mode=WAL) 与 NORMAL 同步级别；
 * 2. 低频聚合写入：仅在边沿跃迁、告警发生或每分钟采样点落盘，绝不争用主库写锁；
 * 3. 空间自动治理：自动裁剪 7 天之前的历史采样数据，保证体积恒定 < 10MB。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { formatBeijingTime } from './alert-sink.js';

let monDb = null;

export function getMonitoringDbPath() {
  return process.env.MONITORING_DB_PATH || path.resolve('monitoring.db');
}

export function initMonitoringDb(dbPath = getMonitoringDbPath()) {
  if (monDb) return monDb;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  monDb = new Database(dbPath);
  monDb.pragma('journal_mode = WAL');
  monDb.pragma('synchronous = NORMAL');

  monDb.exec(`
    CREATE TABLE IF NOT EXISTS health_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsystem TEXT NOT NULL,
      prev_level TEXT,
      level TEXT NOT NULL,
      detail TEXT,
      evidence TEXT,
      created_at INTEGER NOT NULL,
      created_at_beijing TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metric_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      created_at_beijing TEXT NOT NULL,
      event_loop_mean_ms REAL,
      event_loop_p99_ms REAL,
      event_loop_max_ms REAL,
      memory_rss_mb INTEGER,
      media_pending INTEGER,
      total_pending INTEGER
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsystem TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      evidence TEXT,
      sent_at INTEGER NOT NULL,
      sent_at_beijing TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_events_subsystem_ts ON health_events(subsystem, created_at);
    CREATE INDEX IF NOT EXISTS idx_metric_samples_ts ON metric_samples(ts);
    CREATE INDEX IF NOT EXISTS idx_alert_history_subsystem_sent ON alert_history(subsystem, sent_at);
  `);

  // 启动时自动裁剪 7 天前的历史采样
  pruneOldMetrics(7);

  console.log(`[MonitoringDB] initialized at ${dbPath} (WAL mode, R3 isolated)`);
  return monDb;
}

export function getMonitoringDb() {
  if (!monDb) {
    return initMonitoringDb();
  }
  return monDb;
}

/**
 * 记录子系统状态机边沿跃迁事件 (如 ok -> warn, warn -> critical, critical -> ok)
 */
export function recordHealthEvent({ subsystem, prevLevel, level, detail = '', evidence = {} }) {
  try {
    const db = getMonitoringDb();
    const now = Date.now();
    const beijing = formatBeijingTime(now);
    const evJson = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);

    db.prepare(`
      INSERT INTO health_events (subsystem, prev_level, level, detail, evidence, created_at, created_at_beijing)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subsystem, prevLevel || null, level, detail, evJson, now, beijing);
  } catch (err) {
    console.warn('[MonitoringDB] recordHealthEvent error:', err.message);
  }
}

/**
 * 低频时序指标落盘 (建议每 60 秒调用一次)
 */
export function recordMetricSample({
  eventLoopMeanMs = null,
  eventLoopP99Ms = null,
  eventLoopMaxMs = null,
  memoryRssMb = null,
  mediaPending = 0,
  totalPending = 0,
}) {
  try {
    const db = getMonitoringDb();
    const now = Date.now();
    const beijing = formatBeijingTime(now);

    db.prepare(`
      INSERT INTO metric_samples (
        ts, created_at_beijing,
        event_loop_mean_ms, event_loop_p99_ms, event_loop_max_ms,
        memory_rss_mb, media_pending, total_pending
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      now,
      beijing,
      eventLoopMeanMs,
      eventLoopP99Ms,
      eventLoopMaxMs,
      memoryRssMb,
      mediaPending,
      totalPending
    );
  } catch (err) {
    console.warn('[MonitoringDB] recordMetricSample error:', err.message);
  }
}

/**
 * 记录向企业微信实际推送的告警历史
 */
export function recordAlertHistory({ subsystem, level, title, detail = '', evidence = {} }) {
  try {
    const db = getMonitoringDb();
    const now = Date.now();
    const beijing = formatBeijingTime(now);
    const evJson = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);

    db.prepare(`
      INSERT INTO alert_history (subsystem, level, title, detail, evidence, sent_at, sent_at_beijing)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subsystem, level, title, detail, evJson, now, beijing);
  } catch (err) {
    console.warn('[MonitoringDB] recordAlertHistory error:', err.message);
  }
}

/**
 * 裁剪过期数据 (保留保留期内的采样与事件)
 */
export function pruneOldMetrics(retentionDays = 7) {
  try {
    const db = getMonitoringDb();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const res1 = db.prepare('DELETE FROM metric_samples WHERE ts < ?').run(cutoff);
    const res2 = db.prepare('DELETE FROM health_events WHERE created_at < ?').run(cutoff);
    const res3 = db.prepare('DELETE FROM alert_history WHERE sent_at < ?').run(cutoff);
    const totalPruned = res1.changes + res2.changes + res3.changes;
    if (totalPruned > 0) {
      console.log(`[MonitoringDB] pruned ${totalPruned} records older than ${retentionDays} days`);
    }
  } catch (err) {
    console.warn('[MonitoringDB] pruneOldMetrics error:', err.message);
  }
}

/**
 * 获取监控库摘要状态 (供 /health 汇报存储健康度)
 */
export function getMonitoringDbStats() {
  try {
    const db = getMonitoringDb();
    const eventCount = db.prepare('SELECT count(*) as count FROM health_events').get()?.count || 0;
    const sampleCount = db.prepare('SELECT count(*) as count FROM metric_samples').get()?.count || 0;
    const alertCount = db.prepare('SELECT count(*) as count FROM alert_history').get()?.count || 0;
    return {
      status: 'ok',
      isolated: true,
      eventsLogged: eventCount,
      metricSamples: sampleCount,
      alertsLogged: alertCount,
    };
  } catch (err) {
    return {
      status: 'warn',
      isolated: true,
      error: err.message,
    };
  }
}

export function closeMonitoringDb() {
  if (monDb) {
    try {
      monDb.close();
    } catch (_) {}
    monDb = null;
  }
}
