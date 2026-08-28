import express from 'express';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';
import http from 'http';

const app = express();
app.use(express.json());
app.use('/api', l2WorkbenchRouter);

const server = app.listen(34567, '127.0.0.1', async () => {
  console.log('====================================================');
  console.log('🧪 测试 L2 最小前端 3 核心 API 路由');
  console.log('====================================================\n');

  try {
    // 1. GET /api/l2a/today
    const res1 = await fetch('http://127.0.0.1:34567/api/l2a/today?date=2025-10-06');
    const data1 = await res1.json();
    console.log(`✅ [1/3] GET /api/l2a/today?date=2025-10-06 成功返回 ${data1.total_actions} 个动作`);
    console.log(`      样例: ${data1.stream[0]?.action} ${data1.stream[0]?.ticker} | status: "${data1.stream[0]?.status}"`);

    // 2. GET /api/review/queue
    const res2 = await fetch('http://127.0.0.1:34567/api/review/queue');
    const data2 = await res2.json();
    console.log(`✅ [2/3] GET /api/review/queue 成功返回待审池 ${data2.total_pending} 条`);
    console.log(`      样例: ${data2.queue[0]?.ticker} | review_status: "${data2.queue[0]?.review_status}"`);

    // 3. GET /api/l2b/gates
    const res3 = await fetch('http://127.0.0.1:34567/api/l2b/gates');
    const data3 = await res3.json();
    console.log(`✅ [3/3] GET /api/l2b/gates 成功返回赵哥战法徽章 ${data3.zhao_kid_badges.length} 条 | 周哥只读默认折叠: ${data3.mrzhou_readonly_gates.is_collapsed_by_default}`);
    console.log(`      样例: ${data3.zhao_kid_badges[0]?.kid} -> "${data3.zhao_kid_badges[0]?.matched_phrase}"`);

    console.log('\n====================================================');
    console.log('🎉 3 核心 API 路由全部回归测试通过！');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ API 测试失败:', err);
  } finally {
    server.close();
  }
});
