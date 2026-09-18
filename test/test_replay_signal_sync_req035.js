/**
 * test_replay_signal_sync_req035.js - REQ-035 历史回放纠错与 trade_signals 流水自动校准联动测试
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
  handleReplayCorrectionSubmit
} from '../follow-replay-engine.js';
import { saveTradeSignal, getTradeSignals } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, 'test_req035_scratch.db');

function cleanupDb() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = `${TEST_DB_PATH}${ext}`;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  }
}

console.log('===========================================================');
console.log('🧪 [Test REQ-035] 历史回放纠错与 trade_signals 流水自动校准测试');
console.log('===========================================================\n');

cleanupDb();
const db = new Database(TEST_DB_PATH);

try {
  // 1. 初始化数据库表结构 (trade_signals 与 follow_replay_queue)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS trade_signals (
      signal_id TEXT PRIMARY KEY,
      message_id TEXT,
      channel_id TEXT,
      speaker_id TEXT,
      speaker_name TEXT,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER,
      stop_loss REAL,
      reason TEXT,
      parse_status TEXT NOT NULL DEFAULT 'ok',
      source TEXT NOT NULL DEFAULT 'ai_extract',
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS trade_review_pool (
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

  initReplayTable(db);

  // 2. 写入原始历史单据 (含最初错误的解析)
  const originalTime = Date.now() - 3600000;
  const msgId = 'msg_test_035_001';
  db.prepare(`
    INSERT INTO follow_replay_queue (
      id, seq_no, message_id, pool_id, raw_content,
      parsed_ticker, parsed_action, parsed_price, parsed_qty,
      fraction_desc, fraction_ratio, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'replay_035_01', 1, msgId, 'pool_035_01', '866出剩下一半 855的lite',
    'LITE', 'SELL', 855.0, 100,
    '半仓', 0.5, 'pending', originalTime
  );

  console.log('--- 1. 验证用户提交纠错并触发 trade_signals 联动写入 ---');
  const token = generateReplayToken('replay_035_01', 'LITE', 'SELL');
  const correctionData = {
    id: 'replay_035_01',
    token,
    ticker: 'LITE',
    action: 'SELL',
    price: 866.0,          // 纠正为正确卖出价 866
    quantity: 50,           // 纠正为卖出 50 股
    fraction_desc: '出剩下一半',
    trade_time: originalTime,
    note: '人工纠错：866是卖出价，855是买入成本'
  };

  const res = await handleReplayCorrectionSubmit(correctionData, 'operator_user', db);
  assert.strictEqual(res.success, true, '纠错提交必须成功');

  // 3. 校验 follow_replay_queue 状态
  const updatedRow = db.prepare('SELECT * FROM follow_replay_queue WHERE id = ?').get('replay_035_01');
  assert.strictEqual(updatedRow.status, 'corrected', '队列状态应流转为 corrected');
  assert.strictEqual(updatedRow.parsed_price, 866.0, 'parsed_price 应修正为 866');
  assert.strictEqual(updatedRow.parsed_qty, 50, 'parsed_qty 应修正为 50');

  // 4. 核心断言：校验 trade_signals 表是否自动同步插入了纠错流水
  const signals = db.prepare(`
    SELECT * FROM trade_signals 
    WHERE message_id = ? AND source = 'manual_correct'
  `).all(msgId);

  assert.strictEqual(signals.length, 1, 'trade_signals 中必须精准新增 1 条 manual_correct 记录');
  const sig = signals[0];
  console.log('同步到的 trade_signal 记录:', {
    signal_id: sig.signal_id,
    ticker: sig.ticker,
    action: sig.action,
    price: sig.price,
    quantity: sig.quantity,
    source: sig.source,
    reason: sig.reason
  });

  assert.strictEqual(sig.ticker, 'LITE', '标的代码必须为 LITE');
  assert.strictEqual(sig.action, 'SELL', '操作方向必须为 SELL');
  assert.strictEqual(sig.price, 866.0, '价格必须校准为 866');
  assert.strictEqual(sig.quantity, 50, '股数必须校准为 50');
  assert.strictEqual(sig.source, 'manual_correct', 'source 标识必须为 manual_correct');
  assert.strictEqual(sig.speaker_name, '赵哥(人工修正)', '播报人应标明赵哥(人工修正)');
  assert.ok(sig.reason.includes('回放纠错 #1'), 'reason 必须包含回放纠错序号');

  console.log('✅ trade_signals 纠错流水自动校准同步验证通过\n');

  // 5. 校验通过 getTradeSignals 查询的一致性
  console.log('--- 2. 验证通过 getTradeSignals API 查询的一致性 ---');
  const queryRes = getTradeSignals({ ticker: 'LITE', dbInstance: db });
  assert.ok(queryRes.signals.some(s => s.signal_id === sig.signal_id && s.source === 'manual_correct'), 'getTradeSignals 必须能够检索出纠错后的记录');
  console.log('✅ getTradeSignals API 检索校验通过\n');

  // 6. 验证二次纠错覆盖与幂等更新
  console.log('--- 3. 验证二次纠错更新与流水记录 ---');
  const token2 = generateReplayToken('replay_035_01', 'LITE', 'SELL');
  const res2 = await handleReplayCorrectionSubmit({
    id: 'replay_035_01',
    token: token2,
    ticker: 'LITE',
    action: 'SELL',
    price: 868.5,
    quantity: 60,
    fraction_desc: '出剩下一大半',
    note: '二次微调'
  }, 'operator_user', db);

  assert.strictEqual(res2.success, true);
  const updatedRow2 = db.prepare('SELECT * FROM follow_replay_queue WHERE id = ?').get('replay_035_01');
  assert.strictEqual(updatedRow2.parsed_price, 868.5);

  const signalsAfterSecond = db.prepare(`
    SELECT * FROM trade_signals 
    WHERE message_id = ? AND source = 'manual_correct'
    ORDER BY created_at DESC
  `).all(msgId);
  assert.ok(signalsAfterSecond.length >= 1, '应存在校准记录');
  assert.strictEqual(signalsAfterSecond[0].price, 868.5, '最新流水价格应为 868.5');

  console.log('✅ 二次纠错校准验证通过\n');

  console.log('===========================================================');
  console.log('🎉 REQ-035 历史回放纠错与 trade_signals 流水自动校准套件全部 PASS！');
  console.log('===========================================================\n');

} finally {
  try { db.close(); } catch (_) {}
  cleanupDb();
}
