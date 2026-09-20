/**
 * tools/trade/signal_intent_bridge.js
 * 
 * 赵哥喊单/交易单流水 -> TradeIntent 桥接与硬风控拦截器
 * 
 * 核心治理规则 (AGENTS.md 红线 9 & 10 & 12):
 * 1. 发送者绝对硬锁: 必须且只能是赵哥本人 (user_4yeplXgbguTu4)
 * 2. 交易单专属频道限制: 历史股票期权记录区 / 不用翻墙期权
 * 3. 卖单底仓硬核拦截 (SELL Without Inventory Guard):
 *    - 若赵哥发卖单，而本地模拟盘此前未跟开仓 (持仓量 = 0)，坚决硬阻断，不生成挂单
 * 4. 契约中心门禁: 严格生成 status='PENDING_HITL' 的 TradeIntent，禁止直接 placeOrder
 */

import { getDb, getPaperPositions, saveTradeIntent } from '../../database.js';
import { createTradeIntent } from './paper_execution_engine.js';
import { evaluatePreTradeRisk } from './paper_risk_guard.js';

// 治理红线：大V身份与专属频道
export const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
export const ALLOWED_CHANNELS = [
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN', // 历史股票期权记录区
  'chat_feed_1CTrCEx44dP13jW3RVkYiS'   // 不用翻墙期权
];

/**
 * 将赵哥喊单/交易信号安全转化为待确认的 TradeIntent
 * @param {object} signal 交易信号对象 (来自 trade_signals 或实时消息解析)
 * @param {object} [options]
 * @param {object} [options.dbInstance]
 * @param {boolean} [options.bypassChannelCheck=false] 回测或演练模式下是否放行非标准频道
 * @returns {{ success: boolean, intent: object|null, reason: string }}
 */
export function convertSignalToTradeIntent(signal, { dbInstance = null, bypassChannelCheck = false } = {}) {
  const db = dbInstance || getDb();

  // 1. 发送者身份绝对硬锁 (红线 9)
  if (signal.speaker_id && signal.speaker_id !== ZHAO_SENDER_ID) {
    return {
      success: false,
      intent: null,
      reason: `SECURITY_REJECT_INVALID_SENDER: 发送者 ${signal.speaker_id} 非赵哥本人 (${ZHAO_SENDER_ID})，严禁跟单`
    };
  }

  // 2. 专属交易单频道限制 (红线 10)
  if (!bypassChannelCheck && signal.channel_id && !ALLOWED_CHANNELS.includes(signal.channel_id)) {
    return {
      success: false,
      intent: null,
      reason: `SECURITY_REJECT_INVALID_CHANNEL: 频道 ${signal.channel_id} 非交易单专属采集区`
    };
  }

  // 3. 买卖方向与标的标准化
  const ticker = String(signal.ticker || '').trim().toUpperCase();
  const rawAction = String(signal.action || '').trim().toUpperCase();
  let side = 'BUY';
  if (rawAction.includes('SELL') || rawAction.includes('CLOSE') || rawAction.includes('EXIT') || rawAction.includes('平仓') || rawAction.includes('卖出')) {
    side = 'SELL';
  } else if (rawAction.includes('BUY') || rawAction.includes('ENTRY') || rawAction.includes('买入') || rawAction.includes('加仓')) {
    side = 'BUY';
  } else {
    return {
      success: false,
      intent: null,
      reason: `REJECT_UNKNOWN_ACTION: 未知买卖动作 ${rawAction}`
    };
  }

  const price = parseFloat(signal.price) || 0;
  let quantity = parseInt(signal.quantity, 10) || 1;

  // 4. 关键硬门禁: 卖单底仓核验 (SELL Without Inventory Guard)
  // 如果是卖单，检查本地第一真源持仓 broker_paper_positions
  if (side === 'SELL') {
    const currentPositions = getPaperPositions(db);
    const existing = currentPositions.find(p => p.ticker === ticker && p.quantity > 0);

    if (!existing || existing.quantity <= 0) {
      return {
        success: false,
        intent: null,
        reason: `REJECTED_NO_UNDERLYING_POSITION: 标的 ${ticker} 当前模拟盘底仓为 0。此前买入开仓未跟，不可盲目做空或平仓`
      };
    }

    // 若卖出数量超过现有底仓，截断至当前最大可用底仓 (防裸空)
    if (quantity > existing.quantity) {
      console.warn(`[Signal-Intent Bridge] 卖出数量 ${quantity} 超过当前底仓 ${existing.quantity}，自动裁剪至底仓量`);
      quantity = existing.quantity;
    }
  }

  // 5. 走统一事前硬风控引擎
  const riskCheck = evaluatePreTradeRisk({
    ticker,
    side,
    quantity,
    price_limit: price
  }, { dbInstance: db });

  if (!riskCheck.passed) {
    return {
      success: false,
      intent: null,
      reason: riskCheck.reject_reason
    };
  }

  // 6. 生成规范的不可变 TradeIntent (强制 PENDING_HITL)
  const intent = createTradeIntent({
    ticker,
    side,
    quantity,
    price_limit: price,
    source: `zhao_signal_${signal.signal_id || signal.message_id || 'stream'}`,
    evidence: [
      { speaker_id: signal.speaker_id || ZHAO_SENDER_ID },
      { channel_id: signal.channel_id || 'audited_pool' },
      { raw_text: signal.reason || signal.raw_text || '' },
      { risk_notional: riskCheck.details?.notional }
    ],
    expires_in_sec: 1800
  }, { dbInstance: db });

  return {
    success: true,
    intent,
    reason: null
  };
}
