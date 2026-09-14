/**
 * test_db_maintenance_req008.js - REQ-008 P2-16 主库增长治理与保留策略单元测试
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getDbStorageStats,
  pruneExpiredRecords,
  checkpointAndOptimize,
  PROTECTED_BUSINESS_TABLES
} from '../db-maintenance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, 'test_maintenance_scratch.db');

function cleanupTestDb() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = `${TEST_DB_PATH}${ext}`;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  }
}

function initMockDb() {
  cleanupTestDb();
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');

  // 1. 创建核心业务表
  db.prepare(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      content TEXT,
      created_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE zhao_positions (
      ticker TEXT PRIMARY KEY,
      quantity INTEGER,
      average_entry_price REAL,
      current_price REAL,
      market_value REAL,
      unrealized_pnl REAL,
      updated_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE orders (
      order_id TEXT PRIMARY KEY,
      account_type TEXT,
      ticker TEXT,
      quantity INTEGER,
      price REAL,
      created_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE follow_decisions (
      decision_id TEXT PRIMARY KEY,
      account_type TEXT,
      decision_state TEXT,
      ticker TEXT,
      created_at INTEGER
    )
  `).run();

  // 2. 创建清理目标表
  db.prepare(`
    CREATE TABLE task_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT,
      payload TEXT,
      status TEXT,
      created_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE pipeline_tasks (
      task_id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name TEXT,
      message_id TEXT,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE ingest_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      created_ts INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE message_embeddings (
      id TEXT PRIMARY KEY,
      embedding BLOB
    )
  `).run();

  db.prepare(`
    CREATE TABLE message_adjacency (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT,
      created_at INTEGER
    )
  `).run();

  return db;
}

console.log("===========================================================");
console.log("🧪 [Test REQ-008] P2-16 主库增长治理与维护验证套件");
console.log("===========================================================\n");

let db = initMockDb();

try {
  const now = Date.now();
  const oldTs = now - (20 * 86400 * 1000); // 20 天前（过期）
  const recentTs = now - (2 * 86400 * 1000); // 2 天前（不过期）

  // --- 填充测试数据 ---
  // 核心数据（不可碰）
  db.prepare("INSERT INTO messages VALUES (?, ?, ?)").run('msg_live_1', 'hello', recentTs);
  db.prepare("INSERT INTO messages VALUES (?, ?, ?)").run('msg_live_2', 'world', oldTs);
  db.prepare("INSERT INTO zhao_positions VALUES (?, ?, ?, ?, ?, ?, ?)").run('NVDA', 100, 120.0, 130.0, 13000.0, 1000.0, recentTs);
  db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)").run('ord_1', 'paper', 'NVDA', 50, 125.0, recentTs);
  db.prepare("INSERT INTO follow_decisions VALUES (?, ?, ?, ?, ?)").run('dec_1', 'paper', 'FIRE', 'NVDA', recentTs);

  // task_queue:
  // 1. 过期且终态 (应被删)
  db.prepare("INSERT INTO task_queue (task_type, payload, status, created_at) VALUES (?, ?, ?, ?)").run('t1', '{}', 'done', oldTs);
  db.prepare("INSERT INTO task_queue (task_type, payload, status, created_at) VALUES (?, ?, ?, ?)").run('t2', '{}', 'failed', oldTs);
  // 2. 过期但处于 pending/running (应保留)
  db.prepare("INSERT INTO task_queue (task_type, payload, status, created_at) VALUES (?, ?, ?, ?)").run('t3', '{}', 'pending', oldTs);
  db.prepare("INSERT INTO task_queue (task_type, payload, status, created_at) VALUES (?, ?, ?, ?)").run('t4', '{}', 'running', oldTs);
  // 3. 不过期且终态 (应保留)
  db.prepare("INSERT INTO task_queue (task_type, payload, status, created_at) VALUES (?, ?, ?, ?)").run('t5', '{}', 'done', recentTs);

  // pipeline_tasks:
  // 1. 过期且终态 (应被删)
  db.prepare("INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('media', 'm_old_1', 'ok', oldTs, oldTs);
  db.prepare("INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('l2a_cut', 'm_old_2', 'skipped', oldTs, oldTs);
  // 2. 过期但为 l2b_cut paused (硬性红线：绝对保留！)
  db.prepare("INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('l2b_cut', 'm_old_3', 'paused', oldTs, oldTs);
  // 3. 过期但处于 pending (应保留)
  db.prepare("INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('timeline', 'm_old_4', 'pending', oldTs, oldTs);

  // ingest_events:
  // 1. 过期 (应被删)
  db.prepare("INSERT INTO ingest_events (message_id, created_ts) VALUES (?, ?)").run('m_old_1', oldTs);
  // 2. 不过期 (应保留)
  db.prepare("INSERT INTO ingest_events (message_id, created_ts) VALUES (?, ?)").run('m_live_1', recentTs);

  // embeddings & adjacency:
  // 1. 合法绑定的 (对应 msg_live_1)
  db.prepare("INSERT INTO message_embeddings VALUES (?, ?)").run('msg_live_1', Buffer.from([1, 2, 3]));
  db.prepare("INSERT INTO message_adjacency VALUES (?, ?, ?)").run('msg_live_1', 'ch_1', recentTs);
  // 2. 孤儿 (messages 表中没有)
  db.prepare("INSERT INTO message_embeddings VALUES (?, ?)").run('msg_orphan_999', Buffer.from([4, 5, 6]));
  db.prepare("INSERT INTO message_adjacency VALUES (?, ?, ?)").run('msg_orphan_999', 'ch_1', oldTs);

  // --- 验证 1: getDbStorageStats ---
  console.log("--- 1. 验证存储与孤儿分析统计 ---");
  const stats = getDbStorageStats(db);
  if (stats.pageSize <= 0 || stats.pageCount <= 0) {
    throw new Error("Stats page info invalid");
  }
  if (stats.orphanEmbeddings !== 1 || stats.orphanAdjacency !== 1) {
    throw new Error(`Expected 1 orphan embedding & adjacency, got ${stats.orphanEmbeddings}, ${stats.orphanAdjacency}`);
  }
  console.log("✅ getDbStorageStats 统计与孤儿检测完全精准");

  // --- 验证 2: dryRun 预演不产生破坏 ---
  console.log("\n--- 2. 验证 dryRun 预演模式 ---");
  const dryResults = pruneExpiredRecords(db, { retentionDays: 14, dryRun: true });
  if (dryResults.pruned.task_queue !== 2) {
    throw new Error(`dryRun expected 2 task_queue, got ${dryResults.pruned.task_queue}`);
  }
  if (dryResults.pruned.pipeline_tasks !== 2) {
    throw new Error(`dryRun expected 2 pipeline_tasks, got ${dryResults.pruned.pipeline_tasks}`);
  }
  if (dryResults.pruned.orphan_embeddings !== 1) {
    throw new Error(`dryRun expected 1 orphan embedding, got ${dryResults.pruned.orphan_embeddings}`);
  }
  // 确认实际表数据未被删除
  const taskCountDry = db.prepare("SELECT count(*) as c FROM task_queue").get().c;
  if (taskCountDry !== 5) {
    throw new Error(`dryRun should not delete data, expected 5 got ${taskCountDry}`);
  }
  console.log("✅ dryRun 预演准确且未触碰任何底层数据");

  // --- 验证 3: 真实执行 pruneExpiredRecords ---
  console.log("\n--- 3. 验证执行保留策略清理与保护机制 ---");
  const pruneResults = pruneExpiredRecords(db, { retentionDays: 14, dryRun: false });
  
  // 验证 task_queue
  const remainingTasks = db.prepare("SELECT status, count(*) as c FROM task_queue GROUP BY status").all();
  const taskMap = Object.fromEntries(remainingTasks.map(r => [r.status, r.c]));
  if (taskMap.pending !== 1 || taskMap.running !== 1 || taskMap.done !== 1 || taskMap.failed) {
    throw new Error(`task_queue retention mismatch: ${JSON.stringify(taskMap)}`);
  }

  // 验证 pipeline_tasks: l2b_cut paused 必须保留！
  const l2bPaused = db.prepare("SELECT count(*) as c FROM pipeline_tasks WHERE queue_name='l2b_cut' AND status='paused'").get().c;
  if (l2bPaused !== 1) {
    throw new Error("CRITICAL: l2b_cut paused was mistakenly deleted!");
  }
  const timelinePending = db.prepare("SELECT count(*) as c FROM pipeline_tasks WHERE queue_name='timeline' AND status='pending'").get().c;
  if (timelinePending !== 1) {
    throw new Error("pending pipeline task was mistakenly deleted!");
  }

  // 验证 ingest_events
  const remainingEvents = db.prepare("SELECT count(*) as c FROM ingest_events").get().c;
  if (remainingEvents !== 1) {
    throw new Error(`ingest_events expected 1 remaining, got ${remainingEvents}`);
  }

  // 验证孤儿清理
  const remainingEmbs = db.prepare("SELECT id FROM message_embeddings").all();
  if (remainingEmbs.length !== 1 || remainingEmbs[0].id !== 'msg_live_1') {
    throw new Error(`orphan embeddings not cleaned properly: ${JSON.stringify(remainingEmbs)}`);
  }
  const remainingAdj = db.prepare("SELECT message_id FROM message_adjacency").all();
  if (remainingAdj.length !== 1 || remainingAdj[0].message_id !== 'msg_live_1') {
    throw new Error(`orphan adjacency not cleaned properly: ${JSON.stringify(remainingAdj)}`);
  }

  // 验证核心业务表未受丝毫损伤
  const zhaoCount = db.prepare("SELECT count(*) as c FROM zhao_positions").get().c;
  const orderCount = db.prepare("SELECT count(*) as c FROM orders").get().c;
  const followCount = db.prepare("SELECT count(*) as c FROM follow_decisions").get().c;
  const msgCount = db.prepare("SELECT count(*) as c FROM messages").get().c;

  if (zhaoCount !== 1 || orderCount !== 1 || followCount !== 1 || msgCount !== 2) {
    throw new Error("CRITICAL: Protected business tables suffered data loss!");
  }
  console.log("✅ 过期终态任务/日志/孤儿精准清理，活跃任务与 l2b_cut paused 100% 保护");
  console.log("✅ 核心业务表 (zhao_positions/orders/follow_decisions) 零损伤");

  // --- 验证 4: checkpoint 和 optimize ---
  console.log("\n--- 4. 验证 checkpoint 和 optimize ---");
  const optRes = checkpointAndOptimize(db, { checkpoint: true, vacuum: true });
  if (!optRes.success || !optRes.actions.includes('wal_checkpoint_truncate') || !optRes.actions.includes('vacuum')) {
    throw new Error(`checkpointAndOptimize failed: ${JSON.stringify(optRes)}`);
  }
  console.log("✅ WAL 截断与 VACUUM 优化平稳执行");

  console.log("\n🎉 REQ-008 P2-16 主库增长治理验证套件全部 PASS！\n");
} finally {
  db.close();
  cleanupTestDb();
}
