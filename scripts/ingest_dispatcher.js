/**
 * @file ingest_dispatcher.js
 * @description 实时中断上半部 (Top Half / ISR) 分发器
 * 
 * 🚨 红线约束：
 * 1. 绝对禁止调用 LLM (无任何 fetch('localhost:8080/v1/...') 或模型调用)
 * 2. 绝对禁止同步阻塞下载大图 (仅做 enqueue_media，耗时严格控制在 < 10ms)
 * 3. 严格规则驱动打标 (speaker, channel_class, flags)
 * 4. 幂等追加写入 ingest_events 与 pipeline_tasks
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ensurePipelineTasksCompat } from './pipeline_tasks_compat.js';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

// 初始化 ISR / DPC 流水线所需核心表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS ingest_events (
    message_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    channel_class TEXT NOT NULL,
    speaker TEXT NOT NULL,
    flags TEXT,
    dispatched_queues TEXT,
    created_ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline_tasks (
    queue_name TEXT NOT NULL,
    message_id TEXT NOT NULL,
    event_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    result_payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (queue_name, message_id)
  );

  CREATE TABLE IF NOT EXISTS pipeline_watermarks (
    pipeline_name TEXT PRIMARY KEY,
    last_processed_ts INTEGER,
    last_processed_id TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// Live DBs created before task_id existed: ALTER-add + backfill rowid (does not rewrite the table).
ensurePipelineTasksCompat(db);

let channelRegistryCache = null;
function getChannelRegistry() {
  if (channelRegistryCache) return channelRegistryCache;
  try {
    const regPath = path.resolve('config', 'channel_registry.json');
    if (fs.existsSync(regPath)) {
      channelRegistryCache = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    }
  } catch (e) {
    console.error('[Ingest Dispatcher] 读取 channel_registry 失败:', e.message);
  }
  return channelRegistryCache || {};
}

// 冻结的规则关键词词表 (严禁在此开新规则，只作为下半部唤醒触发器)
const RULE_TRIGGER_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|同花顺|王炸|出牌|手牌|四手牌|指数低什么都不敢买|7640的极限点)/;
const FILL_TRIGGER_REGEX = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i;

/**
 * 上半部中断处理函数 (单条耗时 < 10ms)
 * @param {Object} rawMsg 原始消息对象
 * @returns {Object} 处理结果与分发事件
 */
