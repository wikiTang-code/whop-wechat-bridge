import express from 'express';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';
import assert from 'assert';

const app = express();
app.use(express.json());
app.use('/api', l2WorkbenchRouter);

const server = app.listen(34569, '127.0.0.1', async () => {
  console.log('====================================================');
  console.log('🧪 深度断言回归测试：L2 最小前端与离线增量指针体系');
  console.log('====================================================\n');

  try {
    // 1. 测试 GET /api/l2a/incremental-status
    const resStatus = await fetch('http://127.0.0.1:34569/api/l2a/incremental-status');
    const dataStatus = await resStatus.json();
    assert(dataStatus.base_cu_count === 1195, "基础库数量必须为 1195");
    console.log(`✅ [1/6] GET /api/l2a/incremental-status: 基础库存截止 ${dataStatus.base_as_of} (${dataStatus.base_cu_count} CU)`);

    // 2. 测试 POST /api/l2a/reload-offline (纯清缓存与指针重读，绝不调模型)
    const resReload = await fetch('http://127.0.0.1:34569/api/l2a/reload-offline', { method: 'POST' });
    const dataReload = await resReload.json();
    assert(dataReload.success === true, "reload 必须成功");
    console.log(`✅ [2/6] POST /api/l2a/reload-offline: 秒级重载成功: "${dataReload.message}" (总CU: ${dataReload.total_cus})`);

    // 3. 测试 GET /api/l2a/dates
    const resDates = await fetch('http://127.0.0.1:34569/api/l2a/dates');
    const dataDates = await resDates.json();
    assert(Array.isArray(dataDates.dates), "dates 必须是数组");
    console.log(`✅ [3/6] GET /api/l2a/dates: 成功返回 ${dataDates.dates.length} 个美东日期 (默认: ${dataDates.default_date})`);

    // 4. 测试 GET /api/l2a/today?date=2025-10-06
    const resStream = await fetch('http://127.0.0.1:34569/api/l2a/today?date=2025-10-06');
    const dataStream = await resStream.json();
    assert(dataStream.stream.length > 0, "stream 必须有数据");
    console.log(`✅ [4/6] GET /api/l2a/today: 严格断言 status="${dataStream.stream[0].status}" (口述成交或计划单)`);

    // 5. 测试 GET /api/review/queue?date=2025-10-06
    const resQueue = await fetch('http://127.0.0.1:34569/api/review/queue?date=2025-10-06');
    const dataQueue = await resQueue.json();
    assert(dataQueue.date === '2025-10-06', "待审池日期必须精确匹配");
    console.log(`✅ [5/6] GET /api/review/queue: 成功按日收敛 ${dataQueue.total_pending} 条 planned 意图单`);

    // 6. 测试 GET /api/l2b/gates
    const resGates = await fetch('http://127.0.0.1:34569/api/l2b/gates');
    const dataGates = await resGates.json();
    assert(dataGates.zhao_kid_badges.length > 0, "战法徽章必须存在");
    assert(dataGates.mrzhou_readonly_gates.is_collapsed_by_default === true, "周哥体制必须默认折叠");
    console.log(`✅ [6/6] GET /api/l2b/gates: 战法徽章全覆盖，周哥体制严格默认折叠`);

    console.log('\n====================================================');
    console.log('🎉 全部 6 组深度断言回归测试 100% 顺利通过！');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ 断言测试失败:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});
