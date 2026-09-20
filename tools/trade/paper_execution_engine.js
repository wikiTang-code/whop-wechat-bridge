/**
 * REQ-056: 长桥模拟盘执行闭环与 TradeIntent 最小执行状态机调度引擎
 * 
 * 核心原则：
 * 1. auto_submit = false 默认硬锁定，所有 Intent 必须经过 HITL 人工确认才能向柜台报送
 * 2. 严格限定 BROKER_MODE=paper 模拟盘通道
 * 3. 价格因果锁死：无有效盘口报价直接拒单 (NO_VALID_PRICE)
 * 4. 订单生命周期闭环：报送 -> 轮询 -> 终态回写 (FILLED/CANCELLED) -> 触发持仓第一真源刷新
 */

import {
  saveTradeIntent,
  updateTradeIntent,
  getTradeIntent,
  listTradeIntents,
  getPaperPositions
} from '../../database.js';
import * as defaultBroker from '../../brokers/longbridge.js';

export const AUTO_SUBMIT_ENABLED = false; // 硬编码安全门禁，禁止全自动报送柜台

/**
 * 创建一笔新的交易意图 (TradeIntent)
 * @param {object} params
 * @param {string} params.ticker 标的代码
 * @param {'BUY'|'SELL'} params.side 买卖方向
 * @param {number} params.quantity 固定股数 (正整数)
 * @param {number} params.price_limit 限价保护价格
 * @param {string} [params.source] 信号源 (如 'zhao_follow', 'radar_resonance')
 * @param {Array<any>} [params.evidence] 依据链条
 * @param {number} [params.expires_in_sec] 确认超时时间 (默认 900 秒即 15 分钟)
 * @param {object} [options]
 * @param {object} [options.dbInstance]
 * @returns {object} 创建后的 TradeIntent 对象
 */
export function createTradeIntent({
  ticker,
  side,
  quantity,
  price_limit,
  source = 'zhao_follow',
  evidence = [],
  expires_in_sec = 900
}, { dbInstance = null } = {}) {
  const normTicker = String(ticker || '').trim().toUpperCase();
  const normSide = String(side || '').trim().toUpperCase();
  const parsedQty = parseInt(quantity, 10);
  const parsedPrice = parseFloat(price_limit);

  if (!normTicker) {
    throw new Error('[TradeIntent] 标的代码不能为空');
  }
  if (normSide !== 'BUY' && normSide !== 'SELL') {
    throw new Error(`[TradeIntent] 无效买卖方向: ${side}`);
  }
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    throw new Error(`[TradeIntent] 无效数量: ${quantity}，必须为大于 0 的整数`);
  }

  const intentId = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const expiresAt = new Date(now + expires_in_sec * 1000).toISOString();

  // 因果与价格真实性检查：无有效限价直接标记拒单
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    const rejectedIntent = {
      intent_id: intentId,
      source,
      ticker: normTicker,
      side: normSide,
      quantity: parsedQty,
      order_type: 'LIMIT',
      price_limit: 0,
      expires_at: expiresAt,
      evidence,
      status: 'REJECTED',
      reject_reason: 'NO_VALID_PRICE',
      created_at: now
    };
    saveTradeIntent(rejectedIntent, dbInstance);
    console.warn(`[TradeIntent] 拒绝生成有效意图 [${intentId}]: 缺乏有效价格 (price_limit=${price_limit})`);
    return rejectedIntent;
  }

  // 默认进入 PENDING_HITL，等待人工核准确认
  const intent = {
    intent_id: intentId,
    source,
    ticker: normTicker,
    side: normSide,
    quantity: parsedQty,
    order_type: 'LIMIT',
    price_limit: parsedPrice,
    expires_at: expiresAt,
    evidence,
    status: 'PENDING_HITL',
    reject_reason: null,
    created_at: now
  };

  saveTradeIntent(intent, dbInstance);
  console.log(`[TradeIntent] 意图已生成待人工核准: [${intentId}] ${normSide} ${normTicker} ${parsedQty}股 @ $${parsedPrice} (TTL: ${expires_in_sec}s)`);
  return intent;
}

/**
 * 确认并向长桥模拟柜台报送委托 (HITL 闭环入口)
 * @param {string} intentId 意图ID
 * @param {object} [options]
 * @param {object} [options.broker] 可注入的券商适配器 (默认 longbridge.js)
 * @param {object} [options.dbInstance]
 * @param {boolean} [options.awaitFinalStatus] 是否等待终态 (单测与同步模式可用)
 * @param {number} [options.timeoutMs] 轮询超时毫秒数 (默认 15000ms)
 * @returns {Promise<object>} 处理结果与最新 intent 状态
 */
