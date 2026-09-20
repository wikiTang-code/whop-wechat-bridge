/**
 * tools/trade/position_lifecycle_manager.js
 * [REQ-053] 实战战术持仓动态生命周期状态机 (Position Dynamic Lifecycle Manager)
 * 
 * 核心设计:
 * 1. 落实 REQ-052 提纯出的赵哥真实三大核心战术:
 *    - TAC-001: 开盘 1/6 常规仓分批低吸 (Opening Fractional Scale-In)
 *    - TAC-002: 直线拉升半仓阶梯止盈 + 动态保本损 (Staggered Half Take-Profit)
 *    - TAC-003: 同标的高抛低吸差价加回做T (Intraday Gap Rebuy T)
 * 2. 纯计算与状态机引擎，支持内存维护与 SQLite 读写;
 * 3. 严格遵循资金隔离红线: 仅作为参谋推演与微观仓位状态机，不接入实盘下单。
 */

/**
 * 战术生命周期状态枚举
 */
export const TacticalState = {
  EMPTY: 'EMPTY',                   // 空仓
  INITIAL_PROBE: 'INITIAL_PROBE',   // 1/6 仓试探阶段
  SCALED_IN: 'SCALED_IN',           // 二次加仓完成
  HALF_LOCKED: 'HALF_LOCKED',       // 已出半仓锁利，剩余半仓保本损守候
  T_GAP_ACTIVE: 'T_GAP_ACTIVE',     // 已高抛卖出部分，等待低位加回做T
  CLOSED: 'CLOSED'                  // 全部平仓
};

/**
 * [REQ-055 审阅整改] 数据来源三层标注枚举
 * 彻底区分: 已审核成交(audited_fill) vs 口述纪律引用(zhao_quote) vs 启发式推演(heuristic)
 */
export const DataSourceType = {
  AUDITED_FILL: 'audited_fill',     // 来自人工已审核成交单
  ZHAO_QUOTE: 'zhao_quote',         // 来自大V口述发言/发言引用
  HEURISTIC: 'heuristic'            // 算法推演/默认参数 (严禁冒充真源)
};

/**
 * [TAC-000] 大V宏观资金分配总控模型 (启发式参考)
 * 来源: zhao_quote (大V多次口述 "股票堆满再一成或者融资买期权")
 * 正股压舱底（建议 80%~90%）+ 顶层一成/融资期权做杠杆爆破，严禁开局直接重仓期权
 */
export const CapitalAllocationModel = {
  STRATEGY_NAME: 'EQUITY_CORE_THEN_OPTION_BOOSTER',
  EQUITY_TARGET_RATIO: 0.85,        // 启发式建议正股占比 (85%~90%)
  OPTION_MAX_RATIO: 0.10,          // 口述纪律: 股票堆满后再配最多一成 (10%) 期权或融资
  SOURCE: DataSourceType.ZHAO_QUOTE,
  DESCRIPTION: '【启发式口述参考】股票堆满再一成或者融资买期权。正股负责吃稳大波段与分时做T，期权仅作为尾部小仓位非线性加速器。'
};

/**
 * 计算大盘总控资金配置建议 (启发式推演)
 */
export function evaluateCapitalAllocation(currentEquityValue, currentCash, currentOptionValue = 0) {
  const totalNetAsset = currentEquityValue + currentCash + currentOptionValue;
  const equityRatio = totalNetAsset > 0 ? (currentEquityValue / totalNetAsset) : 0;
  const optionRatio = totalNetAsset > 0 ? (currentOptionValue / totalNetAsset) : 0;
  const cashRatio = totalNetAsset > 0 ? (currentCash / totalNetAsset) : 0;

  let advice = '';
  let status = 'BALANCED';

  if (equityRatio < 0.80) {
    status = 'EQUITY_UNDERWEIGHT';
    advice = `【正股未满仓】当前股票仓位 ${(equityRatio * 100).toFixed(1)}% < 80%，大V口述建议“股票堆满再考虑期权”，当前阶段严禁大买期权，主力资金宜聚焦高贝塔正股/2x战车分批低吸！`;
  } else if (optionRatio > 0.12) {
    status = 'OPTION_OVERWEIGHT';
    advice = `【期权超配预警】期权持仓占比 ${(optionRatio * 100).toFixed(1)}% 超过一成，违背“股票堆满后仅用一成或融资轻度参与期权”纪律，极易遭遇时间价值归零杀伤，建议减持期权锁定利润！`;
  } else {
    status = 'OPTIMAL';
    advice = `【最优配比】股票已堆满 (${(equityRatio * 100).toFixed(1)}%)，期权处于轻度进攻位 (${(optionRatio * 100).toFixed(1)}% ≤ 10%)，符合大V口述攻守矩阵。`;
  }

  return {
    strategy: CapitalAllocationModel.STRATEGY_NAME,
    totalNetAsset,
    equityRatio,
    optionRatio,
    cashRatio,
    status,
    advice,
    source: DataSourceType.HEURISTIC,
    isBrokerReconciled: false,
    disclaimer: '【启发式推演 · 非券商实盘对账】基于口述纪律估算，不代表券商真实持仓'
  };
}

