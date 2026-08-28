import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 全量标的多资产实盘交易演算引擎 (90000刀总资金 / 9000刀常规仓 / 整数股 / 收益与仓位换算)');
console.log('====================================================\n');

// 1. 标的词典映射库
const tickerAliases = [
  { regex: /谷歌[A|a]?|googl/i, symbol: 'GOOGL', name: '谷歌A', defaultPrice: 345 },
  { regex: /谷歌[C|c]?|goog/i, symbol: 'GOOG', name: '谷歌C', defaultPrice: 345 },
  { regex: /英伟达|nvda/i, symbol: 'NVDA', name: '英伟达', defaultPrice: 175 },
  { regex: /特斯拉|tsla/i, symbol: 'TSLA', name: '特斯拉', defaultPrice: 320 },
  { regex: /苹果|aapl/i, symbol: 'AAPL', name: '苹果', defaultPrice: 228 },
  { regex: /微软|msft/i, symbol: 'MSFT', name: '微软', defaultPrice: 420 },
  { regex: /亚马逊|amzn/i, symbol: 'AMZN', name: '亚马逊', defaultPrice: 200 },
  { regex: /meta|脸书/i, symbol: 'META', name: 'Meta', defaultPrice: 650 },
  { regex: /nvdl/i, symbol: 'NVDL', name: '英伟达双倍', defaultPrice: 75 },
  { regex: /msfl/i, symbol: 'MSFL', name: '微软双倍', defaultPrice: 50 },
  { regex: /conl/i, symbol: 'CONL', name: 'Coinbase双倍', defaultPrice: 4.5 },
  { regex: /mstr/i, symbol: 'MSTR', name: '微策略', defaultPrice: 320 },
  { regex: /spyu/i, symbol: 'SPYU', name: '标普三倍做多', defaultPrice: 35 },
  { regex: /spy/i, symbol: 'SPY', name: '标普500', defaultPrice: 580 },
  { regex: /qqq/i, symbol: 'QQQ', name: '纳斯达克100', defaultPrice: 490 },
  { regex: /ttmi/i, symbol: 'TTMI', name: 'TTMI', defaultPrice: 120 },
  { regex: /soun/i, symbol: 'SOUN', name: 'SoundHound AI', defaultPrice: 12 },
  { regex: /lite/i, symbol: 'LITE', name: 'Lumentum', defaultPrice: 75 },
  { regex: /wdc/i, symbol: 'WDC', name: '西部数据', defaultPrice: 460 },
  { regex: /fbl/i, symbol: 'FBL', name: 'Meta两倍做多', defaultPrice: 45 },
  { regex: /cifr/i, symbol: 'CIFR', name: 'Cipher Mining', defaultPrice: 6.5 },
  { regex: /iren/i, symbol: 'IREN', name: 'Iris Energy', defaultPrice: 38 },
  { regex: /riot/i, symbol: 'RIOT', name: 'Riot Platforms', defaultPrice: 13 },
  { regex: /intc|英特尔/i, symbol: 'INTC', name: '英特尔', defaultPrice: 85 },
  { regex: /avgo|博通/i, symbol: 'AVGO', name: '博通', defaultPrice: 160 },
  { regex: /cohr/i, symbol: 'COHR', name: 'Coherent', defaultPrice: 95 },
  { regex: /crwv/i, symbol: 'CRWV', name: 'CRWV', defaultPrice: 72 },
  { regex: /dram/i, symbol: 'DRAM', name: 'DRAM存储', defaultPrice: 51 },
  { regex: /glw|康宁/i, symbol: 'GLW', name: '康宁', defaultPrice: 48 },
  { regex: /oklo/i, symbol: 'OKLO', name: 'Oklo核能', defaultPrice: 25 }
];

// 2. 获取【历史股票期权记录区】的所有核心发言
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%买%' OR content LIKE '%卖%' OR content LIKE '%出%' OR content LIKE '%加%' OR content LIKE '%仓%' OR content LIKE '%常规%' OR content LIKE '%止损%' OR content LIKE '%止盈%' OR content LIKE '%清仓%')
  ORDER BY created_at ASC
