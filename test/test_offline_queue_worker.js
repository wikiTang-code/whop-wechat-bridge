/**
 * @file test/test_offline_queue_worker.js
 * @description P1-8 单元测试：验证离线队列 Worker 批处理消费与水位推进
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { consumeL2aQueue, consumeTimelineQueue } from '../scripts/offline_queue_worker.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P1-8 测试: test_offline_queue_worker ---');

  const testDbPath = path.resolve('data/test_offline_worker.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new Database(testDbPath);

  // 初始化表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      channel_name TEXT,
      sender_id TEXT,
      sender_name TEXT,
      content TEXT,
      created_at INTEGER
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

  // 插入测试消息与待处理任务
  const now = Date.now();
  db.prepare(`
    INSERT INTO messages (id, content, sender_name, created_at)
    VALUES ('msg_test_1', 'TSLA 出现日内买点，注意仓位', '赵哥', ?)
  `).run(now - 10000);

  db.prepare(`
    INSERT INTO messages (id, content, sender_name, created_at)
    VALUES ('msg_test_2', '二次握手要素，只做一次', '赵哥', ?)
  `).run(now - 5000);

  db.prepare(`
    INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at)
    VALUES ('l2a_cut', 'msg_test_1', 'pending', ?, ?)
  `).run(now - 10000, now - 10000);

  db.prepare(`
    INSERT INTO pipeline_tasks (queue_name, message_id, status, created_at, updated_at)
    VALUES ('timeline', 'msg_test_2', 'pending', ?, ?)
  `).run(now - 5000, now - 5000);

  // 1. 验证消费 l2a_cut
  console.log('1. 验证离线消费 l2a_cut 队列...');
  const l2aRes = consumeL2aQueue(db, { batchSize: 10 });
  assert(l2aRes.processed === 1, `l2a processed should be 1, got ${l2aRes.processed}`);

  const task1 = db.prepare(`SELECT * FROM pipeline_tasks WHERE queue_name = 'l2a_cut' AND message_id = 'msg_test_1'`).get();
  assert(task1.status === 'ok', `task1 status should be ok, got ${task1.status}`);
  assert(task1.result_payload.includes('TSLA'), 'task1 payload should contain extracted ticker TSLA');

  const wmL2a = db.prepare(`SELECT * FROM pipeline_watermarks WHERE pipeline_name = 'wm_l2a_cut'`).get();
  assert(wmL2a && Number(wmL2a.last_processed_ts) === now - 10000, 'wm_l2a_cut should be updated to msg timestamp');
  console.log('   ✅ l2a_cut 消费与水位更新通过！');

  // 2. 验证消费 timeline
  console.log('2. 验证离线消费 timeline 队列...');
  const tlRes = consumeTimelineQueue(db, { batchSize: 10 });
  assert(tlRes.processed === 1, `timeline processed should be 1, got ${tlRes.processed}`);

  const task2 = db.prepare(`SELECT * FROM pipeline_tasks WHERE queue_name = 'timeline' AND message_id = 'msg_test_2'`).get();
  assert(task2.status === 'ok', `task2 status should be ok, got ${task2.status}`);

  const wmTl = db.prepare(`SELECT * FROM pipeline_watermarks WHERE pipeline_name = 'wm_timeline'`).get();
  assert(wmTl && Number(wmTl.last_processed_ts) === now - 5000, 'wm_timeline should be updated');
  console.log('   ✅ timeline 消费与水位更新通过！');

  // 3. 验证幂等性（再次消费无任务）
  console.log('3. 验证二次消费幂等性 (0 pending)...');
  const l2aRes2 = consumeL2aQueue(db, { batchSize: 10 });
  const tlRes2 = consumeTimelineQueue(db, { batchSize: 10 });
  assert(l2aRes2.processed === 0, 'second l2a run should process 0');
  assert(tlRes2.processed === 0, 'second timeline run should process 0');
  console.log('   ✅ 幂等性验证通过！');

  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  console.log('\n🎉 ALL P1-8 TESTS PASSED: test_offline_queue_worker\n');
}

run().catch(err => {
  console.error('❌ P1-8 测试失败:', err);
  process.exit(1);
});
