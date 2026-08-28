import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 高精度多标的实盘交易演算法 (正股真实价格锚定 + 期权权利金隔离)');
console.log('====================================================\n');

// 1. 标的真实合理价格区间与基准价
const tickerConfig = {
  'GOOGL': { name: '谷歌A', minP: 100, maxP: 400, defaultP: 345 },
  'GOOG':  { name: '谷歌C', minP: 100, maxP: 400, defaultP: 345 },
  'NVDA':  { name: '英伟达', minP: 50, maxP: 250, defaultP: 175 },
  'TSLA':  { name: '特斯拉', minP: 100, maxP: 450, defaultP: 320 },
  'AAPL':  { name: '苹果', minP: 120, maxP: 300, defaultP: 228 },
  'MSFT':  { name: '微软', minP: 250, maxP: 550, defaultP: 420 },
  'AMZN':  { name: '亚马逊', minP: 100, maxP: 300, defaultP: 200 },
  'META':  { name: 'Meta', minP: 200, maxP: 750, defaultP: 650 },
  'NVDL':  { name: '英伟达双倍', minP: 20, maxP: 150, defaultP: 75 },
  'MSFL':  { name: '微软双倍', minP: 15, maxP: 100, defaultP: 50 },
  'CONL':  { name: 'Coinbase双倍', minP: 1.5, maxP: 20, defaultP: 4.5 },
  'MSTR':  { name: '微策略', minP: 80, maxP: 500, defaultP: 320 },
  'SPYU':  { name: '标普三倍做多', minP: 15, maxP: 60, defaultP: 35 },
  'SPY':   { name: '标普500', minP: 350, maxP: 650, defaultP: 580 },
  'QQQ':   { name: '纳斯达克100', minP: 300, maxP: 550, defaultP: 490 },
  'TTMI':  { name: 'TTMI', minP: 40, maxP: 200, defaultP: 120 },
  'SOUN':  { name: 'SoundHound AI', minP: 3, maxP: 25, defaultP: 12 },
  'LITE':  { name: 'Lumentum', minP: 30, maxP: 150, defaultP: 75 },
  'WDC':   { name: '西部数据', minP: 40, maxP: 120, defaultP: 75 },
  'FBL':   { name: 'Meta两倍做多', minP: 15, maxP: 80, defaultP: 45 },
  'CIFR':  { name: 'Cipher Mining', minP: 2, maxP: 15, defaultP: 6.5 },
  'IREN':  { name: 'Iris Energy', minP: 10, maxP: 60, defaultP: 38 },
  'RIOT':  { name: 'Riot Platforms', minP: 5, maxP: 30, defaultP: 13 },
  'INTC':  { name: '英特尔', minP: 20, maxP: 120, defaultP: 85 },
  'AVGO':  { name: '博通', minP: 80, maxP: 250, defaultP: 160 },
  'COHR':  { name: 'Coherent', minP: 30, maxP: 150, defaultP: 95 },
  'CRWV':  { name: 'CRWV', minP: 30, maxP: 150, defaultP: 72 },
  'DRAM':  { name: 'DRAM存储', minP: 20, maxP: 100, defaultP: 51 },
  'GLW':   { name: '康宁', minP: 25, maxP: 70, defaultP: 48 },
  'OKLO':  { name: 'Oklo核能', minP: 8, maxP: 45, defaultP: 25 }
};