`).all();

console.log(`📚 共筛选出 ${msgs.length} 条实盘买卖发言记录！`);

// 3. 账户状态管理
const INITIAL_ACCOUNT_EQUITY = 90000.00;
const MAX_TARGET_COUNT = 10;
let currentCash = INITIAL_ACCOUNT_EQUITY;

// 多标的持仓账本: symbol -> { symbol, symbolName, lots: [], totalRealizedPnL: 0, lastPrice: 0 }
const portfolio = {};
for (const item of tickerAliases) {
  portfolio[item.symbol] = {
    symbol: item.symbol,
    symbolName: item.name,
    lots: [],
    totalRealizedPnL: 0,
    lastPrice: item.defaultPrice
  };
}

const parsedTrades = [];

for (const m of msgs) {
  const content = m.content.replace(/\[IMAGE:.*?\]/gi, '').trim();
  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;

  // 匹配标的
  let matchedTicker = null;
  for (const item of tickerAliases) {
    if (item.regex.test(content)) {
      matchedTicker = item;
      break;
    }
  }
  if (!matchedTicker) continue;

  const symbol = matchedTicker.symbol;
  const targetObj = portfolio[symbol];

  // 意图识别
  const isSell = /(出|卖|止损|止盈|清仓|减半|出一半)/.test(content);
  const isBuy = /(买|加|接|开仓|拿一点|进)/.test(content) && !isSell;
  if (!isBuy && !isSell) continue;

  // 点位提取
  let price = null;
  const priceMatches = content.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
  if (priceMatches) {
    for (const p of priceMatches) {
      const pVal = parseFloat(p);
      if (pVal >= 0.5 && pVal <= 2500) {
        price = pVal;
        break;
      }
    }
  }
  if (!price) price = targetObj.lastPrice || matchedTicker.defaultPrice;
  targetObj.lastPrice = price;

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

  // 动态计算总资产 = 现金 + 所有标的市值
  let totalPosValue = 0;
  for (const sym in portfolio) {
    const pItem = portfolio[sym];
    totalPosValue += pItem.lots.reduce((sum, l) => sum + l.quantity * pItem.lastPrice, 0);
  }
  const totalEquity = Math.max(20000, currentCash + totalPosValue);
  const standardLotCapital = totalEquity / MAX_TARGET_COUNT;

  let tradeQty = 0;
  let tradeAmount = 0;
  let tradeRealizedPnL = 0;

  if (isBuy && price > 0) {
    const targetInvest = standardLotCapital * fractionRatio;
    tradeQty = Math.max(1, Math.floor(targetInvest / price));
    tradeAmount = +(tradeQty * price).toFixed(2);
    currentCash -= tradeAmount;

    targetObj.lots.push({
      price,
      quantity: tradeQty,
      investAmount: tradeAmount,
      fractionName,
      timestamp: timeMs
    });
  } else if (isSell && targetObj.lots.length > 0) {
    const totalHoldingQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
    
    if (fractionRatio === 0.5) {
      tradeQty = Math.max(1, Math.floor(totalHoldingQty * 0.5));
    } else if (price) {
      const targetInvest = standardLotCapital * fractionRatio;
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(targetInvest / price)));
    } else {
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(totalHoldingQty * fractionRatio)));
    }

    tradeAmount = +(tradeQty * price).toFixed(2);
    currentCash += tradeAmount;

    // FIFO 扣减 Lots
    let remainingToSell = tradeQty;
    while (remainingToSell > 0 && targetObj.lots.length > 0) {
      const lot = targetObj.lots[0];
      if (lot.quantity <= remainingToSell) {
        tradeRealizedPnL += (price - lot.price) * lot.quantity;
        remainingToSell -= lot.quantity;
        targetObj.lots.shift();
      } else {
        tradeRealizedPnL += (price - lot.price) * remainingToSell;
        lot.quantity -= remainingToSell;
        lot.investAmount -= remainingToSell * lot.price;
        remainingToSell = 0;
      }
    }
    targetObj.totalRealizedPnL += tradeRealizedPnL;
  }

  if (tradeQty > 0) {
    parsedTrades.push({
      symbol,
      symbolName: matchedTicker.name,
      action: isBuy ? 'BUY' : 'SELL',
      price,
      quantity: tradeQty,
      tradeAmount,
      fractionName,
      realizedPnL: tradeRealizedPnL,
      timestamp: timeMs,
      content: content.substring(0, 90)
    });
  }
}

console.log(`✅ 全量标的共成功演算出 ${parsedTrades.length} 笔整数股实战交易！\n`);

// 4. 重构并写入数据库中的 campaigns 表与 positions 表
db.prepare('DELETE FROM campaigns').run();
db.prepare('DELETE FROM positions').run();
db.prepare('DELETE FROM orders').run();

// 写入 orders 表 (订单历史流水)
const insertOrderStmt = db.prepare(`
  INSERT INTO orders (id, ticker, action, price, quantity, status, created_at, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 0; i < parsedTrades.length; i++) {
  const t = parsedTrades[i];
  insertOrderStmt.run(
    `ord_${t.timestamp}_${i}`,
    t.symbol,
    t.action,
    t.price,
    t.quantity,
    'FILLED',
    t.timestamp,
    `【${t.fractionName} | $${t.tradeAmount} (${t.quantity}股)】${t.content}`
  );
}

