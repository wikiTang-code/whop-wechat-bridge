process.env.NODE_ENV = 'test';
import assert from 'assert';
import {
  calculateSlipBps,
  evaluateFollowDecision,
  processFollowDecision,
  FOLLOW_SPEC
} from '../follow-decision-engine.js';
import { getDb, initDb, getFollowDecisions, getOrders, getPositions } from '../database.js';
import { executeOrder } from '../trading.js';

initDb();
const db = getDb();

// 保证沙盒测试环境现金充足
try {
  const curCash = db.prepare("SELECT value FROM portfolio WHERE key = 'cash'").get()?.value || 0;
  if (curCash < 50000) {
    db.prepare("UPDATE portfolio SET value = 100000 WHERE key = 'cash'").run();
  }
} catch (e) {}

console.log('===========================================================');
console.log('🧪 [Test REQ-028] Paper 跟单状态机与风控五大状态验证套件');
console.log('===========================================================\n');

// -------------------------------------------------------------
// 1. 滑点计算单元测试 (calculateSlipBps)
// -------------------------------------------------------------
console.log('--- 1. 测试滑点基点计算 (calculateSlipBps) ---');
// 买入
assert.strictEqual(calculateSlipBps('BUY', 100, 100), 0, '平价买入滑点应为 0bp');
assert.strictEqual(calculateSlipBps('BUY', 100, 100.20), 20, '100->100.20 买入滑点应为 20bp');
assert.strictEqual(calculateSlipBps('BUY', 100, 100.35), 35, '100->100.35 买入滑点应为 35bp');
assert.strictEqual(calculateSlipBps('BUY', 100, 100.45), 45, '100->100.45 买入滑点应为 45bp');
assert.strictEqual(calculateSlipBps('BUY', 100, 99.50), 0, '折价买入应视为 0bp 顺风利好');

// 卖出
assert.strictEqual(calculateSlipBps('SELL', 100, 100), 0, '平价卖出滑点应为 0bp');
assert.strictEqual(calculateSlipBps('SELL', 100, 99.80), 20, '100->99.80 卖出滑点应为 20bp');
assert.strictEqual(calculateSlipBps('SELL', 100, 99.65), 35, '100->99.65 卖出滑点应为 35bp');
assert.strictEqual(calculateSlipBps('SELL', 100, 99.50), 50, '100->99.50 卖出滑点应为 50bp');
assert.strictEqual(calculateSlipBps('SELL', 100, 101.00), 0, '溢价卖出应视为 0bp 顺风利好');
console.log('✅ 滑点计算完全符合基点定义 (1bp = 0.01%)');

// -------------------------------------------------------------
// 2. 状态机评估逻辑测试 (evaluateFollowDecision)
// -------------------------------------------------------------
console.log('\n--- 2. 测试五大跟单执行状态机 (Execution States) ---');
const now = Date.now();

// 2.1 FIRE: 滑点 <= 20bp 且未超时
const fireRes = evaluateFollowDecision({
  action: 'BUY',
  ticker: 'INTC',
  callPrice: 100,
  arrivalPrice: 100.15, // 15bp
  msgCreatedAt: now - 10000, // 10秒前
  nowMs: now
});
assert.strictEqual(fireRes.decision_state, 'FIRE', '15bp 滑点且未超时应判定为 FIRE');
assert.strictEqual(fireRes.target_ratio, 1.0, 'FIRE 应为 100% 仓位');

// 2.2 SIZE_DOWN: 滑点 (20bp, 40bp] 之间
const sizeDownRes = evaluateFollowDecision({
  action: 'BUY',
  ticker: 'INTC',
  callPrice: 100,
  arrivalPrice: 100.30, // 30bp
  msgCreatedAt: now - 20000, // 20秒前
  nowMs: now
});
assert.strictEqual(sizeDownRes.decision_state, 'SIZE_DOWN', '30bp 滑点应判定为 SIZE_DOWN');
assert.strictEqual(sizeDownRes.target_ratio, 0.5, 'SIZE_DOWN 应为 50% 仓位');

