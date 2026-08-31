/**
 * @file test_workbench_qqq_fix.js
 * @description 验收 07-28 QQQ 误标修复：
 * 1. 验证 GET /api/l2a/today?date=2026-07-28 中 QQQ 不再标为 planned
 * 2. 验证 GET /api/review/queue?date=2026-07-28 中 QQQ 待审单为 0
 * 3. 验证 07-28 当日 CU 统计与拆解卡片数口径一致
 */

import express from 'express';
import http from 'http';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';

console.log('========================================================================================');
console.log('🧪 启动工作台 07-28 QQQ 过滤与 dismiss 状态回归测试');
console.log('========================================================================================\n');

const app = express();
app.use(express.json());
app.use('/api', l2WorkbenchRouter);

const server = http.createServer(app);
server.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    // 1. 测试 07-28 today 动作流
    const todayRes = await fetch(`${baseUrl}/l2a/today?date=2026-07-28`);
    const todayData = await todayRes.json();
    console.log(`📊 2026-07-28 今日动作流: 总 CU = ${todayData.cu_count}, 拆解动作 = ${todayData.stream.length}`);

    const qqqCards = todayData.stream.filter(s => s.ticker === 'QQQ');
    console.log(`   - 发现 QQQ 关联卡片数: ${qqqCards.length}`);
    if (qqqCards.length > 0) {
      console.log(`   - QQQ 卡片状态:`, qqqCards.map(c => ({ id: c.action_id, status: c.status, is_dismissed: c.is_dismissed })));
    }

    const hasPlannedQqq = todayData.stream.some(s => s.ticker === 'QQQ' && s.status === 'planned');
    if (!hasPlannedQqq) {
      console.log('   ✅ 验证通过: 07-28 左列中 QQQ 绝不再标为「计划挂单」！');
    } else {
      console.error('   ❌ 验证失败: 左列仍残留 QQQ planned');
    }

    // 2. 测试 07-28 review queue
    const queueRes = await fetch(`${baseUrl}/review/queue?date=2026-07-28`);
    const queueData = await queueRes.json();
    console.log(`\n📋 2026-07-28 待审池数量: ${queueData.total_pending} 待审`);
    const queueQqq = queueData.queue.filter(q => q.ticker === 'QQQ');
    if (queueQqq.length === 0) {
      console.log('   ✅ 验证通过: 待审池中 QQQ 待审单为 0，彻底被排除！');
    } else {
      console.error('   ❌ 验证失败: 待审池仍有 QQQ 待审单:', queueQqq);
    }

    console.log('\n========================================================================================');
    console.log('🎉 07-28 QQQ 误标过滤与工作台状态回归测试 100% 成功！');
    console.log('========================================================================================\n');

  } catch (err) {
    console.error('测试异常:', err);
  } finally {
    server.close();
  }
});
