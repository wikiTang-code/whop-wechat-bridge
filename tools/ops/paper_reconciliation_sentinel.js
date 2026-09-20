/**
 * tools/ops/paper_reconciliation_sentinel.js
 * REQ-056: 模拟盘执行与柜台真实状态对账哨兵 (Three-Way Paper Reconciliation)
 * 
 * 核心对账三要素:
 * 1. 本地 Intent 账本 (trade_intents)
 * 2. 柜台真实委托回报 (todayOrders / FILLED)
 * 3. 柜台真实持仓真源 (stockPositions vs broker_paper_positions)
 * 
 * 运行方式:
 *   node tools/ops/paper_reconciliation_sentinel.js
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDb, listTradeIntents, getPaperPositions } from '../../database.js';
import {
  assertPaperMode,
  getTodayOrders,
  getActivePositions,
  syncPaperPositions
} from '../../brokers/longbridge.js';

dotenv.config();

const REPORT_PATH = path.join(process.cwd(), 'data', 'runtime', 'paper_reconciliation_latest.json');

/**
 * 执行三方自动对账并输出报告
 */
export async function runPaperReconciliation({ dbInstance = null } = {}) {
  assertPaperMode();
  const db = dbInstance || getDb();
  const now = Date.now();

  console.log('===========================================================');
  console.log('⚖️ [Paper Reconciliation] 启动长桥模拟盘三方对账审计');
  console.log(`   时间: ${new Date().toISOString()} | 模式: BROKER_MODE=paper`);
  console.log('===========================================================');

  // 1. 同步最新持仓真源
  console.log('[1/4] 拉取柜台最新真实持仓与本地真源对齐...');
  const remotePositions = await syncPaperPositions();
  const localPositions = getPaperPositions(db);

  // 2. 拉取柜台当日全部委托
  console.log('[2/4] 拉取柜台当日全部委托记录...');
  const remoteOrders = await getTodayOrders();

  // 3. 读取本地意图流水
  console.log('[3/4] 读取本地 TradeIntent 决策意图流水...');
  const localIntents = listTradeIntents({ limit: 200 }, db);

  // 4. 执行对账断言分析
  console.log('[4/4] 正在执行三方一致性断言比对...');
  const discrepancies = [];

  // 对账 A: 检查 FILLED 意图是否在柜台真实存在且为终态
  const filledIntents = localIntents.filter(it => it.status === 'FILLED');
  for (const it of filledIntents) {
    if (!it.broker_order_id) {
      discrepancies.push({
        type: 'MISSING_BROKER_ORDER_ID',
        intent_id: it.intent_id,
        ticker: it.ticker,
        description: `本地记录已成交但无对应长桥 order_id`
      });
      continue;
    }
    const matchedOrder = remoteOrders.find(o => String(o.order_id) === String(it.broker_order_id));
    if (!matchedOrder) {
      discrepancies.push({
        type: 'REMOTE_ORDER_NOT_FOUND',
        intent_id: it.intent_id,
        order_id: it.broker_order_id,
        ticker: it.ticker,
        description: `长桥今日委托列表中未找到该订单`
      });
    } else if (matchedOrder.status !== 'FILLED') {
      discrepancies.push({
        type: 'STATUS_MISMATCH',
        intent_id: it.intent_id,
        order_id: it.broker_order_id,
        local_status: it.status,
        remote_status: matchedOrder.status,
        description: `状态背离: 本地标为 FILLED，但柜台状态为 ${matchedOrder.status}`
      });
    }
  }

  // 对账 B: 检查柜台持仓与本地 broker_paper_positions 是否严格相等
  for (const rp of remotePositions) {
    const lp = localPositions.find(p => p.ticker === rp.ticker);
    if (!lp) {
      discrepancies.push({
        type: 'LOCAL_POSITION_MISSING',
        ticker: rp.ticker,
        remote_qty: rp.quantity,
        description: `柜台持有 ${rp.ticker} ${rp.quantity}股，但本地真源表缺失`
      });
    } else if (lp.quantity !== rp.quantity) {
      discrepancies.push({
        type: 'POSITION_QTY_MISMATCH',
        ticker: rp.ticker,
        local_qty: lp.quantity,
        remote_qty: rp.quantity,
        description: `持仓股数背离: 本地=${lp.quantity}, 柜台=${rp.quantity}`
      });
    }
  }

  const isReconciled = discrepancies.length === 0;
  const report = {
    reconciled_at: now,
    mode: 'paper',
    is_reconciled: isReconciled,
    metrics: {
      total_intents: localIntents.length,
      filled_intents_count: filledIntents.length,
      remote_orders_count: remoteOrders.length,
      active_positions_count: remotePositions.length,
      discrepancy_count: discrepancies.length
    },
    discrepancies,
    remote_positions: remotePositions,
    summary_text: isReconciled
      ? `✅ 对账完美通过: 本地意图(${filledIntents.length}成交) 与 模拟柜台委托(${remoteOrders.length}笔) 及 持仓(${remotePositions.length}标的) 100% 吻合！`
      : `⚠️ 发现 ${discrepancies.length} 处对账不一致，需人工介入核对！`
  };

  // 落盘对账报告
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\n结果: ${report.summary_text}`);
  console.log(`📄 详细对账报告已写入: ${REPORT_PATH}`);
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('paper_reconciliation_sentinel.js')) {
  runPaperReconciliation().catch(err => {
    console.error('Fatal Reconciliation Error:', err.message);
    process.exit(1);
  });
}