export async function confirmAndSubmitIntent(intentId, {
  broker = defaultBroker,
  dbInstance = null,
  awaitFinalStatus = false,
  timeoutMs = 15000
} = {}) {
  const intent = getTradeIntent(intentId, dbInstance);
  if (!intent) {
    throw new Error(`[TradeIntent] 未找到意图: ${intentId}`);
  }

  if (intent.status !== 'PENDING_HITL') {
    throw new Error(`[TradeIntent] 意图状态不合法，无法报送: 当前状态为 ${intent.status}`);
  }

  // 检查是否在确认前已经过期
  if (intent.expires_at && new Date(intent.expires_at).getTime() < Date.now()) {
    updateTradeIntent(intentId, {
      status: 'REJECTED',
      reject_reason: 'EXPIRED_BEFORE_HITL'
    }, dbInstance);
    return { success: false, reason: 'EXPIRED_BEFORE_HITL', intent: getTradeIntent(intentId, dbInstance) };
  }

  // 严格安全断言：必须是模拟盘
  if (typeof broker.assertPaperMode === 'function') {
    broker.assertPaperMode();
  }

  try {
    console.log(`[TradeIntent] 人工确认通过，正在向柜台报送: [${intentId}] ${intent.side} ${intent.ticker} ${intent.quantity}股 @ $${intent.price_limit}`);
    
    // 向模拟柜台下单 (透传全时段 outsideRth 参数)
    const submitRes = await broker.placeOrder({
      ticker: intent.ticker,
      action: intent.side,
      quantity: intent.quantity,
      price: intent.price_limit,
      outsideRth: intent.outside_rth || 'AnyTime'
    });

    const orderId = String(submitRes.orderId || '');
    updateTradeIntent(intentId, {
      status: 'SUBMITTED',
      broker_order_id: orderId
    }, dbInstance);

    const trackingPromise = trackIntentLifecycle(intentId, orderId, { broker, dbInstance, timeoutMs });

    if (awaitFinalStatus) {
      const finalState = await trackingPromise;
      return { success: true, intent: finalState };
    }

    return {
      success: true,
      intent: getTradeIntent(intentId, dbInstance)
    };
  } catch (err) {
    console.error(`[TradeIntent] 报送柜台失败: [${intentId}]`, err.message);
    updateTradeIntent(intentId, {
      status: 'REJECTED',
      reject_reason: `SUBMIT_FAILED: ${err.message}`
    }, dbInstance);
    return {
      success: false,
      reason: err.message,
      intent: getTradeIntent(intentId, dbInstance)
    };
  }
}

/**
 * 追踪订单生命周期并在终态时刷新本地真源
 */
async function trackIntentLifecycle(intentId, orderId, { broker, dbInstance, timeoutMs = 15000 }) {
  try {
    console.log(`[TradeIntent Tracker] 开始追踪订单状态: intent=${intentId}, order=${orderId}`);
    const pollRes = await broker.pollOrderStatus(orderId, { timeoutMs, intervalMs: 1500 });

    if (pollRes.status === 'FILLED') {
      console.log(`[TradeIntent Tracker] 订单已完全成交 (FILLED): [${intentId}]`);
      updateTradeIntent(intentId, { status: 'FILLED' }, dbInstance);
      // 触发本地第一持仓真源 (broker_paper_positions) 同步
      if (typeof broker.syncPaperPositions === 'function') {
        await broker.syncPaperPositions();
      }
    } else if (pollRes.status === 'CANCELLED') {
      console.log(`[TradeIntent Tracker] 订单已撤销 (CANCELLED): [${intentId}]`);
      updateTradeIntent(intentId, { status: 'CANCELLED' }, dbInstance);
    } else if (pollRes.status === 'REJECTED') {
      console.warn(`[TradeIntent Tracker] 柜台已拒单 (REJECTED): [${intentId}]`);
      updateTradeIntent(intentId, { status: 'REJECTED', reject_reason: 'BROKER_REJECTED' }, dbInstance);
    } else if (pollRes.status === 'TIMEOUT') {
      console.warn(`[TradeIntent Tracker] 订单等待成交超时 (${timeoutMs}ms)，触发自动撤单: [${intentId}]`);
      try {
        if (typeof broker.cancelOrder === 'function') {
          await broker.cancelOrder(orderId);
        }
      } catch (cancelErr) {
        console.error(`[TradeIntent Tracker] 自动撤单请求异常:`, cancelErr.message);
      }
      updateTradeIntent(intentId, {
        status: 'CANCELLED',
        reject_reason: 'ORDER_TIMEOUT_AUTO_CANCELLED'
      }, dbInstance);
    }
  } catch (e) {
    console.error(`[TradeIntent Tracker] 状态机轮询发生未捕获异常:`, e.message);
  }

  return getTradeIntent(intentId, dbInstance);
}

/**
 * 人工主动放弃/撤销意图
 * @param {string} intentId 
 * @param {string} [reason] 
 * @param {object} [options]
 */
export async function cancelTradeIntent(intentId, reason = 'MANUAL_DISCARD', { broker = defaultBroker, dbInstance = null } = {}) {
  const intent = getTradeIntent(intentId, dbInstance);
  if (!intent) return { success: false, reason: 'NOT_FOUND' };

  if (intent.status === 'PENDING_HITL') {
    updateTradeIntent(intentId, {
      status: 'REJECTED',
      reject_reason: reason
    }, dbInstance);
    return { success: true, intent: getTradeIntent(intentId, dbInstance) };
  }

  if (intent.status === 'SUBMITTED' && intent.broker_order_id) {
    try {
      if (typeof broker.cancelOrder === 'function') {
        await broker.cancelOrder(intent.broker_order_id);
      }
      updateTradeIntent(intentId, {
        status: 'CANCELLED',
        reject_reason: reason
      }, dbInstance);
      return { success: true, intent: getTradeIntent(intentId, dbInstance) };
    } catch (e) {
      return { success: false, reason: e.message };
    }
  }

  return { success: false, reason: `CANNOT_CANCEL_IN_STATUS_${intent.status}` };
}

/**
 * 汇总当日意图各状态统计
 */
export function getPaperIntentSummary(dbInstance = null) {
  const intents = listTradeIntents({ limit: 500 }, dbInstance);
  const summary = {
    total: intents.length,
    pending_hitl: 0,
    submitted: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
    recent_intents: intents.slice(0, 10)
  };

  for (const it of intents) {
    const st = (it.status || '').toLowerCase();
    if (summary[st] !== undefined) {
      summary[st]++;
    }
  }
  return summary;
}