// 2.3 SLIP_REJECT: 滑点 > 40bp
const rejectRes = evaluateFollowDecision({
  action: 'BUY',
  ticker: 'INTC',
  callPrice: 100,
  arrivalPrice: 100.55, // 55bp
  msgCreatedAt: now - 15000, // 15秒前
  nowMs: now
});
assert.strictEqual(rejectRes.decision_state, 'SLIP_REJECT', '55bp 滑点应判定为 SLIP_REJECT');
assert.strictEqual(rejectRes.target_ratio, 0, 'SLIP_REJECT 严禁追高');

// 2.4 EXPIRED: 超过 90 秒 TTL
const expiredRes = evaluateFollowDecision({
  action: 'BUY',
  ticker: 'INTC',
  callPrice: 100,
  arrivalPrice: 100, // 无滑点
  msgCreatedAt: now - 95000, // 95秒前
  nowMs: now
});
assert.strictEqual(expiredRes.decision_state, 'EXPIRED', '95秒前消息应判定为 EXPIRED');

// 2.5 SKIP_NO_POS: SELL 但当前账户无底仓
const skipRes = evaluateFollowDecision({
  action: 'SELL',
  ticker: 'NONEXISTENT_TICKER',
  callPrice: 50,
  arrivalPrice: 50,
  msgCreatedAt: now - 10000,
  currentPositions: [{ ticker: 'AAPL', quantity: 100 }],
  nowMs: now
});
assert.strictEqual(skipRes.decision_state, 'SKIP_NO_POS', '无底仓卖出应判定为 SKIP_NO_POS');
console.log('✅ 五大状态机 (FIRE / SIZE_DOWN / SLIP_REJECT / EXPIRED / SKIP_NO_POS) 判定完全精准');

// -------------------------------------------------------------
// 3. 完整决策引擎落库与 Paper 执行测试 (processFollowDecision)
// -------------------------------------------------------------
console.log('\n--- 3. 测试 processFollowDecision 落库与 Paper 撮合闭环 ---');

// 3.1 测试 FIRE 状态下的 Paper 执行
const testSym = 'TSTP_' + Math.floor(Math.random() * 1000);
const fireOutcome = await processFollowDecision({
  signal: {
    ticker: testSym,
    action: 'BUY',
    price: 50.0,
    quantity: 100,
    reason: 'Paper 状态机单元测试 FIRE'
  },
  arrivalPrice: 50.08, // 16bp 滑点 -> FIRE
  msgCreatedAt: Date.now() - 5000, // 5s 前
  accountType: 'paper'
});

assert.strictEqual(fireOutcome.decision.decision_state, 'FIRE');
assert.strictEqual(fireOutcome.executed, true, 'FIRE 应成功执行模拟下单');
assert.strictEqual(fireOutcome.decision.executed_qty, 100);

// 验证 follow_decisions 表是否记录
const decInDb = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(fireOutcome.decision.decision_id);
assert(decInDb, 'follow_decisions 表必须成功落库');
assert.strictEqual(decInDb.decision_state, 'FIRE');
assert.strictEqual(decInDb.account_type, 'paper');

// 验证 orders 表是否保存并带有 account_type = 'paper'
const orderInDb = db.prepare('SELECT * FROM orders WHERE ticker = ? ORDER BY created_at DESC LIMIT 1').get(testSym);
assert(orderInDb, 'orders 表必须生成对应订单');
assert.strictEqual(orderInDb.account_type, 'paper', '订单 account_type 必须是 paper');

// 3.2 测试 SIZE_DOWN 状态下的减半执行
const sizeDownOutcome = await processFollowDecision({
  signal: {
    ticker: testSym,
    action: 'BUY',
    price: 50.0,
    quantity: 100,
    reason: 'Paper 状态机单元测试 SIZE_DOWN'
  },
  arrivalPrice: 50.15, // 30bp 滑点 -> SIZE_DOWN
  msgCreatedAt: Date.now() - 10000,
  accountType: 'paper'
});
assert.strictEqual(sizeDownOutcome.decision.decision_state, 'SIZE_DOWN');
assert.strictEqual(sizeDownOutcome.executed, true);
assert.strictEqual(sizeDownOutcome.decision.executed_qty, 50, 'SIZE_DOWN 实际执行股数必须自动减半为 50 股');

