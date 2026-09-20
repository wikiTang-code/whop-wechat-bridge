import assert from 'assert';
import Database from 'better-sqlite3';
import { analyzeTradeLifecycles } from '../tools/trade/historical_signals_lifecycle_analyzer.js';
import { syncPairedTradesToSignals } from '../tools/trade/sync_paired_trades_to_signals.js';

console.log('🧪 [Test DEBT-017] 历史交易单生命周期配对与信号同步单测');

// 1. 初始化内存测试数据库
const db = new Database(':memory:');

// 创建 messages 与 trade_signals 表
db.prepare(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    sender_id TEXT,
    sender_name TEXT,
    content TEXT,
    created_at INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE trade_signals (
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

console.log('  ✅ 1. 内存测试表结构创建完成');

// 2. 插入专属频道测试数据 (涵盖买入、卖出、群友混杂、不同标的)
const CH_EXCLUSIVE = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN';
const CH_OTHER = 'chat_feed_general_discussion';
const ZHAO_ID = 'user_4yeplXgbguTu4';
const NON_ZHAO_ID = 'user_fan_boy_999';

const testMsgs = [
  // 赵哥在专属频道买入 TSLL
  { id: 'm1', channel_id: CH_EXCLUSIVE, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '开仓买入 TSLL $10.5 准备做多', created_at: 1000000 },
  // 赵哥在专属频道加仓 TSLL
  { id: 'm2', channel_id: CH_EXCLUSIVE, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '继续低吸 TSLL $10.2 仓位', created_at: 2000000 },
  // 群友在专属频道跟帖买入 (必须被过滤)
  { id: 'm3', channel_id: CH_EXCLUSIVE, sender_id: NON_ZHAO_ID, sender_name: 'fanguan', content: '我也跟着买入 TSLL $10.3', created_at: 2500000 },
  // 赵哥在非专属频道买入 (必须被过滤)
  { id: 'm4', channel_id: CH_OTHER, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '闲聊区: 随便买入 TSLA $240', created_at: 3000000 },
  // 赵哥在专属频道减仓卖出 TSLL (配对 m1)
  { id: 'm5', channel_id: CH_EXCLUSIVE, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '减仓卖出 TSLL $12.0 止盈落袋', created_at: 4000000 },
  // 赵哥在专属频道清仓卖出 TSLL (配对 m2)
  { id: 'm6', channel_id: CH_EXCLUSIVE, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '清仓走人 TSLL $12.5 全出', created_at: 5000000 },
  // 赵哥在专属频道孤立卖出 NVDA (无前序买入)
  { id: 'm7', channel_id: CH_EXCLUSIVE, sender_id: ZHAO_ID, sender_name: 'xiaozhaolucky', content: '卖出 NVDA $120 锁定利润', created_at: 6000000 }
];

const insertMsg = db.prepare(`INSERT INTO messages (id, channel_id, sender_id, sender_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
for (const m of testMsgs) {
  insertMsg.run(m.id, m.channel_id, m.sender_id, m.sender_name, m.content, m.created_at);
}

console.log('  ✅ 2. 测试专属消息与大V身份隔离数据注入完成');

// 3. 执行生命周期分析验证
const analysisRes = analyzeTradeLifecycles(db, { outDir: false });
assert.strictEqual(analysisRes.total_channel_messages, 5, '专属频道赵哥发言应为 5 条 (排除群友与非专属频道)');
assert.strictEqual(analysisRes.completed_round_trips, 2, '应成功配对 2 对 TSLL 闭环交易');
assert.strictEqual(analysisRes.orphan_sells_count, 1, '应有 1 笔 NVDA 孤立卖出');
assert.strictEqual(analysisRes.sample_closed_trades[0].ticker, 'TSLL');
assert.strictEqual(analysisRes.sample_closed_trades[0].buy_price, 10.5);
assert.strictEqual(analysisRes.sample_closed_trades[0].sell_price, 12.0);
console.log('  ✅ 3. FIFO 闭环配对与大V过滤单测断言通过');

// 4. 执行落库与幂等性验证
const dryRes = syncPairedTradesToSignals(db, { apply: false, outDir: false });
assert.strictEqual(dryRes.signals_count, 4, '预计应生成 4 笔信号 (2对 x 2)');
assert.strictEqual(dryRes.final_trade_signals_count, 0, 'Dry-run 不应写入数据');

const applyRes = syncPairedTradesToSignals(db, { apply: true, outDir: false });
assert.strictEqual(applyRes.inserted_count, 4, 'Apply 应成功写入 4 笔信号');
assert.strictEqual(applyRes.final_trade_signals_count, 4, '写入后总数应为 4');

// 再次执行测试幂等性
const reApplyRes = syncPairedTradesToSignals(db, { apply: true, outDir: false });
assert.strictEqual(reApplyRes.inserted_count, 0, '重复执行新增应为 0');
assert.strictEqual(reApplyRes.skipped_count, 4, '重复执行应全部幂等跳过');
assert.strictEqual(reApplyRes.final_trade_signals_count, 4, '数据总数保持不变');

// 检查落库字段格式
const buySignal = db.prepare(`SELECT * FROM trade_signals WHERE action = 'BUY' ORDER BY created_at ASC LIMIT 1`).get();
assert.strictEqual(buySignal.ticker, 'TSLL');
assert.strictEqual(buySignal.price, 10.5);
assert.strictEqual(buySignal.speaker_id, ZHAO_ID);
assert.strictEqual(buySignal.source, 'lifecycle_paired_v1');

const sellSignal = db.prepare(`SELECT * FROM trade_signals WHERE action = 'SELL' ORDER BY created_at ASC LIMIT 1`).get();
assert.strictEqual(sellSignal.ticker, 'TSLL');
assert.strictEqual(sellSignal.price, 12.0);
assert(sellSignal.reason.includes('对应买入'), '卖出单备注应关联买入单据');

console.log('  ✅ 4. 幂等落库与关联字段完整性单测通过');
db.close();

// 5. 生产真实数据库门禁指标断言 (DEBT-017 Gate)
import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../tools/trade/historical_signals_lifecycle_analyzer.js';

if (fs.existsSync(DB_PATH)) {
  const realDb = new Database(DB_PATH, { readonly: true });
  const countRow = realDb.prepare('SELECT count(*) as c FROM trade_signals').get();
  assert.ok(countRow.c >= 1500, `DEBT-017 门禁：trade_signals 笔数应 >= 1,500 笔，实测: ${countRow.c}`);
  
  const reportPath = path.resolve('data/runtime/trade_lifecycle_summary.json');
  assert.ok(fs.existsSync(reportPath), 'trade_lifecycle_summary.json 诊断报告必须存在');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const pairRate = report.lifecycle_pairing_ratio_pct;
  assert.ok(pairRate >= 70, `DEBT-017 门禁：开平仓配对闭环率应 >= 70%，实测: ${pairRate}%`);
  
  console.log(`  ✅ 5. DEBT-017 核心门禁通过: trade_signals ${countRow.c} 笔 (>=1500), 闭环率 ${pairRate}% (>=70%)`);
  realDb.close();
}

console.log('🎉 [Test DEBT-017] 历史交易单生命周期配对与信号同步单测全部 PASS！\n');


