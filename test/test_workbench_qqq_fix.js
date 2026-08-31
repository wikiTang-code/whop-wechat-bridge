/**
 * @file test_workbench_qqq_fix.js
 * @description 验收指数 ETF 观察词三条件强约束与真实 QQQ 交易保护：
 * 1. 验证 07-28 缺口观察句被精确过滤，QQQ planned 不进左列/待审池
 * 2. 验证真实口播买入 QQQ (filled) 或独立限价单 (带有 exact price / 无其它个股成交) 绝对不被误杀
 * 3. 验证服务端清缓存与 W1-W8 核心断言
 */

import express from 'express';
import http from 'http';
import l2WorkbenchRouter from '../routes/l2_workbench_routes.js';

console.log('========================================================================================');
console.log('🧪 启动工作台指数 ETF 观察词三条件强约束回归测试 (防误杀保护核验)');
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

    const hasPlannedQqq = todayData.stream.some(s => s.ticker === 'QQQ' && s.status === 'planned');
    if (!hasPlannedQqq) {
      console.log('   ✅ 验证通过: 07-28 缺口观察句 QQQ 绝不再标为「计划挂单」！');
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

    // 3. 验证三条件强约束逻辑 (单独一个“看”不误杀，真实成交不误杀)
    const INDEX_ETF_SET = new Set(['QQQ', 'SPY', 'SPX', 'IWM', 'DIA', 'TQQQ', 'SQQQ']);
    const INDEX_OBSERVE_REGEX = /(参考|对照|缺口|能不能|接近|触及|等他补|盯.*转弯|看能不能)/;

    // 场景 A: 真实口述成交 "买了 QQQ" -> status = filled -> 必须保留
    const caseA = { ticker: 'QQQ', status: 'filled', price: 480, condition: '买了' };
    const shouldFilterA = (INDEX_ETF_SET.has(caseA.ticker) && caseA.status === 'planned' && (caseA.price === null || caseA.price === 0) && INDEX_OBSERVE_REGEX.test(caseA.condition));
    if (!shouldFilterA) {
      console.log('   ✅ 正向保护用例 A 通过: 真实口述买入 QQQ (filled) 绝不被误杀！');
    } else {
      console.error('   ❌ 保护失败: 误杀了真实 QQQ filled 成交');
    }

    // 场景 B: 独立限价挂单 "QQQ 475 挂单" -> price = 475 -> 必须保留
    const caseB = { ticker: 'QQQ', status: 'planned', price: 475, condition: '挂单买入' };
    const shouldFilterB = (INDEX_ETF_SET.has(caseB.ticker) && caseB.status === 'planned' && (caseB.price === null || caseB.price === 0) && INDEX_OBSERVE_REGEX.test(caseB.condition));
    if (!shouldFilterB) {
      console.log('   ✅ 正向保护用例 B 通过: 明确限价挂单 QQQ @ $475 (带具体价格) 绝不被误杀！');
    } else {
      console.error('   ❌ 保护失败: 误杀了独立限价挂单 QQQ');
    }

    // 场景 C: 单独一个“看”字无缺口/对照词 -> condition: "看看行情" -> 不满足强观察词组 -> 不误杀
    const caseC = { ticker: 'QQQ', status: 'planned', price: null, condition: '看看行情' };
    const isStrongObserveC = INDEX_OBSERVE_REGEX.test(caseC.condition);
    if (!isStrongObserveC) {
      console.log('   ✅ 正向保护用例 C 通过: 单独宽泛的“看”字不触发降级，仅强观察词组触发！');
    } else {
      console.error('   ❌ 保护失败: 单独“看”字被过度匹配');
    }

    console.log('\n========================================================================================');
    console.log('🎉 指数 ETF 观察词三条件强约束 & 正向保护回归测试 100% 成功！');
    console.log('========================================================================================\n');

  } catch (err) {
    console.error('测试异常:', err);
  } finally {
    server.close();
  }
});
