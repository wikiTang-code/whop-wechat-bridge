import crypto from 'crypto';
import { getDb, saveFollowDecision, getFollowDecisions } from './database.js';
import { getUnifiedPositions, executeOrder } from './trading.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 智能跟单决策状态机引擎 (Follow Decision Engine)
 * 严格对齐 data/specs/follow_execution_spec.md 与 docs/project/follow-hitl-plan.md
 */

// 规格常量定义
export const FOLLOW_SPEC = {
  TTL_SEC: 90,                  // 消息超时时间 90 秒
  SLIP_FIRE_MAX_BPS: 20,         // <= 20bp: FIRE 全额限价下单
  SLIP_SIZEDOWN_MAX_BPS: 40,     // (20bp, 40bp]: SIZE_DOWN 仓位减半 (1/2)
  SLIP_REJECT_BPS: 40           // > 40bp: SLIP_REJECT 坚决拒单
};

/**
 * 计算滑点基点 (Basis Points, 1bp = 0.01%)
 * @param {string} side - 'BUY' | 'SELL'
 * @param {number} callPrice - 大V喊单价
 * @param {number} arrivalPrice - 收到消息时的盘口现价
 * @returns {number} 滑点基点 (>= 0)
 */
export function calculateSlipBps(side, callPrice, arrivalPrice) {
  if (!callPrice || callPrice <= 0 || !arrivalPrice || arrivalPrice <= 0) {
    return 0;
  }

  const cp = parseFloat(callPrice);
  const ap = parseFloat(arrivalPrice);

  if (side === 'BUY') {
    // 买入：现价高于喊单价算不利滑点；现价更低算0（有利）
    if (ap > cp) {
      return +(((ap - cp) / cp) * 10000).toFixed(2);
    }
    return 0;
  } else if (side === 'SELL') {
    // 卖出：现价低于喊单价算不利滑点；现价更高算0（有利）
    if (ap < cp) {
      return +(((cp - ap) / cp) * 10000).toFixed(2);
    }
    return 0;
  }
  return 0;
}

/**
 * 状态机纯逻辑判定 (Pure State Machine Evaluator)
 * @param {Object} params
 * @param {string} params.action - 'BUY' | 'SELL'
 * @param {string} params.ticker - 标的代码
 * @param {number} params.callPrice - 喊单价
 * @param {number} params.arrivalPrice - 现价
 * @param {number} params.msgCreatedAt - 大V发言时间戳 (毫秒)
 * @param {Array} params.currentPositions - 当前持仓列表
 * @param {number} [params.ttlSec=90] - 超时阈值 (秒)
 * @param {number} [params.nowMs] - 当前时间戳 (测试用)
 */
export function evaluateFollowDecision({
  action,
  ticker,
  callPrice,
  arrivalPrice,
  msgCreatedAt,
  currentPositions = [],
  ttlSec = FOLLOW_SPEC.TTL_SEC,
  nowMs = Date.now()
}) {
  const side = String(action || '').toUpperCase();
  const sym = String(ticker || '').toUpperCase();
  const callP = parseFloat(callPrice) || 0;
  const arrP = parseFloat(arrivalPrice) || callP;

  // 1. 计算发言延迟与剩余 TTL
  const msgTime = msgCreatedAt ? Number(msgCreatedAt) : nowMs;
  const elapsedSec = Math.max(0, (nowMs - msgTime) / 1000);
  const ttlRemainingSec = Math.max(0, +(ttlSec - elapsedSec).toFixed(1));

  // 判定 1: 消息超时 (EXPIRED)
  if (elapsedSec > ttlSec) {
    return {
      decision_state: 'EXPIRED',
      slip_bps: 0,
      ttl_remaining_sec: ttlRemainingSec,
      target_ratio: 0,
      reason: `消息接收已超时 (发言时间已过去 ${elapsedSec.toFixed(1)}s > TTL ${ttlSec}s)，判定为陈旧消息废弃`
    };
  }

  // 判定 2: 卖出指令但当前账户并无底仓 (SKIP_NO_POS)
  if (side === 'SELL') {
    const pos = currentPositions.find(p => p.ticker && p.ticker.toUpperCase() === sym);
    const existingQty = pos ? Number(pos.quantity) || 0 : 0;
    if (existingQty <= 0) {
      return {
        decision_state: 'SKIP_NO_POS',
        slip_bps: 0,
        ttl_remaining_sec: ttlRemainingSec,
        target_ratio: 0,
        reason: `大V发出卖出/清仓指令，但当前账户中无 ${sym} 底仓，直接跳过`
      };
    }
  }

  // 判定 3: 计算滑点并流转状态机
  const slipBps = calculateSlipBps(side, callP, arrP);

  if (slipBps > FOLLOW_SPEC.SLIP_REJECT_BPS) {
    // 现价滑点 > 40bp (0.4%)
    return {
      decision_state: 'SLIP_REJECT',
      slip_bps: slipBps,
      ttl_remaining_sec: ttlRemainingSec,
      target_ratio: 0,
      reason: `现价滑点过大 (${slipBps}bp > ${FOLLOW_SPEC.SLIP_REJECT_BPS}bp)，突破安全边界坚决拒单，不追高/杀跌`
    };
  } else if (slipBps > FOLLOW_SPEC.SLIP_FIRE_MAX_BPS) {
    // 现价滑点在 (20bp, 40bp] 之间
    return {
      decision_state: 'SIZE_DOWN',
      slip_bps: slipBps,
      ttl_remaining_sec: ttlRemainingSec,
      target_ratio: 0.5,
      reason: `现价滑点略大 (${slipBps}bp 在 20~40bp 区间)，触发风控仓位减半 (1/2)`
    };
  } else {
    // 现价滑点 <= 20bp
    return {
      decision_state: 'FIRE',
      slip_bps: slipBps,
      ttl_remaining_sec: ttlRemainingSec,
      target_ratio: 1.0,
      reason: `TTL与滑点风控通过 (${slipBps}bp <= 20bp，剩余有效时间 ${ttlRemainingSec}s)，全额限价执行`
    };
  }
}