/**
 * 创建空白标的推演持仓状态
 */
export function createEmptyPosition(ticker, source = DataSourceType.HEURISTIC) {
  return {
    ticker: ticker.toUpperCase(),
    quantity: 0,
    avgCost: 0,
    realizedPnl: 0,
    breakevenStop: null,     // 保本止损线 (启发式推演)
    hardStopLoss: null,      // 硬止损线 (-5% 启发式规则)
    tacticalState: TacticalState.EMPTY,
    lastSellRecord: null,    // 最近一笔卖出单 (供做T差价对比)
    history: [],             // 事件流水
    source: source,          // 默认为 heuristic
    sources: {
      avgCost: source,
      breakevenStop: DataSourceType.HEURISTIC,
      hardStopLoss: DataSourceType.HEURISTIC,
      tacticalState: DataSourceType.HEURISTIC
    }
  };
}

/**
 * 内存全局持仓注册表 (供 HUD 实时读取与参谋展示)
 */
const globalPositions = new Map();

export function getOrCreatePosition(ticker) {
  const sym = ticker.toUpperCase();
  if (!globalPositions.has(sym)) {
    globalPositions.set(sym, createEmptyPosition(sym));
  }
  return globalPositions.get(sym);
}

export function getAllActivePositions() {
  const result = [];
  for (const [ticker, pos] of globalPositions.entries()) {
    result.push(pos);
  }
  return result;
}

/**
 * 解析大V原话中的战术意图与动作
 */
export function parseTacticalIntent(text, defaultPrice = 0) {
  const content = String(text || '').trim();
  let actionType = 'UNKNOWN';
  let fraction = 1.0;
  let price = defaultPrice;
  let referencePrice = null;

  // 1. 识别做T加回 (如: 422加回433卖出的wdc)
  const gapRebuyMatch = content.match(/(\d+(?:\.\d+)?)\s*加回\s*(\d+(?:\.\d+)?)\s*(?:卖出|出掉)?/);
  if (gapRebuyMatch || /加回/i.test(content)) {
    actionType = 'GAP_REBUY_T';
    if (gapRebuyMatch) {
      price = parseFloat(gapRebuyMatch[1]);
      referencePrice = parseFloat(gapRebuyMatch[2]);
    }
    return { actionType, price, referencePrice, rawText: content };
  }

  // 2. 识别阶梯半仓止盈 (如: 37.1出一半34.95的oklo / 45.6出掉41.85一半的iren)
  const halfSellMatch = content.match(/(\d+(?:\.\d+)?)\s*(?:出掉|出)\s*(\d+(?:\.\d+)?)\s*(?:的|剩下一半|一半)/);
  if (halfSellMatch || /出一半|出掉.*一半|剩下一半/i.test(content)) {
    actionType = 'HALF_TAKE_PROFIT';
    fraction = 0.5;
    if (halfSellMatch) {
      price = parseFloat(halfSellMatch[1]);
      referencePrice = parseFloat(halfSellMatch[2]);
    }
    return { actionType, fraction, price, referencePrice, rawText: content };
  }

  // 3. 识别分批建仓 (如: 211.4加了6分之一常规仓nbis / 加了1/6)
  const scaleInMatch = content.match(/(?:6分之一|1\/6|常规仓)/);
  if (scaleInMatch || /加了|买入|建仓|低吸/i.test(content)) {
    actionType = 'FRACTIONAL_BUY';
    fraction = scaleInMatch ? (1 / 6) : 0.2; // 默认 1/6
    const pxMatch = content.match(/(\d+(?:\.\d+)?)/);
    if (pxMatch && price === 0) {
      price = parseFloat(pxMatch[1]);
    }
    return { actionType, fraction, price, rawText: content };
  }

  // 4. 全平/止损
  if (/清仓|全出|止损|割肉|走人/i.test(content)) {
    actionType = 'FULL_CLOSE';
    return { actionType, fraction: 1.0, price, rawText: content };
  }

  return { actionType, fraction, price, rawText: content };
}

/**
 * 核心状态机推演引擎
 * 接收当前持仓对象与战术动作，返回推演后的新持仓与执行摘要
 */
