import express from 'express';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';
import assert from 'assert';

const app = express();
app.use(express.json());
app.use('/api', l2WorkbenchRouter);

const server = app.listen(34568, '127.0.0.1', async () => {
  console.log('====================================================');
  console.log('🧪 深度断言回归测试：L2 最小前端 API 体系');
  console.log('====================================================\n');

  try {
    // 1. 测试 GET /api/l2a/dates
    const resDates = await fetch('http://127.0.0.1:34568/api/l2a/dates');
    const dataDates = await resDates.json();
    assert(Array.isArray(dataDates.dates), "dates 必须是数组");
    console.log(`✅ [1/5] GET /api/l2a/dates: 成功返回 ${dataDates.dates.length} 个美东日期 (默认: ${dataDates.default_date})`);

    // 2. 测试 GET /api/l2a/today?date=2025-10-06
    const resStream = await fetch('http://127.0.0.1:34568/api/l2a/today?date=2025-10-06');
    const dataStream = await resStream.json();
    assert(dataStream.stream.length > 0, "stream 必须有数据");
    const sampleAct = dataStream.stream[0];
    assert(['planned', 'filled_speech'].includes(sampleAct.status), "status 必须为 planned 或 filled_speech");
    console.log(`✅ [2/5] GET /api/l2a/today: 严格断言 status="${sampleAct.status}" (口述成交或计划单)`);

    // 3. 测试 GET /api/review/queue?date=2025-10-06 (收敛按日过滤)
    const resQueue = await fetch('http://127.0.0.1:34568/api/review/queue?date=2025-10-06');
    const dataQueue = await resQueue.json();
    assert(dataQueue.date === '2025-10-06', "待审池日期必须精确匹配");
    for (const q of dataQueue.queue) {
      assert(q.status === 'planned' || q.is_tier1_supplement, "待审池仅允许 planned 或 Tier1 补抽单");
    }
    console.log(`✅ [3/5] GET /api/review/queue: 成功按日收敛 ${dataQueue.total_pending} 条 planned 意图单，口述成交未误入待审池`);

    // 4. 测试 POST /api/review/action
    const sampleItem = dataQueue.queue[0];
    const resPost = await fetch('http://127.0.0.1:34568/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review_id: sampleItem.review_id,
        cu_id: sampleItem.cu_id,
        decision: 'ack'
      })
    });
    const dataPost = await resPost.json();
    assert(dataPost.success === true, "POST 必须返回 success");
    assert(dataPost.result.status === 'human_verified', "decision=ack 必须写入 human_verified");
    assert(dataPost.result.is_live_order === false, "is_live_order 必须为 false (零券商打单)");
    console.log(`✅ [4/5] POST /api/review/action: 成功核准打标 human_verified，严格断言 is_live_order=false`);

    // 5. 测试 GET /api/l2b/gates?cu_id=cu_trade_00036 (联动查询)
    const resGates = await fetch('http://127.0.0.1:34568/api/l2b/gates?cu_id=cu_trade_00036');
    const dataGates = await resGates.json();
    assert(dataGates.zhao_kid_badges.length > 0, "cu_trade_00036 必须命中二次握手");
    assert(dataGates.zhao_kid_badges[0].kid === 'k_second_handshake', "kid 必须精确匹配 k_second_handshake");
    assert(dataGates.mrzhou_readonly_gates.is_collapsed_by_default === true, "周哥体制必须默认折叠");
    console.log(`✅ [5/5] GET /api/l2b/gates: 联动查询精准命中 ${dataGates.zhao_kid_badges[0].kid}，周哥体制严格默认折叠`);

    console.log('\n====================================================');
    console.log('🎉 全部 5 组深度断言回归测试 100% 顺利通过！');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ 断言测试失败:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});