export function dispatchIngestTopHalf(rawMsg) {
  const startTs = Date.now();
  const text = rawMsg.content || rawMsg.title || '';
  const senderName = (rawMsg.sender_name || rawMsg.user?.name || rawMsg.user?.username || '').trim();
  const channelId = rawMsg.channel_id || rawMsg.feedId || '';
  const createdAt = Number(rawMsg.created_at || rawMsg.createdAt || Date.now());

  // 1. 发言人分类
  let speaker = 'other';
  const senderLower = senderName.toLowerCase();
  if (senderLower.includes('赵') || senderLower.includes('zhao') || senderLower === 'xiaozhaolucky') {
    speaker = 'zhao';
  } else if (senderLower.includes('zhou') || senderLower === 'mrzhoulucky' || senderLower.includes('周')) {
    speaker = 'zhou';
  }

  // 2. 频道分类 (强制读权威登记册 registry[feed_id].class，严禁模糊猜测)
  const registry = getChannelRegistry();
  const regInfo = registry[channelId];
  let channelClass = regInfo ? regInfo.channel_class : 'other';
  let canonicalChannelName = regInfo ? regInfo.name : (rawMsg.channel_name || channelId);

  // 3. 附件标准化
  let attachments = [];
  if (Array.isArray(rawMsg.attachments)) {
    attachments = rawMsg.attachments.map(att => {
      const url = att.source?.url || att.url || '';
      return {
        id: att.id || null,
        url: url,
        contentType: att.contentType || 'image/jpeg',
        byteSize: att.byteSizeV2 || att.byteSize || null,
        status: 'pending'
      };
    });
  }

  // 4. 特征标志 (Flags)
  const hasMedia = attachments.length > 0 || text.includes('[IMAGE:');
  const looksLikeFill = FILL_TRIGGER_REGEX.test(text);
  const looksLikeRule = RULE_TRIGGER_REGEX.test(text);

  const flags = {
    has_media: hasMedia,
    looks_like_fill: looksLikeFill,
    looks_like_rule: looksLikeRule
  };

  // 5. 下半部队列分发裁定 (按水位过滤历史，避免盲目入队过期附件)
  const dispatchedQueues = [];

  // 获取当前 media 水位线时间戳 (默认以 2026-08-28 之后的活跃窗口为基准)
  const mediaWmRow = db.prepare(`SELECT last_processed_ts FROM pipeline_watermarks WHERE pipeline_name = 'wm_media'`).get();
  const mediaWmTs = mediaWmRow ? Number(mediaWmRow.last_processed_ts) : 1787800000000; // 约 2026-08-27

  // P0 媒体队列：全频道一视同仁，但仅对处于水位线之后的活跃新附件入队，历史过期附件不入队
  if (hasMedia && createdAt >= mediaWmTs) {
    dispatchedQueues.push('media');
  }

  // P1 L2a 跟单切窗队列：仅在跟单发布区，且为赵哥/周哥发言 (与是否有图完全解耦)
  if ((channelClass === 'broadcast' || channelClass === 'record') && (speaker === 'zhao' || speaker === 'zhou')) {
    dispatchedQueues.push('l2a_cut');
  }

  // P1 L2b 知识窗切窗队列：按规划暂停入队，等待规范定稿后开放，禁止夜盘误跑
  // if (speaker === 'zhao') { dispatchedQueues.push('l2b_cut'); }

  // P2 时序动态账本队列：仅在命中规则特征词且为赵哥发言时触发
  if (looksLikeRule && speaker === 'zhao') {
    dispatchedQueues.push('timeline');
  }

  // 6. 幂等持久化写入 SQLite (messages + ingest_events + pipeline_tasks)
  const nowTs = Date.now();

  const senderId = rawMsg.sender_id || rawMsg.user?.id || 'user_unknown';

  const insertMsgStmt = db.prepare(`
    INSERT INTO messages (id, channel_id, channel_name, sender_id, sender_name, content, created_at, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      attachments = COALESCE(excluded.attachments, messages.attachments)
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO ingest_events (message_id, created_at, channel_id, channel_name, channel_class, speaker, flags, dispatched_queues, created_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO NOTHING
  `);

  const insertTaskStmt = db.prepare(`
    INSERT INTO pipeline_tasks (queue_name, message_id, event_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(queue_name, message_id) DO NOTHING
  `);

  const updateWmStmt = db.prepare(`
    INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, last_processed_id, updated_at)
    VALUES ('wm_raw', ?, ?, ?)
    ON CONFLICT(pipeline_name) DO UPDATE SET
      last_processed_ts = MAX(excluded.last_processed_ts, pipeline_watermarks.last_processed_ts),
      last_processed_id = excluded.last_processed_id,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    // 写入 messages
    insertMsgStmt.run(
      rawMsg.id,
      channelId,
      canonicalChannelName,
      senderId,
      senderName,
      text,
      createdAt,
      attachments.length > 0 ? JSON.stringify(attachments) : null
    );

    // 写入 ingest_events
    const eventRes = insertEventStmt.run(
      rawMsg.id,
      createdAt,
      channelId,
      canonicalChannelName,
      channelClass,
      speaker,
      JSON.stringify(flags),
      JSON.stringify(dispatchedQueues),
      nowTs
    );
    const eventId = eventRes.lastInsertRowid;

    // 写入 pipeline_tasks
    for (const q of dispatchedQueues) {
      insertTaskStmt.run(q, rawMsg.id, eventId, nowTs, nowTs);
    }

    // 更新 raw 水位线
    updateWmStmt.run(createdAt, rawMsg.id, nowTs);
  });

  tx();

  const elapsedMs = Date.now() - startTs;

  return {
    success: true,
    message_id: rawMsg.id,
    speaker,
    channel_class: channelClass,
    flags,
    dispatched_queues: dispatchedQueues,
    elapsed_ms: elapsedMs
  };
}
