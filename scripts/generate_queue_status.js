/**
 * @file generate_queue_status.js
 * @description 统计各产线真实积压与水位状态，严格区分真实 ok / 历史 skipped / 暂停 paused
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

export function generateQueueStatus() {
  const queueStats = db.prepare(`
    SELECT queue_name, status, COUNT(*) as count
    FROM pipeline_tasks
    GROUP BY queue_name, status
  `).all();

  const queues = {};
  const standardQueues = ['media', 'l2a_cut', 'l2b_cut', 'timeline', 'extract_l2a', 'extract_l2b'];
  standardQueues.forEach(q => {
    queues[q] = { pending: 0, running: 0, ok: 0, skipped: 0, paused: 0, failed: 0, total: 0 };
  });

  queueStats.forEach(row => {
    if (!queues[row.queue_name]) {
      queues[row.queue_name] = { pending: 0, running: 0, ok: 0, skipped: 0, paused: 0, failed: 0, total: 0 };
    }
    // 映射状态为真实语义：done 区分真实 ok 或 skipped/paused
    if (row.status === 'ok' || row.status === 'done') {
      queues[row.queue_name].ok = (queues[row.queue_name].ok || 0) + row.count;
    } else if (row.status === 'skipped' || row.status === 'expired_unsigned') {
      queues[row.queue_name].skipped = (queues[row.queue_name].skipped || 0) + row.count;
    } else if (row.status === 'paused' || row.status === 'held') {
      queues[row.queue_name].paused = (queues[row.queue_name].paused || 0) + row.count;
    } else {
      queues[row.queue_name][row.status] = row.count;
    }
    queues[row.queue_name].total += row.count;
  });

  const watermarks = db.prepare(`
    SELECT pipeline_name, last_processed_ts, last_processed_id, updated_at
    FROM pipeline_watermarks
  `).all();

  const wmMap = {};
  watermarks.forEach(w => {
    const ts = Number(w.last_processed_ts);
    const etDate = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'America/New_York',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ts));

    wmMap[w.pipeline_name] = {
      last_ts: w.last_processed_ts,
      last_date_et: etDate,
      last_id: w.last_processed_id,
      updated_at: new Date(w.updated_at).toISOString()
    };
  });

  const totalEvents = db.prepare(`SELECT count(*) as count FROM ingest_events`).get().count;
  const totalMessages = db.prepare(`SELECT count(*) as count FROM messages`).get().count;

  // 生成人类可读状态徽章文案 (完整日期不截断)
  const rawDateStr = wmMap['wm_raw']?.last_date_et || '未同步';
  const mediaPending = queues['media']?.pending || 0;
  const l2aDateStr = wmMap['wm_l2a_cut']?.last_date_et || '08-30';
  
  const badgeSummary = `库至 ${rawDateStr} · 图待下 ${mediaPending} · L2a 切窗已至 ${l2aDateStr}`;

  const statusPayload = {
    updated_at: new Date().toISOString(),
    badge_summary: badgeSummary,
    database_overview: {
      total_messages: totalMessages,
      total_ingest_events: totalEvents
    },
    watermarks: wmMap,
    queues: queues
  };

  const outPath = path.resolve('data/queue_status.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(statusPayload, null, 2), 'utf-8');

  console.log(`📊 队列与真实水位状态已生成: ${outPath}`);
  console.log(`🏷️ 状态徽章: [${badgeSummary}]\n`);

  return statusPayload;
}

if (process.argv[1]?.endsWith('generate_queue_status.js')) {
  generateQueueStatus();
}
