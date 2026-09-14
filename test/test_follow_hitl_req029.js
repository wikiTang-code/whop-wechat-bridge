process.env.NODE_ENV = 'test';
import assert from 'assert';
import {
  generateHitlToken,
  verifyHitlToken,
  generateFollowCardPayload,
  handleFollowHitlCallback
} from '../follow-hitl.js';
import { getDb, initDb, saveFollowDecision } from '../database.js';

initDb();
const db = getDb();

console.log('===========================================================');
console.log('🧪 [Test REQ-029/CHG-009] 移动端跟单确认卡片与业务 HITL 回调验证');
console.log('===========================================================\n');

// 设置测试环境变量
process.env.WECOM_HITL_SECRET = 'test_hitl_secret_key_123';
process.env.WECOM_FOLLOW_USERIDS = 'admin_user,trader_bob';

// -------------------------------------------------------------
// 1. 签名与卡片载荷测试 (generateFollowCardPayload)
// -------------------------------------------------------------
console.log('--- 1. 测试 Token 签名与卡片生成 ---');
const testDecId = 'dec_hitl_test_' + Date.now();
const testCreatedAt = Date.now();

const token = generateHitlToken(testDecId, 'NVDA', 'BUY', testCreatedAt);
assert(token && token.length === 32, 'Token 应为 32 位 HMAC 摘要');
assert(verifyHitlToken(testDecId, 'NVDA', 'BUY', testCreatedAt, token), '合法 Token 验签应通过');
assert(!verifyHitlToken(testDecId, 'NVDA', 'BUY', testCreatedAt, 'fake_token_value'), '伪造 Token 验签必须失败');
assert(!verifyHitlToken(testDecId, 'NVDA', 'SELL', testCreatedAt, token), '篡改动作方向验签必须失败');

const cardPayload = generateFollowCardPayload({
  decision_id: testDecId,
  ticker: 'NVDA',
  side: 'BUY',
  call_price: 150.0,
  arrival_price: 150.2,
  slip_bps: 13.3,
  created_at: testCreatedAt
});
assert.strictEqual(cardPayload.card_type, 'follow_execution_confirm');
assert.strictEqual(cardPayload.actions.length, 3, '卡片必须具备 EXECUTE / SKIP / PARSE_ERROR 三大动作');
console.log('✅ Token 签名防篡改与卡片载荷测试通过');

// -------------------------------------------------------------
// 2. 正常确认下单流程测试 (EXECUTE)
// -------------------------------------------------------------
console.log('\n--- 2. 测试用户点击卡片确认实盘跟单 (EXECUTE) ---');
const decRecord1 = {
  decision_id: 'dec_exec_' + Date.now(),
  action_id: 'act_001',
  cu_id: 'cu_001',
  signal_id: 'sig_001',
  account_type: 'real',
  decision_state: 'WAIT_MANUAL_CONFIRM',
  ticker: 'NVDA',
  side: 'BUY',
  call_price: 150.0,
  arrival_price: 150.2,
  slip_bps: 13.3,
  ttl_remaining_sec: 85,
  executed_qty: 10,
  created_at: Date.now()
};
saveFollowDecision(decRecord1);

const validToken1 = generateHitlToken(decRecord1.decision_id, decRecord1.ticker, decRecord1.side, decRecord1.created_at);

const execRes = await handleFollowHitlCallback({
  decision_id: decRecord1.decision_id,
  action: 'EXECUTE',
  userid: 'admin_user',
  token: validToken1,
  nowMs: decRecord1.created_at + 5000 // 5s 内点击
});

assert.strictEqual(execRes.success, true);
assert.strictEqual(execRes.decision_state, 'APPROVED_BY_USER');

// 验证数据库状态流转为已授权
const decInDb = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(decRecord1.decision_id);
assert.strictEqual(decInDb.decision_state, 'APPROVED_BY_USER');
console.log('✅ 用户授权实盘下单闭环成功通过');

// -------------------------------------------------------------
// 3. 放弃流程测试 (SKIP)
// -------------------------------------------------------------
console.log('\n--- 3. 测试用户点击放弃本次跟单 (SKIP) ---');
const decRecord2 = {
  decision_id: 'dec_skip_' + Date.now(),
  action_id: 'act_002',
  cu_id: 'cu_002',
  signal_id: 'sig_002',
  account_type: 'real',
  decision_state: 'WAIT_MANUAL_CONFIRM',
  ticker: 'TSLA',
  side: 'SELL',
  call_price: 250.0,
  arrival_price: 249.5,
  slip_bps: 20,
  ttl_remaining_sec: 80,
  executed_qty: 20,
  created_at: Date.now()
};
saveFollowDecision(decRecord2);

const validToken2 = generateHitlToken(decRecord2.decision_id, decRecord2.ticker, decRecord2.side, decRecord2.created_at);

const skipRes = await handleFollowHitlCallback({
  decision_id: decRecord2.decision_id,
  action: 'SKIP',
  userid: 'trader_bob',
  token: validToken2,
  nowMs: decRecord2.created_at + 10000 // 10s 内点击
});

