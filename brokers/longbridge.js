import { Config, TradeContext, OutsideRTH, OrderType, OrderSide, TimeInForceType, Decimal } from 'longbridge';
import dotenv from 'dotenv';
import { savePaperPositions } from '../database.js';

dotenv.config();

let tradeContext = null;

/**
 * 安全断言：强制锁定 paper 模拟盘模式
 */
export function assertPaperMode() {
  const mode = (process.env.BROKER_MODE || '').trim().toLowerCase();
  if (mode !== 'paper') {
    throw new Error(`[安全阻断] 当前 BROKER_MODE='${process.env.BROKER_MODE || 'UNSET'}'，系统硬锁定仅允许在 paper 模式下执行模拟交易！`);
  }
}

// Initialize TradeContext on demand
export async function getContext() {
  if (tradeContext) return tradeContext;

  const appKey = process.env.LONGBRIDGE_APP_KEY;
  const appSecret = process.env.LONGBRIDGE_APP_SECRET;
  const accessToken = process.env.LONGBRIDGE_ACCESS_TOKEN;

  if (!appKey || !appSecret || !accessToken) {
    throw new Error('缺少长桥证券 API 配置项 (LONGBRIDGE_APP_KEY, LONGBRIDGE_APP_SECRET 或 LONGBRIDGE_ACCESS_TOKEN)');
  }

  // Create config
  const config = typeof Config.fromApikey === 'function'
    ? Config.fromApikey(appKey, appSecret, accessToken)
    : new Config({ appKey, appSecret, accessToken });

  // Create trade context instance
  if (typeof TradeContext.new === 'function') {
    tradeContext = await TradeContext.new(config);
  } else if (typeof TradeContext.create === 'function') {
    tradeContext = await TradeContext.create(config);
  } else {
    throw new Error('TradeContext initialization method not found');
  }
  return tradeContext;
}

/**
 * 获取长桥账户的可用现金和总净值
 * @returns {Promise<{ cash: number, power: number }>}
 */
export async function getAccountBalances() {
  const ctx = await getContext();
  const balance = await ctx.accountBalance();
  
  let usdBalance = { cash: 0, power: 0 };
  
  if (Array.isArray(balance) && balance.length > 0) {
    const acc = balance[0];
    usdBalance.power = parseFloat(acc.buyPower || acc.max_power || acc.totalCash || acc.netAssets || '0');
    
    // 如果存在分币种详情
    if (Array.isArray(acc.cashInfos)) {
      const usdInfo = acc.cashInfos.find((c) => c.currency === 'USD') || acc.cashInfos[0];
      if (usdInfo) {
        usdBalance.cash = parseFloat(usdInfo.availableCash || usdInfo.cash || '0');
      }
    } else {
      usdBalance.cash = parseFloat(acc.cash || '0');
    }
  }

  return usdBalance;
}

/**
 * 获取当前长桥模拟持仓并格式化为系统标准格式
 * @returns {Promise<Array<{ ticker: string, quantity: number, average_entry_price: number, current_price: number, market_value: number, unrealized_pnl: number }>>}
 */
export async function getActivePositions() {
  const ctx = await getContext();
  let rawPositions = [];
  try {
    const raw = await ctx.stockPositions();
    if (Array.isArray(raw)) {
      rawPositions = raw;
    } else if (raw && Array.isArray(raw.channels)) {
      rawPositions = raw.channels.flatMap((ch) =>
        Array.isArray(ch?.positions) ? ch.positions : []
      );
    } else if (raw && Array.isArray(raw.positions)) {
      rawPositions = raw.positions;
    }
  } catch (err) {
    console.warn('[长桥模拟盘/Paper] 获取持仓异常，安全降级为空列表:', err.message);
    return [];
  }
  
  if (!Array.isArray(rawPositions)) return [];
  
  return rawPositions.map(pos => {
    // 长桥 symbol 格式如 "TSLA.US"，需要分割提取出股票代码
    const ticker = (pos.symbol || '').split('.')[0] || '';
    const quantity = parseInt(pos.quantity || '0', 10);
    const avgPrice = parseFloat(pos.costPrice || pos.cost_price || '0');
    const currentPrice = parseFloat(pos.currentPrice || pos.current_price || '0');
    const marketValue = quantity * currentPrice;
    const unrealizedPnl = (currentPrice - avgPrice) * quantity;
    
    return {
      ticker,

      quantity,
      average_entry_price: avgPrice,
      current_price: currentPrice,
      market_value: marketValue,
      unrealized_pnl: unrealizedPnl
    };
  }).filter((p) => p.ticker);
}

/**
 * 标准化长桥订单状态枚举 (兼容官方整数枚举 5, 15, 14, 16, 11, 1 与字符串)
 */
export function normalizeOrderStatus(status) {
  if (status === null || status === undefined) return 'UNKNOWN';
  const str = String(status).trim();
  // 长桥枚举数值对齐:
  // 5 = Filled
  // 15 = Canceled
  // 14 = Rejected
  // 16 = Expired
  // 11 = PartialFilled
  // 1 = NotReported, 7 = New, 6 = WaitToNew
  if (str === '5' || str.toLowerCase() === 'filled') return 'FILLED';
  if (str === '15' || str.toLowerCase() === 'canceled' || str.toLowerCase() === 'cancelled') return 'CANCELLED';
  if (str === '14' || str.toLowerCase() === 'rejected') return 'REJECTED';
  if (str === '16' || str.toLowerCase() === 'expired') return 'EXPIRED';
  if (str === '11' || str.toLowerCase() === 'partialfilled') return 'PARTIAL_FILLED';
  if (str === '1' || str === '6' || str === '7' || str.toLowerCase() === 'new' || str.toLowerCase() === 'notreported') return 'SUBMITTED';
  return str.toUpperCase();
}

