import { 
  getPortfolio, 
  updatePortfolioCash, 
  getPositions, 
  savePosition, 
  saveOrder 
} from './database.js';
import { 
  getAccountBalances, 
  getActivePositions, 
  placeOrder as placeLongbridgeOrder 
} from './brokers/longbridge.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 风控与交易引擎 (Risk & Trade Execution Engine)
 */

// 从环境变量读取风控配置（提供默认安全阀值）
const RISK_PER_TRADE_PCT = parseFloat(process.env.RISK_PER_TRADE_PCT || '0.01'); // 单笔风险控制 1%
const MAX_CONCENTRATION_PCT = parseFloat(process.env.MAX_CONCENTRATION_PCT || '0.20'); // 单股最大集中度 20%
const CASH_BUFFER_PCT = parseFloat(process.env.CASH_BUFFER_PCT || '0.15'); // 现金安全缓冲底线 15%
const MOCK_TRADING_MODE = () => process.env.MOCK_TRADING_MODE !== 'false'; // 动态读取以适配即时修改

/**
 * 统一获取账户资产（根据模式自动路由到沙盒或实盘）
 */
export async function getUnifiedPortfolio() {
  if (MOCK_TRADING_MODE()) {
    return getPortfolio();
  } else {
    try {
      const { cash } = await getAccountBalances();
      const positions = await getActivePositions();
      const posValue = positions.reduce((sum, p) => sum + p.market_value, 0);
      const totalEquity = cash + posValue;
      const pnl = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
      
      return {
        cash,
        initial_deposit: 0, // 实盘不计初始投入
        positions_value: posValue,
        total_equity: totalEquity,
        unrealized_pnl: pnl
      };
    } catch (error) {
      console.error('[实盘资产获取失败] 调用长桥 API 异常:', error.message);
      // 容错返回空资产结构
      return { cash: 0, initial_deposit: 0, positions_value: 0, total_equity: 0, unrealized_pnl: 0, error: error.message };
    }
  }
}

/**
 * 统一获取持仓明细（根据模式自动路由到沙盒或实盘）
 */
export async function getUnifiedPositions() {
  if (MOCK_TRADING_MODE()) {
    return getPositions();
  } else {
    try {
      return await getActivePositions();
    } catch (error) {
      console.error('[实盘持仓获取失败] 调用长桥 API 异常:', error.message);
      return [];
    }
  }
}

/**
 * 校验风控规则
 * @returns {Promise<{ allowed: boolean, reason?: string, quantity?: number }>}
 */