assert.strictEqual(skipRes.success, true);
assert.strictEqual(skipRes.decision_state, 'SKIPPED_BY_USER');

const dec2InDb = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(decRecord2.decision_id);
assert.strictEqual(dec2InDb.decision_state, 'SKIPPED_BY_USER');
console.log('✅ 放弃跟单状态流转验证通过');

// -------------------------------------------------------------
// 4. 解析错误反馈流程测试 (PARSE_ERROR)
// -------------------------------------------------------------
console.log('\n--- 4. 测试用户反馈解析错误 (PARSE_ERROR) ---');
const decRecord3 = {
  decision_id: 'dec_err_' + Date.now(),
  action_id: 'act_003',
  cu_id: 'cu_003',
  signal_id: 'sig_003',
  message_id: 'msg_err_003',
  account_type: 'real',
  decision_state: 'WAIT_MANUAL_CONFIRM',
  ticker: 'BOGUS',
  side: 'BUY',
  call_price: 10.0,
  arrival_price: 10.0,
  slip_bps: 0,
  ttl_remaining_sec: 75,
  executed_qty: 100,
  created_at: Date.now()
};
saveFollowDecision(decRecord3);

const validToken3 = generateHitlToken(decRecord3.decision_id, decRecord3.ticker, decRecord3.side, decRecord3.created_at);

const errRes = await handleFollowHitlCallback({
  decision_id: decRecord3.decision_id,
  action: 'PARSE_ERROR',
  userid: 'admin_user',
  token: validToken3,
  nowMs: decRecord3.created_at + 15000
});

assert.strictEqual(errRes.success, true);
assert.strictEqual(errRes.decision_state, 'PARSE_ERROR_REPORTED');

const dec3InDb = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(decRecord3.decision_id);
assert.strictEqual(dec3InDb.decision_state, 'PARSE_ERROR_REPORTED');
console.log('✅ 解析错误反馈与质量标记验证通过');

// -------------------------------------------------------------
// 5. 90秒硬超时拦截测试 (SKIP_MANUAL_TIMEOUT)
// -------------------------------------------------------------
console.log('\n--- 5. 测试 90 秒无操作自动超时放弃 ---');
const decRecord4 = {
  decision_id: 'dec_timeout_' + Date.now(),
  action_id: 'act_004',
  cu_id: 'cu_004',
  signal_id: 'sig_004',
  account_type: 'real',
  decision_state: 'WAIT_MANUAL_CONFIRM',
  ticker: 'AAPL',
  side: 'BUY',
  call_price: 220.0,
  arrival_price: 220.0,
  slip_bps: 0,
  ttl_remaining_sec: 90,
  executed_qty: 50,
  created_at: Date.now() - 95000 // 95秒前
};
saveFollowDecision(decRecord4);

const validToken4 = generateHitlToken(decRecord4.decision_id, decRecord4.ticker, decRecord4.side, decRecord4.created_at);

const timeoutRes = await handleFollowHitlCallback({
  decision_id: decRecord4.decision_id,
  action: 'EXECUTE',
  userid: 'admin_user',
  token: validToken4,
  nowMs: Date.now() // 超过90秒后点击
});

assert.strictEqual(timeoutRes.success, false);
assert.strictEqual(timeoutRes.code, 408, '超时应返回 408 状态码');

const dec4InDb = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(decRecord4.decision_id);
assert.strictEqual(dec4InDb.decision_state, 'SKIP_MANUAL_TIMEOUT');
console.log('✅ 90 秒硬超时判定与销毁卡片验证通过');

// -------------------------------------------------------------
// 6. 安全边界：防重放攻击测试 (Replay Attack Prevention)
// -------------------------------------------------------------
console.log('\n--- 6. 测试防重放攻击拦截 (Replay Protection) ---');
// 对已经 EXECUTE 过的 decRecord1 进行二次点击
const replayRes = await handleFollowHitlCallback({
  decision_id: decRecord1.decision_id,
  action: 'EXECUTE',
  userid: 'admin_user',
  token: validToken1,
  nowMs: decRecord1.created_at + 8000
});

assert.strictEqual(replayRes.success, false);
assert.strictEqual(replayRes.code, 409, '重复操作必须返回 409 Conflict 阻断');
console.log('✅ 重复点击与防重放拦截有效');

// -------------------------------------------------------------
// 7. 安全边界：白名单与越权拦截测试 (Authorization Check)
// -------------------------------------------------------------
console.log('\n--- 7. 测试未授权 UserID 越权拦截 ---');
const hackRes = await handleFollowHitlCallback({
  decision_id: decRecord2.decision_id,
  action: 'EXECUTE',
  userid: 'attacker_hacker',
  token: validToken2
});

assert.strictEqual(hackRes.success, false);
assert.strictEqual(hackRes.code, 403, '非白名单用户必须返回 403 Forbidden');
console.log('✅ 非白名单人员越权拦截有效');

// 清理测试临时数据
db.prepare("DELETE FROM follow_decisions WHERE decision_id LIKE 'dec_%'").run();
console.log('\n🎉 REQ-029 / CHG-009 移动端跟单卡片与业务 HITL 回调全量通过！');