/**
 * 标准化长桥买卖方向枚举 (兼容整数 1: Buy, 2: Sell 与字符串)
 */
export function normalizeOrderSide(side) {
  if (side === null || side === undefined) return 'UNKNOWN';
  const str = String(side).trim();
  if (str === '1' || str.toLowerCase() === 'buy') return 'BUY';
  if (str === '2' || str.toLowerCase() === 'sell') return 'SELL';
  return str.toUpperCase();
}

/**
 * 当日委托只读（不下单）
 * @returns {Promise<Array<{ order_id: string, ticker: string, side: string, quantity: number, price: number, status: string }>>}
 */
export async function getTodayOrders() {
  const ctx = await getContext();
  const orders = await ctx.todayOrders();
  if (!Array.isArray(orders)) return [];
  return orders.map((o) => {
    const ticker = String(o.symbol || '').split('.')[0] || '';
    return {
      order_id: String(o.orderId || o.order_id || o.id || ''),
      ticker,
      side: normalizeOrderSide(o.side),
      quantity: parseInt(o.quantity || '0', 10),
      price: parseFloat(o.price || o.submittedPrice || o.submitted_price || '0'),
      status: normalizeOrderStatus(o.status),
    };
  });
}


/**
 * 向长桥柜台提交交易订单（严格限 Paper 模拟盘模式）
 * @returns {Promise<{ success: boolean, orderId: string, status: string, raw: any }>}
 */
export async function placeOrder({ ticker, action, quantity, price, outsideRth = 'AnyTime' }) {
  assertPaperMode();
  const ctx = await getContext();
  
  // 补全美股代码后缀，如 TSLA -> TSLA.US
  const symbol = `${ticker.toUpperCase()}.US`;
  const side = action.toUpperCase() === 'BUY' ? 'Buy' : 'Sell';
  
  // 映射 OutsideRTH 枚举 (支持盘前 Pre-market、常规 RTH、盘后 Post-market 与夜盘 Overnight)
  let rthMode = OutsideRTH.AnyTime;
  const normRth = String(outsideRth || '').toLowerCase();
  if (normRth === 'overnight') {
    rthMode = OutsideRTH.Overnight;
  } else if (normRth === 'rthonly') {
    rthMode = OutsideRTH.RTHOnly;
  }
  
  console.log(`[长桥模拟盘/Paper] 正在向模拟柜台提交限价委托: [${side}] ${symbol} | 股数: ${quantity} | 限价: $${price} | 跨时段模式: ${outsideRth}`);
  
  const orderSide = action.toUpperCase() === 'BUY' ? OrderSide.Buy : OrderSide.Sell;
  const submittedQuantity = new Decimal(quantity.toString());
  const submittedPrice = new Decimal(price.toString());

  const order = await ctx.submitOrder({
    symbol,
    orderType: OrderType.LO, // 限价单 (Limit Order)
    side: orderSide,
    submittedQuantity,
    submittedPrice,
    timeInForce: TimeInForceType.Day, // 当日有效单
    outsideRth: rthMode
  });

  const orderId = String(order.orderId || order.order_id || `lb_${Date.now()}`);

  return {
    success: true,
    orderId,
    status: 'SUBMITTED', // 统一为已向柜台提交待撮合
    raw: order
  };
}


/**
 * 撤销模拟盘委托订单
 * @param {string} orderId 
 * @returns {Promise<{ success: boolean, orderId: string }>}
 */
export async function cancelOrder(orderId) {
  assertPaperMode();
  const ctx = await getContext();
  console.log(`[长桥模拟盘/Paper] 正在向柜台申请撤单: ${orderId}`);
  await ctx.cancelOrder(orderId);
  return { success: true, orderId: String(orderId) };
}

/**
 * 轮询订单终态 (支持 Filled / Cancelled / Rejected / Timeout)
 * @param {string} orderId
 * @param {object} [options]
 * @returns {Promise<{ status: 'FILLED'|'CANCELLED'|'REJECTED'|'TIMEOUT', order: any }>}
 */
export async function pollOrderStatus(orderId, { timeoutMs = 15000, intervalMs = 2000 } = {}) {
  const startTime = Date.now();
  const targetId = String(orderId);

  while (Date.now() - startTime < timeoutMs) {
    const orders = await getTodayOrders();
    const matched = orders.find(o => o.order_id === targetId);

    if (matched) {
      const s = normalizeOrderStatus(matched.status);
      if (s === 'FILLED') {
        return { status: 'FILLED', order: matched };
      }
      if (s === 'CANCELLED') {
        return { status: 'CANCELLED', order: matched };
      }
      if (s === 'REJECTED') {
        return { status: 'REJECTED', order: matched };
      }
    }


    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // 超时未达到终态
  const orders = await getTodayOrders();
  const finalCheck = orders.find(o => o.order_id === targetId) || null;
  return { status: 'TIMEOUT', order: finalCheck };
}

/**
 * 从长桥模拟盘拉取最新持仓并持久化到本地 SQLite (broker_paper_positions) 作为第一真源
 * @returns {Promise<Array<any>>}
 */
export async function syncPaperPositions() {
  assertPaperMode();
  const positions = await getActivePositions();
  savePaperPositions(positions);
  console.log(`[长桥模拟盘/Paper] 成功同步 ${positions.length} 笔模拟盘持仓至本地真源 (broker_paper_positions)`);
  return positions;
}

