/**
 * scripts/trade/night_market_kickoff.js
 * 
 * 夜盘首发一键点火与端到端闭环自检自动化脚本
 * 
 * 核心功能:
 * 1. 市场时钟与时段状态智能巡检 (检测 OVERNIGHT_TRADING)
 * 2. 长桥 Paper 模式与账户资产巡检 (拒绝 real 实盘)
 * 3. 意图组装与事前硬风控门禁校验 (paper_risk_guard)
 * 4. 柜台报送与全时段夜盘委托 (OutsideRTH.Overnight)
 * 5. 实时撮合追踪 (FILLED / CANCELLED / TIMEOUT)
 * 6. 成交后自动同步第一真源持仓并触发三方对账哨兵 (paper_reconciliation_sentinel)
 * 
 * 用法:
 * node scripts/trade/night_market_kickoff.js [--ticker TSLA] [--qty 1] [--price 390.0] [--force] [--timeout 20000]
 */

import dotenv from 'dotenv';
import { getDb, getTradeIntent } from '../../database.js';
import { getUsMarketSession } from '../../tools/knowledge/market_session.js';
import {
  createTradeIntent,
  confirmAndSubmitIntent
} from '../../tools/trade/paper_execution_engine.js';
import {
  getAccountBalances,
  getTodayOrders,
  getActivePositions,
  syncPaperPositions,
  assertPaperMode
} from '../../brokers/longbridge.js';
import { evaluatePreTradeRisk } from '../../tools/trade/paper_risk_guard.js';
import { runPaperReconciliation } from '../../tools/ops/paper_reconciliation_sentinel.js';

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    ticker: 'TSLA',
    qty: 1,
    price: null,
    force: false,
    timeoutMs: 20000,
    checkOnly: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ticker' && args[i + 1]) params.ticker = args[++i].toUpperCase();
    else if (args[i] === '--qty' && args[i + 1]) params.qty = parseInt(args[++i], 10);
    else if (args[i] === '--price' && args[i + 1]) params.price = parseFloat(args[++i]);
    else if (args[i] === '--timeout' && args[i + 1]) params.timeoutMs = parseInt(args[++i], 10);
    else if (args[i] === '--force') params.force = true;
    else if (args[i] === '--check-only') params.checkOnly = true;
  }
  return params;
}