/**
 * 完整跟单意图执行入口 (Process Follow Decision)
 * @param {Object} params
 * @param {Object} params.signal - 解析出的信号 { ticker, action, price, quantity, stopLoss, reason, signal_id, message_id }
 * @param {number} [params.arrivalPrice] - 现价（若未提供则默认取 signal.price）
 * @param {number} [params.msgCreatedAt] - 大V发言时间戳 (ms)
 * @param {string} [params.accountType='paper'] - 'paper' | 'real'
 * @param {boolean} [params.dryRun=false] - 仅决策不实际执行
 */
export async function processFollowDecision({
  signal,
  arrivalPrice = null,
  msgCreatedAt = null,
  accountType = 'paper',
  dryRun = false
}) {
  const ticker = String(signal.ticker || '').toUpperCase();
  const action = String(signal.action || '').toUpperCase();
  const callPrice = parseFloat(signal.price) || 0;
  const arrPrice = arrivalPrice !== null ? parseFloat(arrivalPrice) : callPrice;
  const initialQty = parseInt(signal.quantity || 100, 10);

  // 1. 获取当前持仓用于底仓风控
  let positions = [];
  try {
    positions = await getUnifiedPositions();
  } catch (e) {
    console.warn('[Follow Engine] 获取持仓失败，默认按空仓处理:', e.message);
  }

  // 2. 状态机纯逻辑评估
  const evaluation = evaluateFollowDecision({
    action,
    ticker,
    callPrice,
    arrivalPrice: arrPrice,
    msgCreatedAt,
    currentPositions: positions,
    ttlSec: FOLLOW_SPEC.TTL_SEC
  });

  const decisionId = `dec_${Date.now()}_${ticker}_${Math.random().toString(36).substring(2, 7)}`;
  const signalId = signal.signal_id || signal.id || `sig_${ticker}_${Date.now()}`;
  const messageId = signal.message_id || signal.msg_id || '';

  // 3. 计算实际执行股数 (executedQty)
  let executedQty = 0;
  if (evaluation.decision_state === 'FIRE') {
    executedQty = initialQty;
  } else if (evaluation.decision_state === 'SIZE_DOWN') {
    executedQty = Math.max(1, Math.floor(initialQty * (evaluation.target_ratio || 0.5)));
  }

  // 4. 落地决策意图到 follow_decisions 表 (Signal -> Decision 账本)
  const decisionRecord = {
    decision_id: decisionId,
    action_id: signalId,
    cu_id: messageId || 'cu_default',
    signal_id: signalId,
    message_id: messageId,
    account_type: accountType,
    decision_state: evaluation.decision_state,
    ticker,
    side: action,
    call_price: callPrice,
    arrival_price: arrPrice,
    slip_bps: evaluation.slip_bps,
    ttl_remaining_sec: evaluation.ttl_remaining_sec,
    executed_qty: executedQty,
    reason: evaluation.reason,
    created_at: Date.now(),
    updated_at: Date.now()
  };

  try {
    saveFollowDecision(decisionRecord);
  } catch (dbErr) {
    console.error('[Follow Engine] 决策落库失败:', dbErr.message);
  }

  // 5. 模拟执行或实盘防护
  let executionResult = null;

  if (dryRun) {
    return {
      decision: decisionRecord,
      executed: false,
      reason: 'dryRun 模式，仅生成决策记录'
    };
  }

  if (accountType === 'paper') {
    // 仅在 FIRE 或 SIZE_DOWN 时进行 Paper 模拟成交
    if (evaluation.decision_state === 'FIRE' || evaluation.decision_state === 'SIZE_DOWN') {
      try {
        console.log(`[Follow Engine] Paper 状态机触发执行: [${evaluation.decision_state}] ${action} ${ticker} ${executedQty}股 @ $${arrPrice} (${evaluation.reason})`);
        
        executionResult = await executeOrder({
          ticker,
          action,
          price: arrPrice,
          quantity: executedQty,
          stopLoss: signal.stopLoss || null,
          reason: `[Paper 跟单状态机 ${evaluation.decision_state}] ${evaluation.reason}`,
          account_type: 'paper'
        });

        // 更新决策表中的实际成交股数
        if (!executionResult.success) {
          decisionRecord.executed_qty = 0;
          decisionRecord.reason = `状态机通过但订单执行失败: ${executionResult.reason}`;
          saveFollowDecision(decisionRecord);
        }
      } catch (execErr) {
        console.error('[Follow Engine] executeOrder 异常:', execErr.message);
        executionResult = { success: false, reason: execErr.message };
      }
    } else {
      console.log(`[Follow Engine] 状态机风控拦截: [${evaluation.decision_state}] ${action} ${ticker} - ${evaluation.reason}`);
      executionResult = { success: false, reason: evaluation.reason };
    }
  } else {
    // 严禁全自动实盘下单！必须经由 Phase C 确认卡片
    console.warn(`[Follow Engine] 拦截到非 Paper 账户指令 (account_type=${accountType})。实盘通道严格禁止全自动直连，须经 Phase C 交互卡片审核。已标记为拦截。`);
    executionResult = {
      success: false,
      reason: '实盘禁止全自动直连下单，请等待移动端确认卡片 (Phase C)'
    };
  }

  return {
    decision: decisionRecord,
    executionResult,
    executed: !!(executionResult && executionResult.success)
  };
}

