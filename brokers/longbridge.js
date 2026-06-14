import { Config, TradeContext } from 'longbridge';
import dotenv from 'dotenv';

dotenv.config();

let tradeContext = null;

// Initialize TradeContext on demand
async function getContext() {
  if (tradeContext) return tradeContext;

  const appKey = process.env.LONGBRIDGE_APP_KEY;
  const appSecret = process.env.LONGBRIDGE_APP_SECRET;
  const accessToken = process.env.LONGBRIDGE_ACCESS_TOKEN;

  if (!appKey || !appSecret || !accessToken) {
    throw new Error('缺少长桥证券 API 配置项 (LONGBRIDGE_APP_KEY, LONGBRIDGE_APP_SECRET 或 LONGBRIDGE_ACCESS_TOKEN)');
  }

  // Create config
  const config = new Config({
    appKey,
    appSecret,
    accessToken,
  });

  // Create trade context instance
  tradeContext = await TradeContext.create(config);
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
  
  if (Array.isArray(balance)) {
    // 默认选取美股交易账户的 USD 余额，如不存在取第一个币种
    const usd = balance.find(b => b.currency === 'USD') || balance[0];
    if (usd) {
      usdBalance.cash = parseFloat(usd.cash || '0');
      usdBalance.power = parseFloat(usd.max_power || usd.cash || '0');
    }
  }

  return usdBalance;
}

/**
 * 获取当前长桥实盘持仓并格式化为系统标准格式
 * @returns {Promise<Array<{ ticker: string, quantity: number, average_entry_price: number, current_price: number, market_value: number, unrealized_pnl: number }>>}
 */
export async function getActivePositions() {
  const ctx = await getContext();
  const positions = await ctx.stockPositions();
  
  if (!Array.isArray(positions)) return [];
  
  return positions.map(pos => {
    // 长桥 symbol 格式如 "TSLA.US"，需要分割提取出股票代码
    const ticker = (pos.symbol || '').split('.')[0] || '';
    const quantity = parseInt(pos.quantity || '0', 10);
    const avgPrice = parseFloat(pos.cost_price || '0');
    const currentPrice = parseFloat(pos.current_price || '0');
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
  });
}

/**
 * 向长桥柜台提交交易订单
 * @returns {Promise<{ success: boolean, orderId: string, status: string, raw: any }>}
 */
export async function placeOrder({ ticker, action, quantity, price }) {
  const ctx = await getContext();
  
  // 补全美股代码后缀，如 TSLA -> TSLA.US
  const symbol = `${ticker.toUpperCase()}.US`;
  const side = action.toUpperCase() === 'BUY' ? 'Buy' : 'Sell';
  
  console.log(`[长桥实盘] 正在向柜台提交限价委托: [${side}] ${symbol} | 股数: ${quantity} | 价格: $${price}`);
  
  const order = await ctx.submitOrder({
    symbol,
    side,
    type: 'Limit', // 采用限价委托保证滑点安全
    price: price.toString(),
    quantity: quantity,
    timeInForce: 'Day' // 当日有效单
  });

  return {
    success: true,
    orderId: order.order_id || `lb_${Date.now()}`,
    status: 'PENDING', // 刚提交为排队等待撮合状态
    raw: order
  };
}
