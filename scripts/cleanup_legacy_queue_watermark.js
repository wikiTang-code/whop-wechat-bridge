/**
 * @file cleanup_legacy_queue_watermark.js
 * @description 清理并重置队列积压：
 * 1. 将历史过期无法换签的附件标记为 expired_unsigned，移出 pending 队列
 * 2. 对准 wm_media 水位线为周哥 8:02 原帖 (post_1CeZqyZPfc3CYSB1bsF5yG)
 * 3. 规范 wm_l2a_cut 水位线 (2026-08-28)
 * 4. 刷新 queue_status.json
 */

import Database from 'better-sqlite3';
import path from 'path';
import { generateQueueStatus } from './generate_queue_status.js';

console.log('========================================================================================');
console.log('🧹 清理并重置历史过期队列积压 & 对齐真实水位线');
console.log('========================================================================================\n');

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

const zhouMsgTs = 1788134533000; // 2026-08-30 20:02 ET (周哥 post_1CeZqyZPfc3CYSB1bsF5yG)
const zhouMsgId = 'post_1CeZqyZPfc3CYSB1bsF5yG';
const l2aCutTs = 1787961600000; // 2026-08-28 20:00 ET
const l2aCutId = 'post_1CeVzEvXP5LptWq4o78Uf5';

const nowTs = Date.now();

// 1. 将 2026-08-30 20:00 ET 之前的历史 pending media 任务标记为 expired_unsigned (避免盲目重放老帖)
const mediaCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'done', error_message = 'expired_unsigned (历史过期附件不盲目换签重放)', updated_at = ?
  WHERE queue_name = 'media' AND status = 'pending'
    AND message_id IN (
      SELECT id FROM messages WHERE created_at < ?
    )
`).run(nowTs, 1788134000000);

console.log(`✅ 已清理历史过期 media 积压任务: ${mediaCleanRes.changes} 条`);

// 2. 清理未规范的 l2b_cut 积压任务
const l2bCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'done', error_message = 'l2b_cut_paused (知识窗规范定稿前暂停队列)', updated_at = ?
  WHERE queue_name = 'l2b_cut' AND status = 'pending'
`).run(nowTs);

console.log(`✅ 已清理暂缓的 l2b_cut 任务: ${l2bCleanRes.changes} 条`);

// 3. 清理 2026-08-28 水位之前的历史 l2a_cut 任务 (历史批次已在离线完成切窗)
const l2aCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'done', error_message = 'offline_batch_already_processed', updated_at = ?
  WHERE queue_name = 'l2a_cut' AND status = 'pending'
    AND message_id IN (
      SELECT id FROM messages WHERE created_at <= ?
    )
`).run(nowTs, 1787961600000);

console.log(`✅ 已清理 8-28 之前已跑完的 l2a_cut 任务: ${l2aCleanRes.changes} 条`);

// 4. 重置并对准各产线的水位线
db.prepare(`
  INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
  VALUES ('wm_media', ?, ?, ?)
  ON CONFLICT(pipeline_name) DO UPDATE SET
    last_processed_ts = excluded.last_processed_ts,
    last_processed_id = excluded.last_processed_id,
    updated_at = excluded.updated_at
`).run(zhouMsgTs, zhouMsgId, nowTs);

db.prepare(`
  INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
  VALUES ('wm_l2a_cut', ?, ?, ?)
  ON CONFLICT(pipeline_name) DO UPDATE SET
    last_processed_ts = excluded.last_processed_ts,
    last_processed_id = excluded.last_processed_id,
    updated_at = excluded.updated_at
`).run(l2aCutTs, l2aCutId, nowTs);

console.log(`✅ 水位线已精准对齐:`);
console.log(`   - wm_media : 周哥 8:02 成交原帖 (${zhouMsgId})`);
console.log(`   - wm_l2a_cut: 2026-08-28 收官切片 (${l2aCutId})\n`);

// 5. 刷新状态
generateQueueStatus();