// 3.3 测试 SLIP_REJECT 不生成任何订单
const ordersBeforeReject = db.prepare('SELECT COUNT(*) as c FROM orders WHERE ticker = ?').get(testSym).c;
const rejectOutcome = await processFollowDecision({
  signal: {
    ticker: testSym,
    action: 'BUY',
    price: 50.0,
    quantity: 100,
    reason: 'Paper 状态机单元测试 SLIP_REJECT'
  },
  arrivalPrice: 50.50, // 100bp 滑点 -> SLIP_REJECT
  msgCreatedAt: Date.now() - 5000,
  accountType: 'paper'
});
assert.strictEqual(rejectOutcome.decision.decision_state, 'SLIP_REJECT');
assert.strictEqual(rejectOutcome.executed, false, 'SLIP_REJECT 严禁执行下单');
const ordersAfterReject = db.prepare('SELECT COUNT(*) as c FROM orders WHERE ticker = ?').get(testSym).c;
assert.strictEqual(ordersBeforeReject, ordersAfterReject, '拒单严禁产生新订单');

// 3.4 测试 EXPIRED 不生成任何订单
const expiredOutcome = await processFollowDecision({
  signal: {
    ticker: testSym,
    action: 'BUY',
    price: 50.0,
    quantity: 100,
    reason: 'Paper 状态机单元测试 EXPIRED'
  },
  arrivalPrice: 50.0,
  msgCreatedAt: Date.now() - 120000, // 120s 前超时
  accountType: 'paper'
});
assert.strictEqual(expiredOutcome.decision.decision_state, 'EXPIRED');
assert.strictEqual(expiredOutcome.executed, false, '超时单严禁执行');

// 清理测试数据
db.prepare('DELETE FROM follow_decisions WHERE ticker = ?').run(testSym);
db.prepare('DELETE FROM orders WHERE ticker = ?').run(testSym);
db.prepare('DELETE FROM positions WHERE ticker = ?').run(testSym);
console.log('✅ Paper 状态机全生命周期决策流转与模拟撮合验证通过');

// -------------------------------------------------------------
// 4. 资金安全红线测试（实盘全自动拦截门禁）
// -------------------------------------------------------------
console.log('\n--- 4. 测试实盘全自动下单阻断红线 (Safety Redline) ---');
const realBlockOutcome = await processFollowDecision({
  signal: {
    ticker: 'AAPL',
    action: 'BUY',
    price: 200.0,
    quantity: 10,
    reason: '非法全自动实盘测试'
  },
  arrivalPrice: 200.0,
  msgCreatedAt: Date.now(),
  accountType: 'real' // 试图请求实盘
});

assert.strictEqual(realBlockOutcome.executed, false, '未获人工授权前严禁全自动调用实盘');
assert(realBlockOutcome.executionResult.reason.includes('实盘禁止全自动'), '必须给出实盘禁止全自动的安全提示');

// 直接调用 executeOrder 未授权实盘拦截
const directRealExec = await executeOrder({
  ticker: 'AAPL',
  action: 'BUY',
  price: 200.0,
  quantity: 10,
  account_type: 'real',
  isApprovedReal: false // 未授权
});
assert.strictEqual(directRealExec.success, false);
assert.strictEqual(directRealExec.mode, 'BLOCKED_BY_SAFETY_LINE', '资金安全红线必须硬拦截');

console.log('✅ 实盘全自动下单拦截红线牢不可破');

// 清理测试生成的临时标的与订单
try {
  db.prepare("DELETE FROM orders WHERE ticker LIKE 'TSTP_%'").run();
  db.prepare("DELETE FROM positions WHERE ticker LIKE 'TSTP_%'").run();
  db.prepare("DELETE FROM follow_decisions WHERE ticker LIKE 'TSTP_%'").run();
} catch (e) {}

console.log('\n🎉 REQ-028 Paper 跟单状态机全量测试套件通过！');
