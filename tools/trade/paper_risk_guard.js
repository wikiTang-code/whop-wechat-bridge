/**
 * tools/trade/paper_risk_guard.js
 * REQ-056: 模拟盘事前硬风控引擎 (Pre-Trade Risk Guard)
 * 
 * 核心原则:
 * 1. 拦截不合规的 TradeIntent，阻断未受控的资金暴露;
 * 2. 单笔最大名义敞口限额保护 (防止手抖/错误大单);
 * 3. 资产类型与标的白名单门禁 (仅限正股与 2x ETF，期权硬阻断);
 * 4. 极端价格滑点与偏离度保护 (Fat-finger Guard);
 * 5. 单日最大频次与标的集中度保护。
 */

import { getPaperPositions, listTradeIntents } from '../../database.js';

export const RISK_CONFIG = {
  // 单笔订单最大名义金额 (美元)
  MAX_SINGLE_ORDER_NOTIONAL: 5000.0,
  // 允许的最大同时持仓标的数
  MAX_ACTIVE_POSITION_COUNT: 8,
  // 允许的最大单日已报单笔数
  MAX_DAILY_SUBMITTED_ORDERS: 30,
  // 允许的最大滑点/限价偏离幅度 (10%)
  MAX_PRICE_DEVIATION_RATIO: 0.10,
  // 禁止资产类型特征正则 (期权/权证/牛熊证格式拦截)
  DISALLOWED_TICKER_PATTERNS: [
    /\d{6}[CP]\d+/i,        // 如 TSLA260918C00250000 标准美股期权 OCC 格式
    /^[A-Z]+\s+\d{2,4}/i,   // 如 TSLA 250 Call
    /\.HK$/i,               // 港股 (Phase 0 暂限美股)
    /\.SH$|\.SZ$/i          // A股
  ]
};

/**
 * 执行事前硬风控检查
 * @param {object} intent 待校验意图
 * @param {string} intent.ticker 标的代码
 * @param {string} intent.side 买卖方向 (BUY/SELL)
 * @param {number} intent.quantity 股数
 * @param {number} intent.price_limit 限价
 * @param {number} [intent.reference_price] 当前市场参考价 (用于防手抖偏离度校验)
 * @param {object} [options]
 * @param {object} [options.dbInstance]
 * @returns {{ passed: boolean, reject_reason: string|null, details: object }}
 */
export function evaluatePreTradeRisk(intent, { dbInstance = null } = {}) {
  const ticker = String(intent.ticker || '').trim().toUpperCase();
  const side = String(intent.side || '').trim().toUpperCase();
  const qty = parseInt(intent.quantity, 10) || 0;
  const price = parseFloat(intent.price_limit) || 0;
  const notional = qty * price;

  const result = {
    passed: true,
    reject_reason: null,
    details: {
      ticker,
      side,
      qty,
      price,
      notional,
      timestamp: Date.now()
    }
  };

  // 1. 标的合法性与期权拦截
  for (const pattern of RISK_CONFIG.DISALLOWED_TICKER_PATTERNS) {
    if (pattern.test(ticker)) {
      result.passed = false;
      result.reject_reason = `RISK_DISALLOWED_ASSET_TYPE: 标的 ${ticker} 包含期权或非美股格式，Phase 0 仅限美股正股与 2x ETF`;
      return result;
    }
  }

  // 2. 单笔最大名义金额硬限制
  if (notional > RISK_CONFIG.MAX_SINGLE_ORDER_NOTIONAL) {
    result.passed = false;
    result.reject_reason = `RISK_EXCEED_MAX_NOTIONAL: 单笔金额 $${notional.toFixed(2)} 超过限额 $${RISK_CONFIG.MAX_SINGLE_ORDER_NOTIONAL}`;
    return result;
  }

  // 3. 价格真实性检查
  if (price <= 0 || !Number.isFinite(price)) {
    result.passed = false;
    result.reject_reason = 'RISK_INVALID_PRICE: 限价必须大于 0 且为有限数字';
    return result;
  }

  // 4. 价格偏离度检查 (Fat-finger / 巨额滑点防范)
  if (intent.reference_price && Number.isFinite(intent.reference_price) && intent.reference_price > 0) {
    const dev = Math.abs(price - intent.reference_price) / intent.reference_price;
    if (dev > RISK_CONFIG.MAX_PRICE_DEVIATION_RATIO) {
      result.passed = false;
      result.reject_reason = `RISK_PRICE_DEVIATION_TOO_LARGE: 限价 $${price} 与参考价 $${intent.reference_price} 偏差 ${(dev * 100).toFixed(1)}% 超过 ${(RISK_CONFIG.MAX_PRICE_DEVIATION_RATIO * 100)}% 容忍度`;
      return result;
    }
  }

  // 5. 持仓集中度检查 (针对开仓 BUY 方向)
  if (side === 'BUY') {
    const currentPositions = getPaperPositions(dbInstance);
    const hasTicker = currentPositions.some(p => p.ticker === ticker && p.quantity > 0);
    if (!hasTicker && currentPositions.length >= RISK_CONFIG.MAX_ACTIVE_POSITION_COUNT) {
      result.passed = false;
      result.reject_reason = `RISK_MAX_POSITIONS_REACHED: 当前持仓标的数已达上限 (${currentPositions.length}/${RISK_CONFIG.MAX_ACTIVE_POSITION_COUNT})，禁止新增开仓`;
      return result;
    }
  }

  // 6. 日内下单频次保护
  const todayIntents = listTradeIntents({ limit: 100 }, dbInstance);
  const submittedCount = todayIntents.filter(it => it.status === 'SUBMITTED' || it.status === 'FILLED').length;
  if (submittedCount >= RISK_CONFIG.MAX_DAILY_SUBMITTED_ORDERS) {
    result.passed = false;
    result.reject_reason = `RISK_DAILY_ORDER_LIMIT_REACHED: 今日已累计报送 ${submittedCount} 笔，触发单日流控保护 (上限 ${RISK_CONFIG.MAX_DAILY_SUBMITTED_ORDERS} 笔)`;
    return result;
  }

  return result;
}