export async function validateRiskLimits({ ticker, action, price, requestedQuantity, stopLoss }) {
  // 基本输入校验
  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return { allowed: false, reason: '风控拦截：股票代码无效' };
  }
  if (action !== 'BUY' && action !== 'SELL') {
    return { allowed: false, reason: `风控拦截：不支持的交易动作 "${action}"，仅支持 BUY/SELL` };
  }
  if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return { allowed: false, reason: `风控拦截：委托价格无效 ($${price})，价格必须为正数` };
  }
  if (typeof requestedQuantity !== 'number' || requestedQuantity <= 0 || !Number.isInteger(requestedQuantity)) {
    return { allowed: false, reason: `风控拦截：委托股数无效 (${requestedQuantity})，股数必须为正整数` };
  }
  if (stopLoss !== null && stopLoss !== undefined) {
    if (typeof stopLoss !== 'number' || stopLoss <= 0 || !isFinite(stopLoss)) {
      return { allowed: false, reason: `风控拦截：止损价格无效 ($${stopLoss})` };
    }
  }

  // 实盘与模拟统一调用当前生效的资产总览
  const portfolio = await getUnifiedPortfolio();
  const totalEquity = portfolio.total_equity;
  const availableCash = portfolio.cash;

  // 1. 现金安全垫检查 (Cash Buffer Check) - 仅限买入
  if (action === 'BUY') {
    const cashReserveRequired = totalEquity * CASH_BUFFER_PCT;
    const proposedCost = price * requestedQuantity;
    if (availableCash - proposedCost < cashReserveRequired) {
      return { 
        allowed: false, 
        reason: `风控拦截：现金不足。需保留现金垫 $${cashReserveRequired.toFixed(2)}，当前现金 $${availableCash.toFixed(2)}，交易所需 $${proposedCost.toFixed(2)}` 
      };
    }
  }

  // 2. 单股集中度检查 (Concentration Check) - 仅限买入
  if (action === 'BUY') {
    const positions = await getUnifiedPositions();
    const existingPosition = positions.find(pos => pos.ticker === ticker);
    const existingValue = existingPosition ? existingPosition.market_value : 0;
    const proposedCost = price * requestedQuantity;
    const maxAllowedValue = totalEquity * MAX_CONCENTRATION_PCT;

    if (existingValue + proposedCost > maxAllowedValue) {
      return { 
        allowed: false, 
        reason: `风控拦截：单股持仓超标。${ticker} 最大持仓额 $${maxAllowedValue.toFixed(2)} (占总资产 ${MAX_CONCENTRATION_PCT*100}%)，买入后将达 $${(existingValue + proposedCost).toFixed(2)}` 
      };
    }
  }

  // 3. 卖出持仓足额检查 (Short-selling check) - 仅限卖出
  if (action === 'SELL') {
    const positions = await getUnifiedPositions();
    const existingPosition = positions.find(pos => pos.ticker === ticker);
    if (!existingPosition) {
      return { 
        allowed: false, 
        reason: `交易拦截：无持仓。企图卖出 ${ticker} ${requestedQuantity} 股，当前未持有该股票` 
      };
    }
    if (existingPosition.quantity < requestedQuantity) {
      return { 
        allowed: false, 
        reason: `交易拦截：可用持仓不足。企图卖出 ${ticker} ${requestedQuantity} 股，当前仅持有 ${existingPosition.quantity} 股` 
      };
    }
  }

  // 4. 单笔最大亏损重算 (ATR/Stop Loss Risk Sizing)
  if (action === 'BUY' && stopLoss && stopLoss < price) {
    const maxLossAllowed = totalEquity * RISK_PER_TRADE_PCT;
    const lossPerShare = price - stopLoss;
    const calculatedQty = Math.floor(maxLossAllowed / lossPerShare);
    
    if (calculatedQty < requestedQuantity) {
      console.log(`[风控触发] 单笔亏损限制。根据止损位 ${stopLoss}，最大亏损上限为 $${maxLossAllowed.toFixed(2)}，建议买入股数由 ${requestedQuantity} 降为 ${calculatedQty}`);
      return { 
        allowed: true, 
        quantity: Math.max(calculatedQty, 1) // 至少买 1 股
      };
    }
  }

  return { allowed: true, quantity: requestedQuantity };
}

/**
 * 执行跟单指令
 * 支持沙盒模拟(Paper Trading)和实盘接口对接(Live Trading)
 */