export async function kickoffNightMarket(options = {}) {
  const params = { ...parseArgs(), ...options };
  const db = getDb();

  console.log('================================================================');
  console.log('🌙 [Night Market Kickoff] 量化系统夜盘首发点火与闭环自检');
  console.log('================================================================');
  console.log(`执行时刻: ${new Date().toISOString()} (本地: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);

  // 1. 时钟与时段状态巡检
  const sessionInfo = getUsMarketSession();
  console.log(`\n[第 1 步: 时钟巡检] 当前美股时段: ${sessionInfo.session} | 市场开启: ${sessionInfo.isOpen}`);
  console.log(`         美东时间: ${sessionInfo.et?.timeStr} ET (${sessionInfo.et?.dateStr}) | 描述: ${sessionInfo.description}`);

  const isOvernight = sessionInfo.isOvernight || sessionInfo.session === 'OVERNIGHT_TRADING';
  if (!isOvernight && !sessionInfo.isOpen && !params.force) {
    console.warn(`\n⚠️ 当前尚未进入美股交易或夜盘时段 (当前: ${sessionInfo.session})`);
    console.warn('   夜盘标准时段为: 美东时间周日 20:00 (北京时间周一 08:00)');
    console.warn('   如需在非交易时段进行柜台挂单与撤单演练，请增加 --force 参数');
    if (!params.checkOnly) {
      return { success: false, reason: `NOT_IN_OVERNIGHT_SESSION: current=${sessionInfo.session}` };
    }
  }

  // 2. 长桥 Paper 模式与柜台鉴权
  console.log('\n[第 2 步: 安全门禁与资金查验]');
  try {
    assertPaperMode();
    console.log(`   ✅ 安全断言通过: BROKER_MODE=${process.env.BROKER_MODE} (严禁实盘渗透)`);
  } catch (err) {
    console.error(`   ❌ 安全门禁拦截: ${err.message}`);
    return { success: false, error: err.message };
  }

  let balances;
  try {
    balances = await getAccountBalances();
    console.log(`   ✅ 模拟账户可用现金: $${balances.cash.toLocaleString()}`);
    console.log(`   ✅ 模拟账户总体购买力: $${balances.power.toLocaleString()}`);
  } catch (err) {
    console.error(`   ❌ 无法连接长桥模拟柜台或读取资金: ${err.message}`);
    return { success: false, error: err.message };
  }

  if (params.checkOnly) {
    console.log('\n✅ 纯环境巡检完成，系统一切就绪。');
    return { success: true, mode: 'check_only', balances, sessionInfo };
  }

  // 3. 价格与意图决策装配
  console.log('\n[第 3 步: 交易意图装配与风控门禁]');
  const ticker = params.ticker;
  const qty = params.qty;
  
  let targetPrice = params.price;
  if (!targetPrice) {
    if (ticker === 'TSLA') targetPrice = 390.0;
    else if (ticker === 'NVDA') targetPrice = 115.0;
    else targetPrice = 100.0;
    console.log(`   ℹ️ 未指定限价，采用默认基准限价: $${targetPrice}`);
  }

  // 执行事前硬风控预审
  const riskCheck = evaluatePreTradeRisk({
    ticker,
    side: 'BUY',
    quantity: qty,
    price_limit: targetPrice
  }, { dbInstance: db });

  if (!riskCheck.passed) {
    console.error(`   ❌ 事前硬风控拦截: ${riskCheck.reject_reason}`);
    return { success: false, riskCheck };
  }
  console.log(`   ✅ 事前硬风控审核通过: 名义金额 $${riskCheck.details.notional} <= 上限 $5,000`);

  // 创建不可变 TradeIntent
  const intent = createTradeIntent({
    ticker,
    side: 'BUY',
    quantity: qty,
    price_limit: targetPrice,
    source: 'night_market_kickoff',
    evidence: [
      { note: `夜盘鸣锣点火首单实测 [${sessionInfo.session}]` },
      { notional: riskCheck.details.notional }
    ],
    expires_in_sec: 1800
  }, { dbInstance: db });
  console.log(`   ✅ TradeIntent 创建成功: id=${intent.intent_id}, status=${intent.status}`);

  // 4. 模拟驾驶员 HITL 确认向长桥报单
  console.log('\n[第 4 步: HITL 报单与柜台报送]');
  console.log(`   -> 确认报送: 买入 ${ticker} ${qty}股 @ 限价 $${targetPrice} (outside_rth=Overnight)`);

  const submitRes = await confirmAndSubmitIntent(intent.intent_id, {
    dbInstance: db,
    awaitFinalStatus: true,
    timeoutMs: params.timeoutMs
  });

  console.log(`   -> 状态流转结果: intent_status=${submitRes.intent?.status}, order_id=${submitRes.intent?.broker_order_id}`);
  if (submitRes.intent?.reject_reason) {
    console.log(`   -> 附带原因: ${submitRes.intent.reject_reason}`);
  }

  // 5. 第一真源持仓同步与三方对账哨兵
  console.log('\n[第 5 步: 第一真源同步与三方对账哨兵]');
  let positions = [];
  try {
    positions = await syncPaperPositions();
    console.log(`   ✅ 模拟盘持仓同步完成: 当前标的数 = ${positions.length}`);
    if (positions.length > 0) {
      console.table(positions.map(p => ({
        标的: p.ticker,
        持仓量: p.quantity,
        成本均价: `$${p.average_entry_price}`,
        现价: `$${p.current_price}`,
        市值: `$${p.market_value}`,
        浮动盈亏: `$${p.unrealized_pnl}`
      })));
    }
  } catch (err) {
    console.warn(`   ⚠️ 持仓同步异常: ${err.message}`);
  }

  // 触发三方对账
  let reconciliation;
  try {
    reconciliation = await runPaperReconciliation({ dbInstance: db });
    console.log(`   ✅ 三方对账哨兵执行完成:`);
    console.log(`      意图数: ${reconciliation.intents_count} | 柜台今日委托: ${reconciliation.broker_orders_count} | 柜台持仓: ${reconciliation.broker_positions_count}`);
    console.log(`      差异警告数: ${reconciliation.discrepancies.length}`);
    if (reconciliation.discrepancies.length > 0) {
      console.warn(`      差异详情:`, JSON.stringify(reconciliation.discrepancies, null, 2));
    } else {
      console.log(`      🎉 对账完美对齐 (Zero Discrepancy)`);
    }
  } catch (err) {
    console.warn(`   ⚠️ 对账哨兵执行异常: ${err.message}`);
  }

  console.log('\n================================================================');
  console.log(`🏁 夜盘点火实测完成: 最终意图状态 = ${submitRes.intent?.status}`);
  console.log('================================================================\n');

  return {
    success: true,
    session: sessionInfo.session,
    intent: submitRes.intent,
    positions,
    reconciliation
  };
}

// CLI 直跑支持
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('night_market_kickoff.js') ||
  process.argv[1].includes('night_market_kickoff')
);

if (isDirectRun) {
  kickoffNightMarket().catch(err => {
    console.error('夜盘点火执行异常:', err);
    process.exit(1);
  });
}
