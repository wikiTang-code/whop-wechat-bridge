import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 样板标的深度解剖：【谷歌A (GOOGL)】全量真实交割记录与持仓换算机制');
console.log('====================================================\n');

// 1. 获取【历史股票期权记录区】关于 GOOGL/谷歌 的所有历史原始消息
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%谷歌%' OR content LIKE '%googl%' OR content LIKE '%goog%')
  ORDER BY created_at ASC
`).all();

console.log(`📚 在【历史股票期权记录区】共找到 ${msgs.length} 条关于【谷歌】的原始发言记录！\n`);

// 2. 规则模型设定：
// 假设总资金: $10,000，规划最多持有 10 个标的
// 每个标的【常规仓 (Standard Lot)】总资金上限 = $1,000.00
const STANDARD_LOT_CAPITAL = 1000.00;

let currentHoldingQty = 0; // 当前持仓股数
let totalInvested = 0;     // 当前持仓总成本
let historyRecords = [];

for (const m of msgs) {
  const content = m.content.replace(/\[IMAGE:.*?\]/gi, '').trim();
  
  // 转换真实时间
  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const beijingTime = new Date(timeMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const usTime = new Date(timeMs).toLocaleString('en-US', { timeZone: 'America/New_York' });

  // 识别买卖方向
  const isSell = /(出|卖|止损|止盈|清仓|减半|出一半)/.test(content);
  const isBuy = /(买|加|接|开仓|拿一点|进)/.test(content) && !isSell;

  // 提取点位/价格
  let price = null;
  // 匹配类似 344.5, 343, 334 等价格
  const priceMatches = content.match(/\b([1-9]\d{1,3}(\.\d+)?)\b/g);
  if (priceMatches) {
    for (const p of priceMatches) {
      const pVal = parseFloat(p);
      if (pVal >= 100 && pVal <= 400) { // 谷歌合理价格区间
        price = pVal;
        break;
      }
    }
  }
  if (!price && priceMatches && priceMatches.length > 0) {
    price = parseFloat(priceMatches[0]);
  }

  // 识别常规仓比例
  let fractionName = '1/3 常规仓 (默认)';
  let fractionRatio = 1 / 3;

  if (/6分之一|1\/6/.test(content)) {
    fractionName = '1/6 常规仓';
    fractionRatio = 1 / 6;
  } else if (/出一半|出半|减半|1\/2|半份|半仓/.test(content)) {
    fractionName = '1/2 仓位 (半仓)';
    fractionRatio = 1 / 2;
  } else if (/1\/3|三分之一/.test(content)) {
    fractionName = '1/3 常规仓';
    fractionRatio = 1 / 3;
  } else if (/买满|满仓|全部/.test(content)) {
    fractionName = '满仓 (1个常规仓)';
    fractionRatio = 1.0;
  }

  // 计算交易金额与股数
  let tradeAmount = 0;
  let tradeQty = 0;

  if (isBuy && price) {
    tradeAmount = STANDARD_LOT_CAPITAL * fractionRatio;
    // 换算股数（允许小数股/精确股数，若必须整数则 Math.max(1, Math.round)）
    tradeQty = +(tradeAmount / price).toFixed(2);
    currentHoldingQty = +(currentHoldingQty + tradeQty).toFixed(2);
    totalInvested += tradeAmount;
  } else if (isSell) {
    if (fractionRatio === 0.5 && currentHoldingQty > 0) {
      tradeQty = +(currentHoldingQty * 0.5).toFixed(2);
    } else if (price) {
      tradeAmount = STANDARD_LOT_CAPITAL * fractionRatio;
      tradeQty = +(tradeAmount / price).toFixed(2);
    } else {
      tradeQty = +(currentHoldingQty * fractionRatio).toFixed(2);
    }
    currentHoldingQty = Math.max(0, +(currentHoldingQty - tradeQty).toFixed(2));
  }

  historyRecords.push({
    beijingTime,
    action: isBuy ? '🟢 买入' : (isSell ? '🔴 卖出' : '⚪ 观点/提及'),
    fractionName,
    price: price ? `$${price}` : '市价/未标明',
    tradeAmount: tradeAmount > 0 ? `$${tradeAmount.toFixed(2)}` : '-',
    tradeQty: tradeQty > 0 ? `${tradeQty} 股` : '-',
    holdingAfter: `${currentHoldingQty} 股`,
    content
  });
}

console.table(historyRecords.slice(0, 30));