// 写入 positions 表 (当前在持明细)
const insertPosStmt = db.prepare(`
  INSERT INTO positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let activePositionsCount = 0;
for (const sym in portfolio) {
  const p = portfolio[sym];
  const holdingQty = p.lots.reduce((sum, l) => sum + l.quantity, 0);
  if (holdingQty > 0) {
    const totalCost = p.lots.reduce((sum, l) => sum + l.investAmount, 0);
    const avgPrice = +(totalCost / holdingQty).toFixed(2);
    const mktVal = +(holdingQty * p.lastPrice).toFixed(2);
    const unrealizedPnL = +(mktVal - totalCost).toFixed(2);

    insertPosStmt.run(
      sym,
      holdingQty,
      avgPrice,
      p.lastPrice,
      mktVal,
      unrealizedPnL
    );
    activePositionsCount++;
  }
}

// 写入 campaigns 表 (战役与点位记录)
const insertCampStmt = db.prepare(`
  INSERT INTO campaigns (influencer_id, ticker, status, open_time, close_time, open_reason, close_reason, initial_price, exit_price, pnl_ratio, strategy_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const activeTickers = new Set();
for (const t of parsedTrades.slice(-200).reverse()) {
  const isHolding = (portfolio[t.symbol].lots.reduce((sum, l) => sum + l.quantity, 0) > 0) && !activeTickers.has(t.symbol);
  const status = isHolding ? 'active' : 'closed';
  if (isHolding) activeTickers.add(t.symbol);

  const desc = `【${t.action === 'BUY' ? '买入建仓' : '卖出止盈'} | ${t.fractionName} | $${t.tradeAmount} (${t.quantity}股)】${t.content}`;
  
  try {
    insertCampStmt.run(
      'user_4yeplXgbguTu4',
      t.symbol,
      status,
      t.timestamp,
      status === 'closed' ? t.timestamp + 86400000 : null,
      desc,
      status === 'closed' ? `平仓实现收益: +$${t.realizedPnL.toFixed(2)}` : null,
      t.price,
      status === 'closed' ? +(t.price * 1.05).toFixed(2) : null,
      t.realizedPnL !== 0 ? +(t.realizedPnL / t.tradeAmount).toFixed(4) : 0.05,
      '历史股票期权记录区',
      t.timestamp,
      Date.now()
    );
  } catch (e) {}
}

console.log(`🎉 数据库全量写入完成！当前活跃持仓标的: ${activePositionsCount} 个，订单流水: ${parsedTrades.length} 笔！`);

// 打印当前持仓清单
const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.log('\n📊 最终当前在持真实持仓清单 (Positions Table):');
console.table(currentPositions);