export function transitionPositionState(position, action) {
  const pos = JSON.parse(JSON.stringify(position)); // 深拷贝
  const { actionType, price, quantity = 100, fraction = 1.0, referencePrice = null, timestamp = Date.now() } = action;

  let eventSummary = '';

  switch (actionType) {
    case 'FRACTIONAL_BUY': {
      // 异动分批低吸/建仓 (不设固定死板百分比，以盘口异动为准；默认值仅供兼容推演)
      const buyQty = quantity;
      if (pos.quantity === 0) {
        // 初始异动试探仓
        pos.quantity = buyQty;
        pos.avgCost = price;
        pos.tacticalState = TacticalState.INITIAL_PROBE;
        pos.hardStopLoss = action.stopLoss || Number((price * 0.95).toFixed(2)); // 兼容回退，实盘以盘口为准
        pos.breakevenStop = null;
        eventSummary = `【盘口异动 · 分批建仓】买入 ${buyQty} 股 @ $${price}，等待盘口异动与共振态势`;
      } else {
        // 异动分批加仓，动态平摊持仓均价
        const totalCost = pos.quantity * pos.avgCost + buyQty * price;
        pos.quantity += buyQty;
        pos.avgCost = Number((totalCost / pos.quantity).toFixed(2));
        pos.tacticalState = TacticalState.SCALED_IN;
        pos.hardStopLoss = action.stopLoss || Number((pos.avgCost * 0.95).toFixed(2));
        eventSummary = `【盘口异动 · 分批加仓】加仓 ${buyQty} 股 @ $${price}，综合成本动态调整为 $${pos.avgCost}`;
      }
      break;
    }

    case 'HALF_TAKE_PROFIT': {
      // 脉冲拉升分批止盈/减仓
      if (pos.quantity <= 0) {
        eventSummary = `【跳过】当前标的无底仓，无法执行分批减仓`;
        break;
      }
      const sellQty = Math.floor(pos.quantity * (fraction || 0.5));
      const pnl = Number(((price - pos.avgCost) * sellQty).toFixed(2));
      pos.realizedPnl += pnl;
      pos.quantity -= sellQty;
      
      // 核心原则: 分批出掉后，若有底仓，以成本价作为保本心理锚点，不设死板止损
      pos.breakevenStop = pos.avgCost;
      pos.hardStopLoss = pos.avgCost;
      pos.tacticalState = TacticalState.HALF_LOCKED;
      pos.lastSellRecord = { price, quantity: sellQty, timestamp };

      eventSummary = `【脉冲异动 · 分批止盈】卖出 ${sellQty} 股 @ $${price}，锁定利润 $${pnl}；剩余 ${pos.quantity} 股以均价 $${pos.avgCost} 为保本锚点`;
      break;
    }

    case 'GAP_REBUY_T': {
      // TAC-003: 同标的高抛低吸差价加回做T
      const rebuyQty = quantity;
      const refPx = referencePrice || (pos.lastSellRecord ? pos.lastSellRecord.price : null);
      
      if (refPx && refPx > price) {
        // 成功吃到做T差价
        const gapGain = Number(((refPx - price) * rebuyQty).toFixed(2));
        const gapPct = (((refPx - price) / refPx) * 100).toFixed(1);
        
        // 用做T利润摊薄原有底仓成本
        const prevTotalValue = pos.quantity * pos.avgCost;
        const newTotalQty = pos.quantity + rebuyQty;
        // 综合成本 = (旧总投入 + 本次买入 - 做T赚取的差价) / 新总股数
        const adjustedCost = Number(((prevTotalValue + rebuyQty * price - gapGain) / newTotalQty).toFixed(2));
        
        pos.quantity = newTotalQty;
        pos.avgCost = adjustedCost;
        pos.realizedPnl += gapGain;
        pos.tacticalState = TacticalState.SCALED_IN;
        eventSummary = `【TAC-003 差价加回做T】在 $${price} 加回 (对比卖出价 $${refPx}，差价 +${gapPct}%)，底仓成本摊薄至 $${pos.avgCost}，做T增量现金流 $${gapGain}`;
      } else {
        // 无高抛参考价或追高加回，按普通加仓处理
        const totalCost = pos.quantity * pos.avgCost + rebuyQty * price;
        pos.quantity += rebuyQty;
        pos.avgCost = Number((totalCost / pos.quantity).toFixed(2));
        pos.tacticalState = TacticalState.SCALED_IN;
        eventSummary = `【TAC-003 加回】加回 ${rebuyQty} 股 @ $${price}，综合成本调整为 $${pos.avgCost}`;
      }
      break;
    }

    case 'FULL_CLOSE': {
      // 全部清仓
      if (pos.quantity <= 0) break;
      const pnl = Number(((price - pos.avgCost) * pos.quantity).toFixed(2));
      pos.realizedPnl += pnl;
      eventSummary = `【全部清仓】以 $${price} 平仓剩余 ${pos.quantity} 股，本次平仓收益 $${pnl}，累计总已实现盈亏 $${pos.realizedPnl}`;
      pos.quantity = 0;
      pos.avgCost = 0;
      pos.breakevenStop = null;
      pos.hardStopLoss = null;
      pos.tacticalState = TacticalState.CLOSED;
      break;
    }

    default:
      eventSummary = `【未识别动作】${actionType}`;
  }

  pos.history.push({
    actionType,
    price,
    timestamp,
    summary: eventSummary,
    resultingQty: pos.quantity,
    resultingCost: pos.avgCost,
    resultingState: pos.tacticalState
  });

  return {
    updatedPosition: pos,
    summary: eventSummary
  };
}
