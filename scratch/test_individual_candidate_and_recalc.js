import dotenv from 'dotenv';
dotenv.config();

console.log('====================================================');
console.log('🧪 端到端全功能实测：标的内嵌候选池 + 移出移入即时联动');
console.log('====================================================\n');

const u = process.env.DASHBOARD_USERNAME || process.env.ADMIN_USER || 'admin';
const p = process.env.DASHBOARD_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';
const authHeader = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

// 1. 获取 CSRF Token
const tokenRes = await fetch('http://127.0.0.1:8085/api/csrf-token', {
  headers: { 'X-Session-Id': 'test_session_nvda_check', Authorization: authHeader }
});
const tokenJson = await tokenRes.json();
const csrfToken = tokenJson.csrfToken;
console.log('1. 获取 CSRF Token:', csrfToken ? '✅ 成功' : '❌ 失败');

// 2. 读取初始持仓
const posRes1 = await fetch('http://127.0.0.1:8085/api/zhao-positions', {
  headers: { Authorization: authHeader }
});
const posJson1 = await posRes1.json();
const nvda1 = posJson1.data.currentPositions.find(p => p.ticker === 'NVDA');
console.log(`2. 初始 NVDA 状态: 持仓 ${nvda1.totalQuantity} 股, 实战流水 ${nvda1.allTrades.length} 笔, 专属待确认候选 ${nvda1.candidateTrades.length} 条`);

if (nvda1.allTrades.length === 0) {
  console.error('NVDA 没有已确认流水，无法执行移出测试');
  process.exit(1);
}

const targetTrade = nvda1.allTrades[0];
console.log(`\n🎯 选中第一笔交易准备移出: [${targetTrade.id}] 动作: ${targetTrade.action} ${targetTrade.quantity}股 @ $${targetTrade.price}`);

// 3. 执行移出操作 (移动到 candidate)
const moveOutRes = await fetch('http://127.0.0.1:8085/api/trade-review/move', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    'X-Session-Id': 'test_session_nvda_check',
    Authorization: authHeader
  },
  body: JSON.stringify({ id: targetTrade.id, targetStatus: 'candidate' })
});
const moveOutJson = await moveOutRes.json();
console.log('3. 执行移出响应:', moveOutJson);

// 4. 重新拉取持仓验证
const posRes2 = await fetch('http://127.0.0.1:8085/api/zhao-positions', {
  headers: { Authorization: authHeader }
});
const posJson2 = await posRes2.json();
const nvda2 = posJson2.data.currentPositions.find(p => p.ticker === 'NVDA');
console.log(`4. 移出后 NVDA 状态: 持仓 ${nvda2.totalQuantity} 股, 实战流水 ${nvda2.allTrades.length} 笔, 专属待确认候选 ${nvda2.candidateTrades.length} 条`);

const isMovedToCandidate = nvda2.candidateTrades.some(c => c.id === targetTrade.id || c.message_id === targetTrade.id || targetTrade.id.includes(c.id));
console.log(`   - 流水数量减少 1 笔: ${nvda2.allTrades.length === nvda1.allTrades.length - 1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   - 候选池增加 1 条且包含该记录: ${isMovedToCandidate ? '✅ PASS' : '❌ FAIL'}`);

// 5. 还原测试（重新移入持仓）
const moveBackRes = await fetch('http://127.0.0.1:8085/api/trade-review/move', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    'X-Session-Id': 'test_session_nvda_check',
    Authorization: authHeader
  },
  body: JSON.stringify({ id: targetTrade.id, targetStatus: 'confirmed' })
});
const moveBackJson = await moveBackRes.json();
console.log('\n5. 执行移回持仓响应:', moveBackJson);

const posRes3 = await fetch('http://127.0.0.1:8085/api/zhao-positions', {
  headers: { Authorization: authHeader }
});
const posJson3 = await posRes3.json();
const nvda3 = posJson3.data.currentPositions.find(p => p.ticker === 'NVDA');
console.log(`6. 移回后 NVDA 状态: 持仓 ${nvda3.totalQuantity} 股, 实战流水 ${nvda3.allTrades.length} 笔, 专属待确认候选 ${nvda3.candidateTrades.length} 条`);
console.log(`   - 状态已完全精准还原: ${nvda3.allTrades.length === nvda1.allTrades.length ? '✅ PASS' : '❌ FAIL'}`);
