/**
 * @file cleanup_legacy_queue_watermark.js
 * @description 清理并重置队列积压为真实语义状态：
 * 1. 历史过期 media 标记为 status='skipped' (不冒充 done)
 * 2. 8-28 前 l2a_cut 标记为 status='skipped' (历史已切，不虚报 390 组新切)
 * 3. 暂缓的 l2b_cut 标记为 status='paused' (严禁 done)
 * 4. 水位 wm_media 对准周哥 20:25 第二张图 (post_1CeZskZeTudbyBxxM5pxz9)
 * 5. 刷新 queue_status.json
 */

import Database from 'better-sqlite3';
import path from 'path';
import { generateQueueStatus } from './generate_queue_status.js';

console.log('========================================================================================');
console.log('🧹 修正假完成状态：写入真实 skipped / paused 状态 & 对齐最新水位');
console.log('========================================================================================\n');

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

// 周哥 20:25 第二张实盘图 (post_1CeZskZeTudbyBxxM5pxz9, 2026-08-30 20:25:21 ET)
const zhouSecondMsgTs = 1788135921000;
const zhouSecondMsgId = 'post_1CeZskZeTudbyBxxM5pxz9';
const l2aCutTs = 1787961600000; // 2026-08-28 20:00 ET
const l2aCutId = 'post_1CeVzEvXP5LptWq4o78Uf5';

const nowTs = Date.now();

// 1. 历史过期未下载附件：状态设为 'skipped' (不计入 ok)
const mediaCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'skipped', error_message = 'expired_unsigned (历史过期未下附件，保持 skipped)', updated_at = ?
  WHERE queue_name = 'media' AND status != 'failed' AND (
    created_at < ? OR message_id IN (SELECT id FROM messages WHERE created_at < ?)
  )
`).run(nowTs, 1788134000000, 1788134000000);

// 周哥 8:02 与 8:25 这两张真实落盘成功的帖子标记为 'ok'
db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'ok', error_message = null, updated_at = ?
  WHERE queue_name = 'media' AND message_id IN ('post_1CeZqyZPfc3CYSB1bsF5yG', 'post_1CeZskZeTudbyBxxM5pxz9')
`).run(nowTs);

console.log(`✅ 历史过期未下载媒体已归为 skipped: ${mediaCleanRes.changes} 条`);

// 2. 暂缓的 l2b_cut：状态设为 'paused' (禁止 done)
const l2bCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'paused', error_message = 'l2b_cut_held (规范定稿前保持 held/paused)', updated_at = ?
  WHERE queue_name = 'l2b_cut'
`).run(nowTs);

console.log(`✅ l2b_cut 已全量转为 paused: ${l2bCleanRes.changes} 条`);

// 3. 8-28 水位之前的历史 l2a_cut：状态设为 'skipped' (历史已切批次，不报假完成)
const l2aCleanRes = db.prepare(`
  UPDATE pipeline_tasks
  SET status = 'skipped', error_message = 'historical_batch_already_cut', updated_at = ?
  WHERE queue_name = 'l2a_cut' AND message_id IN (
    SELECT id FROM messages WHERE created_at <= ?
  )
`).run(nowTs, 1787961600000);

console.log(`✅ 8-28 历史 l2a_cut 批次已归为 skipped: ${l2aCleanRes.changes} 条`);

// 4. 重置并对准各产线的水位线 (wm_media 指到 20:25 周哥第二张图)
db.prepare(`
  INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
  VALUES ('wm_media', ?, ?, ?)
  ON CONFLICT(pipeline_name) DO UPDATE SET
    last_processed_ts = excluded.last_processed_ts,
    last_processed_id = excluded.last_processed_id,
    updated_at = excluded.updated_at
`).run(zhouSecondMsgTs, zhouSecondMsgId, nowTs);

db.prepare(`
  INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
  VALUES ('wm_l2a_cut', ?, ?, ?)
  ON CONFLICT(pipeline_name) DO UPDATE SET
    last_processed_ts = excluded.last_processed_ts,
    last_processed_id = excluded.last_processed_id,
    updated_at = excluded.updated_at
`).run(l2aCutTs, l2aCutId, nowTs);

console.log(`✅ 水位线已精准对齐:`);
console.log(`   - wm_media : 周哥 20:25 实盘第二张图 (${zhouSecondMsgId})`);
console.log(`   - wm_l2a_cut: 2026-08-28 收官切片 (${l2aCutId})\n`);

// 5. 刷新状态
generateQueueStatus();
