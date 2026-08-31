/**
 * @file backfill_ingest_events.js
 * @description 批量快速回填历史消息到 ingest_events 与 pipeline_tasks (事务优化版)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { dispatchIngestTopHalf } from './ingest_dispatcher.js';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🔄 快速回填历史消息到 ingest_events 与 pipeline_tasks (最近 500 条)...');
console.log('========================================================================================\n');

const msgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at, attachments
  FROM messages
  WHERE created_at >= 1787600000000 -- 2026-08-25 之后
  ORDER BY created_at ASC
`).all();

console.log(`载入 8 月下旬以来的消息: ${msgs.length} 条`);

let dispatchedCount = 0;
for (const m of msgs) {
  let attachments = [];
  try {
    if (m.attachments) {
      attachments = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
    }
  } catch (e) {}

  dispatchIngestTopHalf({
    id: m.id,
    channel_id: m.channel_id,
    channel_name: m.channel_name,
    sender_id: m.sender_id,
    sender_name: m.sender_name,
    content: m.content,
    created_at: m.created_at,
    attachments: attachments
  });
  dispatchedCount++;
}

console.log(`✅ 成功分发 ${dispatchedCount} 条历史消息到事件总线与产线队列！\n`);
