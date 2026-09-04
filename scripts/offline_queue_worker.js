/**
 * @file scripts/offline_queue_worker.js
 * @description P1-8: 离线队列批处理消费工具 (严格恪守 R4 在线/离线硬隔离)
 *
 * 作用：
 * 1. 离线批处理消费 pipeline_tasks 中的积压队列 (l2a_cut, timeline 等)；
 * 2. 状态扭转：pending -> ok / skipped；
 * 3. 水位推进：单调递增推进 pipeline_watermarks (wm_l2a_cut, wm_timeline)；
 * 4. 绝不在主服务进程中常驻运行，由系统 cron 调度或命令行批处理触发，保持主服务内存 < 100MB。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { extractTradingDimensions } from '../database.js';

export function getDatabase(customPath) {
  const dbPath = customPath || path.resolve('whop_archive.db');
  return new Database(dbPath, { timeout: 5000 });
}

/**
 * 消费 l2a_cut 队列任务
 */
export function consumeL2aQueue(db, { batchSize = 200 } = {}) {
  const tasks = db.prepare(`
    SELECT pt.message_id, pt.created_at, m.content, m.sender_name, m.channel_name, m.created_at as msg_created_at
    FROM pipeline_tasks pt
    LEFT JOIN messages m ON pt.message_id = m.id
    WHERE pt.queue_name = 'l2a_cut' AND pt.status = 'pending'
    ORDER BY pt.created_at ASC
    LIMIT ?
  `).all(batchSize);

  if (tasks.length === 0) {
    return { queue: 'l2a_cut', processed: 0, maxTs: null };
  }

  const updateTaskStmt = db.prepare(`
    UPDATE pipeline_tasks
    SET status = ?, result_payload = ?, updated_at = ?
    WHERE queue_name = 'l2a_cut' AND message_id = ?
  `);

  const updateWmStmt = db.prepare(`
    INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
    VALUES ('wm_l2a_cut', ?, ?, ?)
    ON CONFLICT(pipeline_name) DO UPDATE SET
      last_processed_ts = MAX(excluded.last_processed_ts, pipeline_watermarks.last_processed_ts),
      last_processed_id = excluded.last_processed_id,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  let maxTs = 0;
  let lastId = null;

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const msgTs = Number(r.msg_created_at || r.created_at || now);
      if (msgTs > maxTs) {
        maxTs = msgTs;
        lastId = r.message_id;
      }

      // 提取标的与动作要素
      const dims = extractTradingDimensions(r.content || '');
      const payload = JSON.stringify({
        tickers: dims.tickers,
        sectors: dims.sectors,
        strategies: dims.strategies,
        sender: r.sender_name,
        processed_offline: true,
      });

      updateTaskStmt.run('ok', payload, now, r.message_id);
    }

    if (maxTs > 0) {
      updateWmStmt.run(maxTs, lastId, now);
    }
  });

  tx(tasks);
  return { queue: 'l2a_cut', processed: tasks.length, maxTs, lastId };
}

/**
 * 消费 timeline 队列任务
 */
export function consumeTimelineQueue(db, { batchSize = 200 } = {}) {
  const tasks = db.prepare(`
    SELECT pt.message_id, pt.created_at, m.content, m.sender_name, m.channel_name, m.created_at as msg_created_at
    FROM pipeline_tasks pt
    LEFT JOIN messages m ON pt.message_id = m.id
    WHERE pt.queue_name = 'timeline' AND pt.status = 'pending'
    ORDER BY pt.created_at ASC
    LIMIT ?
  `).all(batchSize);

  if (tasks.length === 0) {
    return { queue: 'timeline', processed: 0, maxTs: null };
  }

  const updateTaskStmt = db.prepare(`
    UPDATE pipeline_tasks
    SET status = ?, result_payload = ?, updated_at = ?
    WHERE queue_name = 'timeline' AND message_id = ?
  `);

  const updateWmStmt = db.prepare(`
    INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
    VALUES ('wm_timeline', ?, ?, ?)
    ON CONFLICT(pipeline_name) DO UPDATE SET
      last_processed_ts = MAX(excluded.last_processed_ts, pipeline_watermarks.last_processed_ts),
      last_processed_id = excluded.last_processed_id,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  let maxTs = 0;
  let lastId = null;

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const msgTs = Number(r.msg_created_at || r.created_at || now);
      if (msgTs > maxTs) {
        maxTs = msgTs;
        lastId = r.message_id;
      }

      const dims = extractTradingDimensions(r.content || '');
      const payload = JSON.stringify({
        rule_matched: true,
        tickers: dims.tickers,
        processed_offline: true,
      });

      updateTaskStmt.run('ok', payload, now, r.message_id);
    }

    if (maxTs > 0) {
      updateWmStmt.run(maxTs, lastId, now);
    }
  });

  tx(tasks);
  return { queue: 'timeline', processed: tasks.length, maxTs, lastId };
}

/**
 * 离线消费主函数
 */
export function runOfflineBatch({ dbPath, batchSize = 500 } = {}) {
  const db = getDatabase(dbPath);
  try {
    console.log(`[OfflineQueueWorker] 启动离线队列消费 (batchSize=${batchSize}, R4 isolated)...`);
    const l2aRes = consumeL2aQueue(db, { batchSize });
    const timelineRes = consumeTimelineQueue(db, { batchSize });

    console.log(`[OfflineQueueWorker] ✅ l2a_cut 处理完成: ${l2aRes.processed} 条`);
    console.log(`[OfflineQueueWorker] ✅ timeline 处理完成: ${timelineRes.processed} 条`);

    return {
      success: true,
      l2a: l2aRes,
      timeline: timelineRes,
    };
  } finally {
    db.close();
  }
}

import { fileURLToPath } from 'url';

// 命令行直接执行逻辑
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isSilent = process.argv.includes('--cron');
  const res = runOfflineBatch({ batchSize: 1000 });
  if (!isSilent) {
    console.log('[OfflineQueueWorker] 结果:', JSON.stringify(res, null, 2));
  }
}
