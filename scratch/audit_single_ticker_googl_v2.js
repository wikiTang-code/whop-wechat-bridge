import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 谷歌A (GOOGL) 优化版规则单标的持仓与收益全景演算');
console.log('====================================================\n');

// 1. 获取【历史股票期权记录区】关于 GOOGL 的所有历史消息
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%谷歌%' OR content LIKE '%googl%' OR content LIKE '%goog%')
  ORDER BY created_at ASC
`).all();

// 2. 资金模型配置
const INITIAL_ACCOUNT_EQUITY = 90000.00; // 初始总资金 $90,000
const MAX_TARGET_COUNT = 10;            // 最大规划持有 10 支标的
let currentCash = INITIAL_ACCOUNT_EQUITY; // 当前可用现金

// 标的持仓状态
let holdingLots = []; // 每笔买入 lot: { price, quantity, investAmount, fractionName, timestamp }
let totalRealizedPnL = 0; // 累计已实现盈亏 ($)

console.log(`| # | 北京时间 | 赵哥原始发言 | 交易意图 | 识别点位 | 仓位份额 | 交易股数(整数) | 交易金额 | 剩余持仓与仓位折算 | 标的已实现收益 | 账户可用现金 |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|`);

let idx = 1;

for (const m of msgs) {
  const content = m.content.replace(/\[IMAGE:.*?\]/gi, '').trim();
  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const beijingTime = new Date(timeMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 意图识别
  const isSell = /(出|卖|止损|止盈|清仓|减半|出一半)/.test(content);
  const isBuy = /(买|加|接|开仓|拿一点|进)/.test(content) && !isSell;

  // 点位提取
  let price = null;
  const priceMatches = content.match(/\b([1-9]\d{1,3}(\.\d+)?)\b/g);
  if (priceMatches) {
    for (const p of priceMatches) {
      const pVal = parseFloat(p);
      if (pVal >= 100 && pVal <= 400) {
        price = pVal;
        break;
      }
    }
  }

  // 比例识别
  let fractionName = '1/3 常规仓';
  let fractionRatio = 1 / 3;

  if (/6分之一|1\/6/.test(content)) {
    fractionName = '1/6 常规仓';
    fractionRatio = 1 / 6;
  } else if (/出一半|出半|减半|1\/2|半份|半仓/.test(content)) {
    fractionName = '出 50% 仓位';
    fractionRatio = 1 / 2;
  } else if (/1\/3|三分之一/.test(content)) {
    fractionName = '1/3 常规仓';
    fractionRatio = 1 / 3;
  } else if (/买满|满仓|全部/.test(content)) {
    fractionName = '满仓 (1个常规仓)';
    fractionRatio = 1.0;
  }

  // 计算当前总资产 = 现金 + 持仓估值
  const currentPosValue = holdingLots.reduce((sum, lot) => sum + lot.quantity * (price || lot.price), 0);
  const totalEquity = currentCash + currentPosValue;
  
  // 单标的当前常规仓总金额 = 总资产 / 10
  const standardLotCapital = totalEquity / MAX_TARGET_COUNT;

  let tradeQty = 0;
  let tradeAmount = 0;
  let actionText = '⚪ 讨论/观点';
  let thisRealizedPnL = 0;

  if (isBuy && price) {
    actionText = '🟢 买入建仓';
    const targetInvest = standardLotCapital * fractionRatio;
    // 向下取整，确保整数股数
    tradeQty = Math.max(1, Math.floor(targetInvest / price));
    tradeAmount = +(tradeQty * price).toFixed(2);
    currentCash -= tradeAmount;

    holdingLots.push({
      price,
      quantity: tradeQty,
      investAmount: tradeAmount,
      fractionName,
      timestamp: timeMs
    });
  } else if (isSell && holdingLots.length > 0) {
    actionText = '🔴 卖出平仓';
    const totalHoldingQty = holdingLots.reduce((sum, l) => sum + l.quantity, 0);
    
    if (fractionRatio === 0.5) {
      tradeQty = Math.max(1, Math.floor(totalHoldingQty * 0.5));
    } else if (price) {
      const targetInvest = standardLotCapital * fractionRatio;
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(targetInvest / price)));
    } else {
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(totalHoldingQty * fractionRatio)));
    }

    const sellPrice = price || (holdingLots[0].price * 1.05);
    tradeAmount = +(tradeQty * sellPrice).toFixed(2);
    currentCash += tradeAmount;

    // FIFO / 匹配扣减持仓 Lots 并计算已实现盈亏
    let remainingToSell = tradeQty;
    while (remainingToSell > 0 && holdingLots.length > 0) {
      const lot = holdingLots[0];
      if (lot.quantity <= remainingToSell) {
        thisRealizedPnL += (sellPrice - lot.price) * lot.quantity;
        remainingToSell -= lot.quantity;
        holdingLots.shift();
      } else {
        thisRealizedPnL += (sellPrice - lot.price) * remainingToSell;
        lot.quantity -= remainingToSell;
        lot.investAmount -= remainingToSell * lot.price;
        remainingToSell = 0;
      }
    }
    totalRealizedPnL += thisRealizedPnL;
  }

  // 计算当前剩余持仓与常规仓换算
  const curQty = holdingLots.reduce((sum, l) => sum + l.quantity, 0);
  const curPosVal = holdingLots.reduce((sum, l) => sum + l.quantity * (price || l.price), 0);
  const fractionOfStandardLot = (curPosVal / standardLotCapital);
  
  let holdingDesc = '0 股 (空仓)';
  if (curQty > 0) {
    let fracStr = '1/6 常规仓';
    if (fractionOfStandardLot >= 0.8) fracStr = '1个满常规仓';
    else if (fractionOfStandardLot >= 0.45) fracStr = '1/2 常规仓';
    else if (fractionOfStandardLot >= 0.28) fracStr = '1/3 常规仓';
    else if (fractionOfStandardLot >= 0.12) fracStr = '1/6 常规仓';
    else fracStr = `${(fractionOfStandardLot * 6).toFixed(1)}/6 常规仓`;

    holdingDesc = `**${curQty} 股** (约 ${fracStr}, 市值 $${curPosVal.toFixed(0)})`;
  }

  const cleanContent = content.replace(/\n/g, ' ').substring(0, 60);
  const pnlDisplay = totalRealizedPnL >= 0 ? `+$${totalRealizedPnL.toFixed(2)}` : `-$${Math.abs(totalRealizedPnL).toFixed(2)}`;

  if (actionText !== '⚪ 讨论/观点') {
    console.log(`| ${idx++} | ${beijingTime} | ${cleanContent} | ${actionText} | ${price ? '$' + price : '-'} | ${fractionName} | ${tradeQty > 0 ? tradeQty + ' 股' : '-'} | ${tradeAmount > 0 ? '$' + tradeAmount : '-'} | ${holdingDesc} | ${pnlDisplay} | $${currentCash.toFixed(0)} |`);
  }
}
