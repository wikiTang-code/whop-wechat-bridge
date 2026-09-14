import assert from 'assert';
import { getDb, initDb, getZhaoPositions, saveZhaoPosition, clearZhaoPositions, saveFollowDecision, getFollowDecisions } from '../database.js';

initDb();
const db = getDb();

console.log('--- [Test REQ-027] 三账本隔离与看板分源回归验证 ---');

// 1. 验证 zhao_positions 与 positions 物理隔离
const origPositionsCount = db.prepare('SELECT COUNT(*) as c FROM positions').get().c;
const testTicker = 'TEST_' + Date.now();

// 插入一条赵哥持仓
saveZhaoPosition({
  ticker: testTicker,
  quantity: 100,
  average_entry_price: 50.0,
  current_price: 55.0,
  market_value: 5500.0,
  unrealized_pnl: 500.0,
  updated_at: Date.now()
});

const zhaoFound = db.prepare('SELECT * FROM zhao_positions WHERE ticker = ?').get(testTicker);
assert(zhaoFound, 'zhao_positions 应成功写入');
assert.strictEqual(zhaoFound.quantity, 100);

// 确认个人 positions 表未受任何波及
const newPositionsCount = db.prepare('SELECT COUNT(*) as c FROM positions').get().c;
assert.strictEqual(origPositionsCount, newPositionsCount, '个人 positions 表记录数严禁发生任何变化');

const leakCheck = db.prepare('SELECT * FROM positions WHERE ticker = ?').get(testTicker);
assert(!leakCheck, '个人 positions 表严禁出现赵哥专属标的');

// 清理测试标的
db.prepare('DELETE FROM zhao_positions WHERE ticker = ?').run(testTicker);
console.log('✅ 1. zhao_positions 与 positions 物理隔离与无污染验证通过');

// 2. 验证 follow_decisions 意图决策账本
const testDecisionId = 'dec_test_' + Date.now();
saveFollowDecision({
  decision_id: testDecisionId,
  signal_id: 'sig_test_001',
  message_id: 'msg_test_001',
  account_type: 'paper',
  decision_state: 'APPROVED',
  ticker: 'INTC',
  side: 'BUY',
  call_price: 90.0,
  arrival_price: 90.5,
  slip_bps: 5.5,
  ttl_remaining_sec: 120,
  executed_qty: 10,
  reason: '跟随赵哥加仓'
});

const decQuery = getFollowDecisions({ accountType: 'paper' });
const match = decQuery.decisions.find(d => d.decision_id === testDecisionId);
assert(match, 'follow_decisions 应能按 account_type 查询到');
assert.strictEqual(match.decision_state, 'APPROVED');
assert.strictEqual(match.ticker, 'INTC');

// 清理测试决策
db.prepare('DELETE FROM follow_decisions WHERE decision_id = ?').run(testDecisionId);
console.log('✅ 2. follow_decisions 决策账本状态机存取验证通过');

// 3. 验证 orders 表 account_type 字段
const ordersCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
assert(ordersCols.includes('account_type'), 'orders 表必须包含 account_type 字段区分个人跟单仓类型');
console.log('✅ 3. orders 表 account_type 字段完整性验证通过');

console.log('🎉 REQ-027 核心账本隔离与回归测试全部通过！\n');