/**
 * 统计并评估跟单质量指标（对齐 REQ-021 / Phase D 准入门禁）
 * @param {Object} [options]
 * @param {number} [options.days=20] - 考察统计窗口（默认连续 20 个交易日）
 * @param {Object} [options.dbInstance=null]
 * @returns {Object} 门禁审计结果与详细指标报告
 */
export function calculateFollowQualityMetrics({ days = 20, dbInstance = null } = {}) {
  const db = dbInstance || getDb();
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

  const decisions = db.prepare(`
    SELECT * FROM follow_decisions
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(startTime);

  const total = decisions.length;
  if (total === 0) {
    return {
      qualified: false,
      reason: '样本量不足：过去 ' + days + ' 天内无跟单决策记录',
      metrics: {
        total: 0,
        fireCount: 0,
        sizeDownCount: 0,
        slipRejectCount: 0,
        expiredCount: 0,
        parseErrorCount: 0,
        parseErrorRate: 0,
        executionRate: 0
      },
      gateChecklist: {
        minDaysMet: false,
        sampleSizeMet: false,
        accuracyMet: false,
        lowErrorMet: false
      }
    };
  }

  let fireCount = 0;
  let sizeDownCount = 0;
  let slipRejectCount = 0;
  let expiredCount = 0;
  let parseErrorCount = 0;
  let timeoutCount = 0;

  for (const d of decisions) {
    const s = d.decision_state;
    if (s === 'FIRE') fireCount++;
    else if (s === 'SIZE_DOWN') sizeDownCount++;
    else if (s === 'SLIP_REJECT') slipRejectCount++;
    else if (s === 'EXPIRED') expiredCount++;
    else if (s === 'PARSE_ERROR_REPORTED') parseErrorCount++;
    else if (s === 'SKIP_MANUAL_TIMEOUT') timeoutCount++;
  }

  const executedCount = fireCount + sizeDownCount;
  const parseErrorRate = +(parseErrorCount / total).toFixed(4);
  const executionRate = +(executedCount / total).toFixed(4);
  const accuracyRate = +(1 - parseErrorRate).toFixed(4);

  // 准入门禁判据（规格：代码/方向抽取准确率 >= 97%，运行样本充分）
  const sampleSizeMet = total >= 15;
  const accuracyMet = accuracyRate >= 0.97;
  const lowErrorMet = parseErrorRate <= 0.03;

  const qualified = sampleSizeMet && accuracyMet && lowErrorMet;

  return {
    qualified,
    reason: qualified ? 'Paper 模拟仓指标达标，允许开启实盘确认通道' : 'Paper 模拟指标未达标，严禁开启实盘',
    metrics: {
      total,
      fireCount,
      sizeDownCount,
      slipRejectCount,
      expiredCount,
      parseErrorCount,
      timeoutCount,
      accuracyRate,
      parseErrorRate,
      executionRate
    },
    gateChecklist: {
      sampleSizeMet,
      accuracyMet,
      lowErrorMet
    }
  };
}

