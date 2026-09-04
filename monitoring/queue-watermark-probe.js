/**
 * @file monitoring/queue-watermark-probe.js
 * @description P1-7: 队列积压、处理失败率与水位滞后探针 (只读挂载 whop_archive.db，0 锁争用)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { formatBeijingTime } from './alert-sink.js';

let readOnlyDb = null;
let lastSnapshot = {
  status: 'ok',
  checkedAt: null,
  queues: {},
  watermarks: {},
  summary: '暂无采样',
  mediaPending: 0,
  totalPending: 0,
};

function getReadOnlyDb() {
  if (readOnlyDb) return readOnlyDb;
  const dbPath = path.resolve('whop_archive.db');
  if (!fs.existsSync(dbPath)) return null;

  try {
    readOnlyDb = new Database(dbPath, { readonly: true, timeout: 2000 });
    return readOnlyDb;
  } catch (e) {
    console.warn('[QueueProbe] 无法以只读方式打开 whop_archive.db:', e.message);
    return null;
  }
}

/**
 * 执行一次队列与水位健康度扫描
 */
export function checkQueueHealth({
  mediaWarnPending = 50,
  mediaCriticalPending = 200,
  maxFailRate = 0.1,
} = {}) {
  const db = getReadOnlyDb();
  if (!db) {
    lastSnapshot = {
      status: 'warn',
      checkedAt: formatBeijingTime(),
      queues: {},
      watermarks: {},
      summary: '主数据库未就绪或无法以只读模式读取',
      mediaPending: 0,
      totalPending: 0,
    };
    return lastSnapshot;
  }

  try {
    // 1. 统计各队列状态
    const queueStats = db.prepare(`
      SELECT queue_name, status, COUNT(*) as count
      FROM pipeline_tasks
      GROUP BY queue_name, status
    `).all();

    const queues = {};
    const standardQueues = ['media', 'l2a_cut', 'l2b_cut', 'timeline'];
    standardQueues.forEach((q) => {
      queues[q] = { pending: 0, running: 0, ok: 0, failed: 0, total: 0 };
    });

    let totalPending = 0;
    queueStats.forEach((row) => {
      if (!queues[row.queue_name]) {
        queues[row.queue_name] = { pending: 0, running: 0, ok: 0, failed: 0, total: 0 };
      }
      const st = row.status === 'done' ? 'ok' : row.status;
      queues[row.queue_name][st] = (queues[row.queue_name][st] || 0) + row.count;
      queues[row.queue_name].total += row.count;
      if (st === 'pending') {
        totalPending += row.count;
      }
    });

    // 2. 读取水位线
    const watermarks = db.prepare(`
      SELECT pipeline_name, last_processed_ts, last_processed_id, updated_at
      FROM pipeline_watermarks
    `).all();

    const wmMap = {};
    watermarks.forEach((w) => {
      wmMap[w.pipeline_name] = {
        lastTs: Number(w.last_processed_ts),
        lastId: w.last_processed_id,
        updatedAt: w.updated_at,
      };
    });

    const mediaPending = queues['media']?.pending || 0;
    const mediaFailed = queues['media']?.failed || 0;
    const mediaTotal = queues['media']?.total || 0;

    // 3. 判定子系统健康等级
    let level = 'ok';
    let detail = '';

    if (mediaPending >= mediaCriticalPending) {
      level = 'critical';
      detail = `P0 media 队列严重积压 (pending=${mediaPending} >= ${mediaCriticalPending})`;
    } else if (mediaPending >= mediaWarnPending) {
      level = 'warn';
      detail = `P0 media 队列轻度积压 (pending=${mediaPending} >= ${mediaWarnPending})`;
    } else if (mediaTotal > 20 && (mediaFailed / mediaTotal) > maxFailRate) {
      level = 'warn';
      detail = `P0 media 队列失败率偏高 (${mediaFailed}/${mediaTotal} = ${Math.round((mediaFailed / mediaTotal) * 100)}%)`;
    }

    const summary = `media 待下 ${mediaPending} (总 ${mediaTotal}) · 全局积压 ${totalPending} · 状态 ${level.toUpperCase()}`;

    lastSnapshot = {
      status: level,
      checkedAt: formatBeijingTime(),
      mediaPending,
      totalPending,
      queues,
      watermarks: wmMap,
      summary,
      detail: detail || summary,
    };

    return lastSnapshot;
  } catch (err) {
    console.warn('[QueueProbe] 探测异常:', err.message);
    lastSnapshot = {
      status: 'warn',
      checkedAt: formatBeijingTime(),
      mediaPending: 0,
      totalPending: 0,
      queues: {},
      watermarks: {},
      summary: `探测异常: ${err.message}`,
      detail: err.message,
    };
    return lastSnapshot;
  }
}

export function getQueueSnapshot() {
  return { ...lastSnapshot };
}

export function closeQueueProbeDb() {
  if (readOnlyDb) {
    try {
      readOnlyDb.close();
    } catch (_) {}
    readOnlyDb = null;
  }
}