export async function executeOrder({ ticker, action, price, quantity, stopLoss, reason = '' }) {
  const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  console.log(`[交易引擎] 收到跟单信号: [${action}] ${ticker} | 价格: $${price} | 股数: ${quantity}`);

  // 1. 进行风控与合规校验
  const riskResult = await validateRiskLimits({ ticker, action, price, requestedQuantity: quantity, stopLoss });
  
  if (!riskResult.allowed) {
    console.warn(`[交易失败] 订单被风控拦截: ${riskResult.reason}`);
    
    // 保存被拒订单到数据库
    saveOrder({
      id: orderId,
      ticker,
      action,
      price,
      quantity,
      status: 'REJECTED',
      created_at: Date.now(),
      reason: riskResult.reason
    });

    // 推送风控报警
    await pushTradeAlertToWeChat({
      orderId,
      ticker,
      action,
      price,
      quantity,
      status: 'REJECTED',
      reason: riskResult.reason
    });

    return { success: false, reason: riskResult.reason };
  }

  // 使用风控引擎修正后的股数
  const finalQty = riskResult.quantity !== undefined ? riskResult.quantity : quantity;

  if (MOCK_TRADING_MODE()) {
    // ==========================================
    // 模式 A: 沙盒模拟交易 (Paper Trading Sandbox)
    // ==========================================
    const portfolio = getPortfolio();
    const positions = getPositions();
    const existingPos = positions.find(p => p.ticker === ticker);

    if (action === 'BUY') {
      // 扣减虚拟资金
      const cost = price * finalQty;
      updatePortfolioCash(portfolio.cash - cost);

      // 建立/更新持仓
      const newQty = (existingPos ? existingPos.quantity : 0) + finalQty;
      const totalCost = (existingPos ? existingPos.quantity * existingPos.average_entry_price : 0) + cost;
      const avgPrice = totalCost / newQty;

      savePosition({
        ticker,
        quantity: newQty,
        average_entry_price: avgPrice,
        current_price: price,
        market_value: newQty * price,
        unrealized_pnl: (price - avgPrice) * newQty
      });

    } else if (action === 'SELL') {
      // 增加虚拟资金
      const revenue = price * finalQty;
      updatePortfolioCash(portfolio.cash + revenue);

      // 扣减/清除持仓
      const newQty = existingPos.quantity - finalQty;
      const avgPrice = existingPos.average_entry_price;

      savePosition({
        ticker,
        quantity: newQty,
        average_entry_price: avgPrice,
        current_price: price,
        market_value: newQty * price,
        unrealized_pnl: (price - avgPrice) * newQty
      });
    }

    // 保存成交订单到数据库
    saveOrder({
      id: orderId,
      ticker,
      action,
      price,
      quantity: finalQty,
      status: 'FILLED',
      created_at: Date.now(),
      reason: '沙盒模拟即时成交'
    });

    console.log(`[交易成功] 沙盒订单成交: ${action} ${ticker} ${finalQty}股 @ $${price}`);

    // 发送交易成功通知
    await pushTradeAlertToWeChat({
      orderId,
      ticker,
      action,
      price,
      quantity: finalQty,
      status: 'FILLED',
      reason: `沙盒模拟成交。备注原因: ${reason}`
    });

    return { success: true, orderId, mode: 'SANDBOX' };

  } else {
    // ==========================================
    // 模式 B: 券商实盘接口对接 (Longbridge 实盘)
    // ==========================================
    try {
      console.log(`[实盘交易] 正在调用长桥证券 API 执行订单...`);
      
      const order = await placeLongbridgeOrder({
        ticker,
        action,
        quantity: finalQty,
        price
      });

      // 保存实盘挂单状态到本地 SQLite 订单表中归档
      saveOrder({
        id: order.orderId,
        ticker,
        action,
        price,
        quantity: finalQty,
        status: 'PENDING',
        created_at: Date.now(),
        reason: '实盘委托已成功提交柜台'
      });

      // 发送提交成功通知
      await pushTradeAlertToWeChat({
        orderId: order.orderId,
        ticker,
        action,
        price,
        quantity: finalQty,
        status: 'PENDING',
        reason: `长桥实盘委托已提交。原因: ${reason}`
      });

      return { success: true, orderId: order.orderId, mode: 'LIVE' };
    } catch (apiError) {
      console.error('[实盘交易失败] 券商接口返回错误:', apiError);
      
      saveOrder({
        id: orderId,
        ticker,
        action,
        price,
        quantity: finalQty,
        status: 'REJECTED',
        created_at: Date.now(),
        reason: `长桥 API 报错: ${apiError.message}`
      });

      // 推送实盘交易失败报警
      await pushTradeAlertToWeChat({
        orderId,
        ticker,
        action,
        price,
        quantity: finalQty,
        status: 'REJECTED',
        reason: `长桥实盘下单失败: ${apiError.message}`
      });

      return { success: false, reason: apiError.message };
    }
  }
}

// 交易消息推送通知
async function pushTradeAlertToWeChat({ orderId, ticker, action, price, quantity, status, reason }) {
  const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = status === 'FILLED' ? '✅' : (status === 'PENDING' ? '⏳' : '🚨');
  let statusZh = '交易成功';
  if (status === 'PENDING') statusZh = '实盘排队中';
  if (status === 'REJECTED') statusZh = '风控拦截/失败';
  
  const text = `### ${emoji} 量化跟单交易通知
**订单编号**: \`${orderId}\`
**股票代码**: **${ticker}**
**交易动作**: <font color="${action === 'BUY' ? '#10b981' : '#ef4444'}">${action === 'BUY' ? '买入' : '卖出'}</font>
**委托单价**: $${price.toFixed(2)}
**委托数量**: ${quantity} 股
**交易金额**: $${(price * quantity).toFixed(2)}
**系统状态**: **${statusZh}**
**说明原因**: *${reason}*

---\n*可通过后台 Web 仪表盘查看实时持仓与资金变化。*`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content: text }
      })
    });
  } catch (err) {
    console.error('Failed to send trade alert to WeChat:', err);
  }
}

