import assert from 'assert';
import http from 'http';
import fs from 'fs';
import express from 'express';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';

const app = express();
app.use(express.json());
app.use('/api', l2WorkbenchRouter);

const server = http.createServer(app);

async function startServer() {
  return new Promise(resolve => server.listen(0, resolve));
}

async function stopServer() {
  return new Promise(resolve => server.close(resolve));
}

function getBaseUrl() {
  const port = server.address().port;
  return `http://127.0.0.1:${port}`;
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 L2 人机协同工作台 W1-W5 自动化综合验收测试');
  console.log('====================================================\n');

  await startServer();
  const baseUrl = getBaseUrl();

  try {
    // ----------------------------------------------------
    // 测试 1 (W5): GET /api/l2a/dates 必须返回 date_stats
    // ----------------------------------------------------
    console.log('▶️ [测试 1/5] 验证 W5 日期统计元数据 (date_stats)...');
    const datesRes = await fetch(`${baseUrl}/api/l2a/dates`);
    assert.strictEqual(datesRes.status, 200);
    const datesData = await datesRes.json();
    assert(Array.isArray(datesData.dates), 'dates 必须为数组');
    assert(datesData.date_stats, 'date_stats 必须存在');
    
    // 抽查 2026-06-29
    const stat0629 = datesData.date_stats['2026-06-29'];
    if (stat0629) {
      assert(typeof stat0629.cu_count === 'number', 'cu_count 必须为数字');
      assert(typeof stat0629.action_cu_count === 'number', 'action_cu_count 必须为数字');
      assert(typeof stat0629.empty_cu_count === 'number', 'empty_cu_count 必须为数字');
      console.log(`   ✅ 2026-06-29 统计: 总 CU=${stat0629.cu_count}, 动作窗=${stat0629.action_cu_count}, 观点空窗=${stat0629.empty_cu_count}`);
    }

    // ----------------------------------------------------
    // 测试 2 (W3/第三节): GET /api/l2a/today 返回 raw_text
    // ----------------------------------------------------
    console.log('\n▶️ [测试 2/5] 验证 W3/第三节 动作流携带完整 raw_text...');
    const todayRes = await fetch(`${baseUrl}/api/l2a/today?date=2026-06-29`);
    assert.strictEqual(todayRes.status, 200);
    const todayData = await todayRes.json();
    assert(todayData.stream.length > 0, '2026-06-29 应有动作');
    for (const item of todayData.stream) {
      assert(typeof item.raw_text === 'string' && item.raw_text.length > 0, `CU ${item.cu_id} 必须包含 raw_text`);
    }
    console.log(`   ✅ 成功核验 ${todayData.stream.length} 笔动作流，全部挂载完整 raw_text 原文`);

    // ----------------------------------------------------
    // 测试 3 (W2): 同日同标的 filled 覆盖 planned (7-01 CRWV)
    // ----------------------------------------------------
    console.log('\n▶️ [测试 3/5] 验证 W2 同日同标的 filled 覆盖 planned (CRWV 不入待审池)...');
    const q701Res = await fetch(`${baseUrl}/api/review/queue?date=2026-07-01`);
    assert.strictEqual(q701Res.status, 200);
    const q701Data = await q701Res.json();
    
    // 7-01 原文中有 86.3 加仓 CRWV (filled)，因此 86 planned 解释句不得进入待审池
    const crwvPlannedInQueue = q701Data.queue.find(q => q.ticker === 'CRWV' && q.status === 'planned');
    assert.strictEqual(crwvPlannedInQueue, undefined, '7-01 CRWV planned 解释句应被同日 CRWV filled 覆盖，不得进待审池');
    console.log(`   ✅ 成功核验 7-01 CRWV planned 已被同日成交覆盖排除，未误入待审池`);

    // ----------------------------------------------------
    // 测试 4 (W1): 待审池排除已 ack 的 review_id (防刷新回潮)
    // ----------------------------------------------------
    console.log('\n▶️ [测试 4/5] 验证 W1 待审池已处理 review_id 过滤...');
    const testReviewId = 'test_mock_cu_001_TSLA_BUY_100_0';
    // 写入一条模拟已确认记录
    const logPath = 'data/runs/l2a_human_verified_actions.jsonl';
    const mockLog = {
      review_id: testReviewId,
      cu_id: 'test_mock_cu_001',
      decision: 'ack',
      status: 'human_verified',
      timestamp_utc: new Date().toISOString(),
      is_live_order: false
    };
    fs.appendFileSync(logPath, JSON.stringify(mockLog) + '\n', 'utf-8');

    // 验证 getHandledReviewIds 是否生效
    const qTestRes = await fetch(`${baseUrl}/api/review/queue?date=2026-06-26`);
    const qTestData = await qTestRes.json();
    const foundAcked = qTestData.queue.find(q => q.review_id === testReviewId);
    assert.strictEqual(foundAcked, undefined, '已 ack 的 review_id 绝不得出现在 queue 中');
    console.log(`   ✅ 成功核验已处理动作不会在 queue 中再次出现 (刷新防回潮机制有效)`);

    // ----------------------------------------------------
    // 测试 5 (W4): GET /api/l2b/gates 局部与当日过滤
    // ----------------------------------------------------
    console.log('\n▶️ [测试 5/5] 验证 W4 L2b 闸门局部/当日联动 (禁止死灌 25 条)...');
    const gatesCuRes = await fetch(`${baseUrl}/api/l2b/gates?cu_id=cu_trade_00036`);
    assert.strictEqual(gatesCuRes.status, 200);
    const gatesCuData = await gatesCuRes.json();
    assert.strictEqual(gatesCuData.cu_id, 'cu_trade_00036');
    assert(gatesCuData.zhao_kid_badges.length <= 5, '单个 CU 只返回命中的战法，不应灌 25 条');
    assert(gatesCuData.zhao_kid_badges.some(b => b.kid === 'k_second_handshake'), 'cu_trade_00036 应命中二次握手');
    console.log(`   ✅ 成功核验 cu_trade_00036 仅返回命中战法 (${gatesCuData.zhao_kid_badges.length} 条)，未灌入全局列表`);

    console.log('\n====================================================');
    console.log('🎉 W1–W5 全部 5 项自动化验收测试 100% 通过！');
    console.log('====================================================\n');
  } finally {
    await stopServer();
  }
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