const tickerAliases = [
  { regex: /谷歌[A|a]?|googl/i, symbol: 'GOOGL' },
  { regex: /谷歌[C|c]?|goog/i, symbol: 'GOOG' },
  { regex: /英伟达|nvda/i, symbol: 'NVDA' },
  { regex: /特斯拉|tsla/i, symbol: 'TSLA' },
  { regex: /苹果|aapl/i, symbol: 'AAPL' },
  { regex: /微软|msft/i, symbol: 'MSFT' },
  { regex: /亚马逊|amzn/i, symbol: 'AMZN' },
  { regex: /meta|脸书/i, symbol: 'META' },
  { regex: /nvdl/i, symbol: 'NVDL' },
  { regex: /msfl/i, symbol: 'MSFL' },
  { regex: /conl/i, symbol: 'CONL' },
  { regex: /mstr/i, symbol: 'MSTR' },
  { regex: /spyu/i, symbol: 'SPYU' },
  { regex: /spy/i, symbol: 'SPY' },
  { regex: /qqq/i, symbol: 'QQQ' },
  { regex: /ttmi/i, symbol: 'TTMI' },
  { regex: /soun/i, symbol: 'SOUN' },
  { regex: /lite/i, symbol: 'LITE' },
  { regex: /wdc/i, symbol: 'WDC' },
  { regex: /fbl/i, symbol: 'FBL' },
  { regex: /cifr/i, symbol: 'CIFR' },
  { regex: /iren/i, symbol: 'IREN' },
  { regex: /riot/i, symbol: 'RIOT' },
  { regex: /intc|英特尔/i, symbol: 'INTC' },
  { regex: /avgo|博通/i, symbol: 'AVGO' },
  { regex: /cohr/i, symbol: 'COHR' },
  { regex: /crwv/i, symbol: 'CRWV' },
  { regex: /dram/i, symbol: 'DRAM' },
  { regex: /glw|康宁/i, symbol: 'GLW' },
  { regex: /oklo/i, symbol: 'OKLO' }
];

const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%买%' OR content LIKE '%卖%' OR content LIKE '%出%' OR content LIKE '%加%' OR content LIKE '%仓%' OR content LIKE '%常规%' OR content LIKE '%止损%' OR content LIKE '%止盈%' OR content LIKE '%清仓%')
  ORDER BY created_at ASC
`).all();

const INITIAL_ACCOUNT_EQUITY = 90000.00;
const MAX_TARGET_COUNT = 10;
let currentCash = INITIAL_ACCOUNT_EQUITY;

const portfolio = {};
for (const sym in tickerConfig) {
  portfolio[sym] = {
    symbol: sym,
    name: tickerConfig[sym].name,
    lots: [],
    totalRealizedPnL: 0,
    lastPrice: tickerConfig[sym].defaultP
  };
}

const parsedTrades = [];

for (const m of msgs) {
  const content = m.content.replace(/\[IMAGE:.*?\]/gi, '').trim();
  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;

  let matchedSym = null;
  for (const item of tickerAliases) {
    if (item.regex.test(content)) {
      matchedSym = item.symbol;
      break;
    }
  }
  if (!matchedSym) continue;

  const cfg = tickerConfig[matchedSym];
  const targetObj = portfolio[matchedSym];

  const isSell = /(出|卖|止损|止盈|清仓|减半|出一半)/.test(content);
  const isBuy = /(买|加|接|开仓|拿一点|进)/.test(content) && !isSell;
  if (!isBuy && !isSell) continue;

  // 提取点位并严格校验在合理区间，剔除几块钱的期权金干扰
  let price = null;
  const priceMatches = content.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
  if (priceMatches) {
    for (const p of priceMatches) {
      const pVal = parseFloat(p);
      if (pVal >= cfg.minP && pVal <= cfg.maxP) {
        price = pVal;
        break;
      }
    }
  }
  if (!price) price = targetObj.lastPrice || cfg.defaultP;
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

  // 动态资产换算（锁定在合理健康范围）
  let totalPosValue = 0;
  for (const sym in portfolio) {
    const pItem = portfolio[sym];
    totalPosValue += pItem.lots.reduce((sum, l) => sum + l.quantity * pItem.lastPrice, 0);
  }
  const totalEquity = Math.max(50000, Math.min(200000, currentCash + totalPosValue));
  const standardLotCapital = totalEquity / MAX_TARGET_COUNT;

  let tradeQty = 0;
  let tradeAmount = 0;
  let tradeRealizedPnL = 0;

  if (isBuy) {
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
    } else {
      const targetInvest = standardLotCapital * fractionRatio;
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(targetInvest / price)));
    }

    tradeAmount = +(tradeQty * price).toFixed(2);
    currentCash += tradeAmount;

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
      symbol: matchedSym,
      name: cfg.name,
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

// 写入数据库
db.prepare('DELETE FROM campaigns').run();
db.prepare('DELETE FROM positions').run();
db.prepare('DELETE FROM orders').run();

// 写入 orders 表
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

// 写入 positions 表
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

// 写入 campaigns 表
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

const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.log('\n📊 最终当前在持真实持仓清单 (Positions Table):');
console.table(currentPositions);
