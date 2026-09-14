/**
 * test_follow_replay_req033.js - REQ-033 历史大V交易单回放与移动端纠错反馈单元测试
 */

process.env.NODE_ENV = 'test';
import assert from 'assert';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initReplayTable,
  generateReplayToken,
  verifyReplayToken,
  loadReplayCandidates,
  getNextPendingReplayItem,
  buildReplayWeComMessage,
  handleReplayConfirmSkip,
  handleReplayCorrectionSubmit
} from '../follow-replay-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, 'test_replay_scratch.db');

function cleanupDb() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = `${TEST_DB_PATH}${ext}`;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  }
}

console.log('===========================================================');
console.log('🧪 [Test REQ-033] 历史大V交易单回放与移动端纠错反馈测试套件');
console.log('===========================================================\n');

cleanupDb();
const db = new Database(TEST_DB_PATH);

try {
  // 1. 创建 mock trade_review_pool
  db.prepare(`
    CREATE TABLE trade_review_pool (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      ticker TEXT,
      action TEXT,
      price REAL,
      fraction_name TEXT,
      fraction_ratio REAL,
      before_qty INTEGER,
      before_avg_cost REAL,
      after_qty INTEGER,
      after_avg_cost REAL,
      raw_content TEXT,
      status TEXT,
      is_manual INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  const mockTime = Date.parse('2026-05-18T10:00:00Z');
  db.prepare(`
    INSERT INTO trade_review_pool VALUES 
    ('p1', 'm1', 'TSLL', 'BUY', 13.5, '0.5笔常规仓', 0.5, 100, 13.0, 150, 13.17, '13.5入点tsll 常规仓的一半', 'candidate', 0, ?, ?),
    ('p2', 'm2', 'CIFR', 'BUY', 18.15, '半仓', 0.5, 200, 17.5, 100, 17.5, '18.15出 cifr剩下的一半', 'candidate', 0, ?, ?)
  `).run(mockTime, mockTime, mockTime + 1000, mockTime + 1000);

  // 2. 初始化与加载候选
  console.log('--- 1. 验证候选池单据加载与初始化 ---');
  initReplayTable(db);
  const loaded = loadReplayCandidates(db, mockTime - 1000);
  assert.strictEqual(loaded, 2, '应成功加载 2 条待审候选');

  const { item: item1, stats: s1 } = getNextPendingReplayItem(db);
  assert.strictEqual(item1.id, 'rpl_p1');
  assert.strictEqual(item1.parsed_ticker, 'TSLL');
  assert.strictEqual(s1.total, 2);
  assert.strictEqual(s1.pending, 2);
  console.log('✅ 候选单据按时间序列成功入队');

  // 3. 验证卡片内容构建与签名 Token
  console.log('\n--- 2. 验证企微卡片构建与防篡改 Token ---');
  const card = buildReplayWeComMessage(item1, s1);
  assert(card.text.includes('TSLL'));
  assert(card.text.includes('13.5入点tsll'));
  assert(card.confirmSkipUrl.includes('CONFIRM_SKIP'));
  assert(card.correctFormUrl.includes('/follow/correct'));

  const token = generateReplayToken(item1.id, item1.parsed_ticker, item1.parsed_action);
  assert.strictEqual(verifyReplayToken(item1.id, item1.parsed_ticker, item1.parsed_action, token), true);
  assert.strictEqual(verifyReplayToken(item1.id, 'OTHER', item1.parsed_action, token), false);
  console.log('✅ 卡片渲染与 HMAC 签名验证通过');

  // 4. 验证用户对第 1 条点击「确认解析正确 (跳过交易)」
  console.log('\n--- 3. 验证路径 A: 一键确认跳过 ---');
  const skipRes = await handleReplayConfirmSkip(item1.id, token, 'test_user', db);
  assert.strictEqual(skipRes.success, true);

  // 验证第 1 条状态变更
  const row1 = db.prepare("SELECT * FROM follow_replay_queue WHERE id = 'rpl_p1'").get();
  assert.strictEqual(row1.status, 'confirmed_skip');
  // 验证原池状态同步
  const pool1 = db.prepare("SELECT * FROM trade_review_pool WHERE id = 'p1'").get();
  assert.strictEqual(pool1.status, 'confirmed');

  // 验证队头自动推进到第 2 条
  const { item: item2, stats: s2 } = getNextPendingReplayItem(db);
  assert.strictEqual(item2.id, 'rpl_p2');
  assert.strictEqual(item2.parsed_ticker, 'CIFR');
  assert.strictEqual(s2.processed, 1);
  assert.strictEqual(s2.pending, 1);
  console.log('✅ 一键确认跳过成功，原池同步更新，队列自动步进');

  // 5. 验证用户对第 2 条（错误解析）提交修正表单
  console.log('\n--- 4. 验证路径 B: 移动端修改基础要素并提交纠错 ---');
  const token2 = generateReplayToken(item2.id, item2.parsed_ticker, item2.parsed_action);
  // 原文是 '18.15出 cifr剩下的一半'，但原解析成 BUY，用户修改为 SELL
  const correctionData = {
    id: item2.id,
    token: token2,
    ticker: 'CIFR',
    action: 'SELL', // 纠错为卖出
    price: 18.15,
    quantity: 200,
    trade_time: '2026-05-18T10:00:01.000Z',
    note: '原文为出剩余一半，修正为卖出'
  };

  const correctRes = await handleReplayCorrectionSubmit(correctionData, 'test_user', db);
  assert.strictEqual(correctRes.success, true);

  // 验证第 2 条状态变更为 corrected，且保存了修正前后对照
  const row2 = db.prepare("SELECT * FROM follow_replay_queue WHERE id = 'rpl_p2'").get();
  assert.strictEqual(row2.status, 'corrected');
  const savedCorrection = JSON.parse(row2.corrected_json);
  assert.strictEqual(savedCorrection.original.action, 'BUY');
  assert.strictEqual(savedCorrection.corrected.action, 'SELL');
  assert.strictEqual(savedCorrection.corrected.totalAmount, '3630.00');

  // 验证原池 trade_review_pool 被正确覆盖并打上 is_manual = 1
  const pool2 = db.prepare("SELECT * FROM trade_review_pool WHERE id = 'p2'").get();
  assert.strictEqual(pool2.action, 'SELL', '原池交易方向必须修正为 SELL');
  assert.strictEqual(pool2.is_manual, 1, '原池必须打上 is_manual = 1 标识');

  // 验证队列已经全部完成
  const { item: itemEnd, stats: sEnd } = getNextPendingReplayItem(db);
  assert.strictEqual(itemEnd, null, '队列应该已全部完成');
  assert.strictEqual(sEnd.total, 2);
  assert.strictEqual(sEnd.processed, 2);
  assert.strictEqual(sEnd.confirmed, 1);
  assert.strictEqual(sEnd.corrected, 1);
  console.log('✅ 移动端要素纠错回写成功，金额自动联动核算准确，全部队列闭环');

  console.log('\n🎉 REQ-033 历史大V单回放与纠错反馈测试套件全部 PASS！\n');
} finally {
  db.close();
  cleanupDb();
}
