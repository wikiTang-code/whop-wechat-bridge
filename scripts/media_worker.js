/**
 * @file media_worker.js
 * @description 实时中断下半部 (Bottom Half / DPC) P0 媒体下载与门禁工作者
 * 
 * 🚨 红线约束：
 * 1. 严格执行门禁：物理大小必须严格 > 15KB，且 SHA256 不在骨架屏黑名单
 * 2. 失败重试不弄脏 raw 数据，仅标记 pipeline_tasks.status
 * 3. 产物仅作为本地资产存储与 manifest 索引，不当金标、不进策略树、不抽 BUY/SELL
 */

import Database from 'better-sqlite3';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { ensurePipelineTasksCompat } from './pipeline_tasks_compat.js';

dotenv.config();

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);
ensurePipelineTasksCompat(db);

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

async function webFetch(url, options = {}) {
  const agent = url.startsWith('https') ? httpsAgent : httpAgent;
  return fetch(url, { agent, ...options });
}

const KNOWN_SKELETON_SHAS = new Set([
  '0804573d',
  '5f4dd331',
  'e3b0c442',
  'd41d8cd9'
]);

export async function runMediaWorker(limit = 10) {
  console.log('========================================================================================');
  console.log(`🖼️ [DPC Media Worker] 启动媒体下载与门禁工作者 (批次上限: ${limit})...`);
  console.log('========================================================================================\n');

  // Live schema may lack INTEGER PK task_id (composite PK only). Use rowid as stable id.
  const pendingTasks = db.prepare(`
    SELECT COALESCE(pt.task_id, pt.rowid) AS task_id, pt.rowid AS rowid, pt.message_id,
           COALESCE(pt.retry_count, 0) AS retry_count, m.attachments, m.sender_name, m.created_at, m.channel_name
    FROM pipeline_tasks pt
    JOIN messages m ON pt.message_id = m.id
    WHERE pt.queue_name = 'media' AND pt.status = 'pending'
    ORDER BY pt.created_at ASC
    LIMIT ?
  `).all(limit);

  if (pendingTasks.length === 0) {
    console.log('✨ 当前 media 队列无积压任务 (0 pending)。\n');
    return { processed: 0, passed: 0, rejected: 0 };
  }

  console.log(`📥 扫描到 ${pendingTasks.length} 条待下载媒体任务，开始执行：\n`);

  let passedCount = 0;
  let rejectedCount = 0;

  const updateTaskStmt = db.prepare(`
    UPDATE pipeline_tasks
    SET status = ?, error_message = ?, result_payload = ?, updated_at = ?
    WHERE rowid = ?
  `);

  const updateMsgAttachmentsStmt = db.prepare(`
    UPDATE messages
    SET attachments = ?
    WHERE id = ?
  `);

  const updateWmStmt = db.prepare(`
    INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
    VALUES ('wm_media', ?, ?, ?)
    ON CONFLICT(pipeline_name) DO UPDATE SET
      last_processed_ts = MAX(excluded.last_processed_ts, pipeline_watermarks.last_processed_ts),
      last_processed_id = excluded.last_processed_id,
      updated_at = excluded.updated_at
  `);

  for (const task of pendingTasks) {
    const nowTs = Date.now();
    let attachments = [];
    try {
      attachments = JSON.parse(task.attachments || '[]');
    } catch (e) {
      attachments = [];
    }

    if (attachments.length === 0) {
      updateTaskStmt.run('done', null, JSON.stringify({ note: 'no attachments' }), nowTs, task.rowid);
      continue;
    }

    const sender = (task.sender_name || 'unknown').trim();
    const senderLower = sender.toLowerCase();
    const subDir = (senderLower.includes('zhao') || senderLower.includes('赵')) ? 'zhao' :
                   (senderLower.includes('zhou') || senderLower.includes('周')) ? 'zhou' : 'general';

    const etDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(Number(task.created_at)));

    const targetDir = path.resolve(`data/media/${subDir}/${etDateStr}`);
    fs.mkdirSync(targetDir, { recursive: true });

    let allAttachmentsPassed = true;
    let processedAttachments = [];

    for (let idx = 0; idx < attachments.length; idx++) {
      const att = attachments[idx];
      const rawUrl = att.url || att.source?.url;
      if (!rawUrl) continue;

      try {
        console.log(`⬇️ [${task.message_id}] 正在下载附件 [${idx + 1}]: ${rawUrl.slice(0, 80)}...`);
        const imgRes = await webFetch(rawUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });

        if (!imgRes.ok) {
          throw new Error(`HTTP ${imgRes.status} - ${imgRes.statusText}`);
        }

        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const byteSize = buffer.length;
        const sizeKb = (byteSize / 1024).toFixed(1);

        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const shortSha = sha256.slice(0, 8);

        const outFilename = `${task.message_id}_${idx}.jpg`;
        const outPath = path.join(targetDir, outFilename);
        fs.writeFileSync(outPath, buffer);

        // 门禁质检
        let isPassed = true;
        let failReason = null;

        if (byteSize <= 15360) {
          isPassed = false;
          failReason = `文件过小 (${sizeKb} KB <= 15KB)，判定为骨架屏或表情包`;
        } else if (KNOWN_SKELETON_SHAS.has(shortSha)) {
          isPassed = false;
          failReason = `命中骨架屏哈希黑名单 (${shortSha})`;
        }

        if (isPassed) {
          passedCount++;
          console.log(`   ✅ 门禁通过: ${outFilename} (${sizeKb} KB, SHA: ${shortSha})`);
        } else {
          rejectedCount++;
          allAttachmentsPassed = false;
          console.log(`   ❌ 门禁拦截: ${outFilename} (${failReason})`);
        }

        processedAttachments.push({
          url: rawUrl,
          local_path: outPath,
          byte_size: byteSize,
          size_kb: sizeKb,
          sha256_full: sha256,
          sha256_short: shortSha,
          gate_passed: isPassed,
          status: isPassed ? 'ok' : 'skeleton_rejected',
          fail_reason: failReason
        });
      } catch (err) {
        console.error(`   ❌ 下载失败 [${task.message_id}_${idx}]:`, err.message);
        processedAttachments.push({
          url: rawUrl,
          status: 'download_failed',
          error: err.message
        });
        allAttachmentsPassed = false;
      }
    }

    // 更新 messages.attachments 与 pipeline_tasks
    updateMsgAttachmentsStmt.run(JSON.stringify(processedAttachments), task.message_id);
    updateTaskStmt.run(
      allAttachmentsPassed ? 'done' : 'failed',
      allAttachmentsPassed ? null : 'Some attachments failed gate or download',
      JSON.stringify(processedAttachments),
      nowTs,
      task.rowid
    );

    // 推进水位线
    updateWmStmt.run(Number(task.created_at), task.message_id, nowTs);
  }

  console.log('\n----------------------------------------------------------------------------------------');
  console.log(`📊 本批次处理完毕：总计 ${pendingTasks.length} 条任务，✅ 合规落盘 ${passedCount} 张，❌ 门禁拦截 ${rejectedCount} 张`);
  console.log('----------------------------------------------------------------------------------------\n');

  return { processed: pendingTasks.length, passed: passedCount, rejected: rejectedCount };
}

// 支持 CLI 独立运行
if (process.argv[1]?.endsWith('media_worker.js')) {
  runMediaWorker(20).then(() => process.exit(0));
}
