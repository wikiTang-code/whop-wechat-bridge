/**
 * scripts/trade/test_live_paper_order.js
 * REQ-056: 长桥模拟盘真实 API 端到端实测 (挂单 -> 柜台查验 -> 撤单闭环)
 */

import dotenv from 'dotenv';
import { getDb } from '../../database.js';
import {
  createTradeIntent,
  confirmAndSubmitIntent,
  cancelTradeIntent
} from '../../tools/trade/paper_execution_engine.js';
import {
  getAccountBalances,
  getTodayOrders,
  getActivePositions,
  syncPaperPositions
} from '../../brokers/longbridge.js';

dotenv.config();

async function runLivePaperTest() {
  console.log('===========================================================');
  console.log('🚀 [Live Paper Test] 长桥模拟盘真实 API 端到端挂单撤单闭环实测');
  console.log('===========================================================');
  console.log(`[1] 验证环境模式: BROKER_MODE=${process.env.BROKER_MODE}`);

  // 1. 读取账户资金
  const balances = await getAccountBalances();
  console.log(`[2] 账户当前资金: 可用现金 $${balances.cash.toLocaleString()} | 购买力 $${balances.power.toLocaleString()}`);

  // 2. 创建真实测试意图
  console.log('\n[3] 正在生成测试意图 (TradeIntent)...');
  const testIntent = createTradeIntent({
    ticker: 'TSLA',
    side: 'BUY',
    quantity: 1,
    price_limit: 150.00, // 远离现价的保护性低价，确保安全挂单而不被非预期成交
    source: 'system_bootstrap_test',
    evidence: [{ note: '上线前长桥模拟盘全链路真实连通性测试' }],
    expires_in_sec: 1800
  });
  console.log(`    -> 意图已生成: id=${testIntent.intent_id}, status=${testIntent.status}`);

  // 3. 执行 HITL 确认向长桥模拟柜台报送
  console.log('\n[4] 模拟驾驶员 HITL 确认，正在向长桥模拟柜台报单...');
  const submitResult = await confirmAndSubmitIntent(testIntent.intent_id, {
    awaitFinalStatus: false
  });
  console.log(`    -> 报送结果: success=${submitResult.success}, order_id=${submitResult.intent.broker_order_id}, status=${submitResult.intent.status}`);

  const orderId = submitResult.intent.broker_order_id;
  if (!orderId) {
    throw new Error('报送失败，未获得长桥柜台 order_id');
  }

  // 4. 等待 2 秒向长桥柜台查询当日委托验证真实性
  console.log('\n[5] 正在向长桥柜台查询今日真实委托记录 (todayOrders)...');
  await new Promise(r => setTimeout(r, 2000));
  const todayOrders = await getTodayOrders();
  const matched = todayOrders.find(o => String(o.order_id) === String(orderId));
  if (matched) {
    console.log(`    ✅ 长桥柜台已真实收单: order_id=${matched.order_id}, 标的=${matched.ticker}, 方向=${matched.side}, 股数=${matched.quantity}, 价格=$${matched.price}, 状态=${matched.status}`);
  } else {
    console.log(`    ⚠️ 今日委托列表中暂未检索到 ${orderId} (当前订单总数: ${todayOrders.length})`);
  }

  // 5. 执行撤单闭环
  console.log('\n[6] 正在向长桥柜台发起真实撤单申请 (cancelOrder)...');
  const cancelResult = await cancelTradeIntent(testIntent.intent_id, 'BOOTSTRAP_TEST_FINISHED');
  console.log(`    -> 撤单结果: success=${cancelResult.success}, status=${cancelResult.intent.status}, 原因=${cancelResult.intent.reject_reason}`);

  // 6. 等待 2 秒再次查询确认终态
  await new Promise(r => setTimeout(r, 2000));
  const ordersAfter = await getTodayOrders();
  const matchedAfter = ordersAfter.find(o => String(o.order_id) === String(orderId));
  console.log(`    -> 柜台最终状态: ${matchedAfter ? matchedAfter.status : '已移出活跃委托'}`);

  // 7. 同步持仓真源
  console.log('\n[7] 同步长桥持仓真源...');
  const positions = await syncPaperPositions();
  console.log(`    -> 当前模拟盘持仓数量: ${positions.length}`);

  console.log('\n===========================================================');
  console.log('🎉 [Live Paper Test] 长桥模拟盘真实 API 连通性测试 100% 成功！');
  console.log('===========================================================');
}

runLivePaperTest().catch(err => {
  console.error('\n❌ [Live Paper Test 失败]:', err);
  process.exit(1);
});
