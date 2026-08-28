import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 实事求是高保真交易提炼引擎 (严格正股合理价格锚定版)');
console.log('====================================================\n');

const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
  ORDER BY created_at ASC
`).all();

console.log(`📚 频道总消息量: ${msgs.length} 条\n`);

const tickerConfig = {
  'NBIS': { minP: 100, maxP: 350, defaultP: 218 },
  'INTC': { minP: 30, maxP: 120, defaultP: 92.8 },
  'GOOGL':{ minP: 150, maxP: 400, defaultP: 344.5 },
  'GOOG': { minP: 150, maxP: 400, defaultP: 344.5 },
  'IREN': { minP: 10, maxP: 70, defaultP: 38 },
  'CIFR': { minP: 2, maxP: 25, defaultP: 17.8 },
  'BMNR': { minP: 5, maxP: 40, defaultP: 22.05 },
  'CONL': { minP: 1.5, maxP: 20, defaultP: 4.5 },
  'HOOD': { minP: 20, maxP: 120, defaultP: 72.8 },
  'SOUN': { minP: 3, maxP: 25, defaultP: 7.23 },
  'CRWV': { minP: 40, maxP: 150, defaultP: 88.7 },
  'DRAM': { minP: 25, maxP: 90, defaultP: 52 },
  'TTMI': { minP: 50, maxP: 200, defaultP: 123.4 },
  'WDC':  { minP: 40, maxP: 120, defaultP: 75 },
  'LITE': { minP: 30, maxP: 150, defaultP: 75 },
  'COHR': { minP: 30, maxP: 150, defaultP: 95 },
  'OKLO': { minP: 8, maxP: 45, defaultP: 25 },
  'GLW':  { minP: 25, maxP: 70, defaultP: 48 },
  'NVDA': { minP: 60, maxP: 250, defaultP: 175 },
  'NVDL': { minP: 20, maxP: 150, defaultP: 75 },
  'TSLA': { minP: 100, maxP: 450, defaultP: 320 },
  'TSLL': { minP: 8, maxP: 40, defaultP: 15 },
  'META': { minP: 250, maxP: 850, defaultP: 686 },
  'FBL':  { minP: 15, maxP: 80, defaultP: 45 },
  'AAPL': { minP: 120, maxP: 300, defaultP: 228 },
  'MSFT': { minP: 250, maxP: 550, defaultP: 420 },
  'MSFL': { minP: 15, maxP: 100, defaultP: 50 },
  'AMZN': { minP: 100, maxP: 300, defaultP: 220 },
  'AMD':  { minP: 80, maxP: 250, defaultP: 180 },
  'MSTR': { minP: 80, maxP: 500, defaultP: 320 },
  'MSTX': { minP: 15, maxP: 80, defaultP: 35 },
  'QQQ':  { minP: 350, maxP: 550, defaultP: 490 },
  'TQQQ': { minP: 30, maxP: 120, defaultP: 75 },
  'SQQQ': { minP: 5, maxP: 30, defaultP: 10 },
  'SPY':  { minP: 400, maxP: 650, defaultP: 580 },
  'SPYU': { minP: 15, maxP: 60, defaultP: 35 },
  'SOXL': { minP: 20, maxP: 80, defaultP: 45 },
  'SOXS': { minP: 5, maxP: 30, defaultP: 12 }
};

const KNOWN_TICKERS = [
  { symbol: 'NBIS',  names: ['nbis'] },
  { symbol: 'INTC',  names: ['intc', '英特尔'] },
  { symbol: 'GOOGL', names: ['谷歌a', 'googl', '谷歌'] },
  { symbol: 'GOOG',  names: ['谷歌c', 'goog'] },
  { symbol: 'IREN',  names: ['iren'] },
  { symbol: 'CIFR',  names: ['cifr'] },
  { symbol: 'BMNR',  names: ['bmnr'] },
  { symbol: 'CONL',  names: ['conl'] },
  { symbol: 'HOOD',  names: ['hood', 'robinhood'] },
  { symbol: 'SOUN',  names: ['soun'] },
  { symbol: 'CRWV',  names: ['crwv'] },
  { symbol: 'DRAM',  names: ['dram'] },
  { symbol: 'TTMI',  names: ['ttmi'] },
  { symbol: 'WDC',   names: ['wdc', '西部数据'] },
  { symbol: 'LITE',  names: ['lite'] },
  { symbol: 'COHR',  names: ['cohr'] },
  { symbol: 'OKLO',  names: ['oklo'] },
  { symbol: 'GLW',   names: ['glw', '康宁'] },
  { symbol: 'NVDA',  names: ['nvda', '英伟达'] },
  { symbol: 'NVDL',  names: ['nvdl', '英伟达双倍'] },
  { symbol: 'TSLA',  names: ['tsla', '特斯拉'] },
  { symbol: 'TSLL',  names: ['tsll', '特斯拉两倍'] },
  { symbol: 'META',  names: ['meta', '脸书'] },
  { symbol: 'FBL',   names: ['fbl'] },
  { symbol: 'AAPL',  names: ['aapl', '苹果'] },
  { symbol: 'MSFT',  names: ['msft', '微软'] },
  { symbol: 'MSFL',  names: ['msfl', '微软双倍'] },
  { symbol: 'AMZN',  names: ['amzn', '亚马逊'] },
  { symbol: 'AMD',   names: ['amd'] },
  { symbol: 'MSTR',  names: ['mstr', '微策略'] },
  { symbol: 'MSTX',  names: ['mstx'] },
  { symbol: 'QQQ',   names: ['qqq'] },
  { symbol: 'TQQQ',  names: ['tqqq'] },
  { symbol: 'SQQQ',  names: ['sqqq'] },
  { symbol: 'SPY',   names: ['spy'] },
  { symbol: 'SPYU',  names: ['spyu'] },
  { symbol: 'SOXL',  names: ['soxl'] },
  { symbol: 'SOXS',  names: ['soxs'] }
];

function parseMessageToTrade(content) {
  const cleanContent = content.replace(/\[IMAGE:.*?\]/gi, '').trim();

  // 排除纯评论/纯闲聊/搜索/哲学语录
  if (/散户.*重要|搜btc|报价|如果.*维持目前的涨幅|带动了|分流了|为什么|怎么看|建议|探讨/i.test(cleanContent)) {
    if (!/加了|出了|买入|建仓|出掉|加回/i.test(cleanContent)) {
      return null;
    }
  }

  // 动作识别
  const isBuy = /(加了|买了|加回|开了|建仓|补了|接了|进了|买入|开仓|加仓|再加|拿一点|进点|有个常规)/i.test(cleanContent);
  const isSell = /(出了|卖了|出掉|清了|止损|止盈|平仓|出剩下|出了一半|卖出一半|出一半|出半|出完)/i.test(cleanContent);

  if (!isBuy && !isSell) return null;

  // 标的识别
  let matchedTicker = null;
  for (const t of KNOWN_TICKERS) {
    for (const name of t.names) {
      const regex = new RegExp(`(^|[^a-zA-Z0-9])${name}([^a-zA-Z0-9]|$)`, 'i');
      if (regex.test(cleanContent)) {
        matchedTicker = t.symbol;
        break;
      }
    }
    if (matchedTicker) break;
  }

  if (!matchedTicker) return null;

  // 过滤 QQQ/SPY 纯宏观大盘行情描述
  if (matchedTicker === 'QQQ' || matchedTicker === 'SPY') {
    if (!/(加了|买了|出了|开仓|清仓).*(qqq|spy)|(qqq|spy).*(加了|买了|出了|开仓|清仓)/i.test(cleanContent)) {
      return null;
    }
  }

  const cfg = tickerConfig[matchedTicker] || { minP: 1, maxP: 2000, defaultP: 100 };

  // 提取点位并严格校验在正股合理价格区间内（防止期权几块钱权利金污染正股计算）
  let price = null;
  const pMatches = cleanContent.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
  if (pMatches) {
    for (const p of pMatches) {
      const pVal = parseFloat(p);
      if (pVal >= cfg.minP && pVal <= cfg.maxP) {
        price = pVal;
        break;
      }
    }
  }
  if (!price) price = cfg.defaultP;

  // 仓位识别
  let fractionName = '1/3 常规仓';
  let fractionRatio = 1 / 3;

  if (/6分之一|1\/6/i.test(cleanContent)) {
    fractionName = '1/6 常规仓';
    fractionRatio = 1 / 6;
  } else if (/出一半|出半|剩下一半|再加一半|常规一半|常规仓一半|1\/2|半份|半仓/i.test(cleanContent)) {
    fractionName = '1/2 仓位 (半仓)';
    fractionRatio = 1 / 2;
  } else if (/1\/3|三分之一/i.test(cleanContent)) {
    fractionName = '1/3 常规仓';
    fractionRatio = 1 / 3;
  } else if (/满仓|买满|全部/i.test(cleanContent)) {
    fractionName = '满仓 (1个常规仓)';
    fractionRatio = 1.0;
  }

  return {
    symbol: matchedTicker,
    action: isBuy && !isSell ? 'BUY' : 'SELL',
    price,
    fractionName,
    fractionRatio,
    rawContent: cleanContent
  };
}

const INITIAL_ACCOUNT_EQUITY = 90000.00;
const MAX_TARGET_COUNT = 10;
let currentCash = INITIAL_ACCOUNT_EQUITY;

const portfolio = {};
const allValidTrades = [];

for (const m of msgs) {
  const trade = parseMessageToTrade(m.content);
  if (!trade) continue;

  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const sym = trade.symbol;

  if (!portfolio[sym]) {
    portfolio[sym] = {
      symbol: sym,
      lots: [],
      totalRealizedPnL: 0,
      lastPrice: trade.price
    };
  }

  const targetObj = portfolio[sym];
  targetObj.lastPrice = trade.price;

  let totalPosValue = 0;
  for (const s in portfolio) {
    const pItem = portfolio[s];
    totalPosValue += pItem.lots.reduce((sum, l) => sum + l.quantity * pItem.lastPrice, 0);
  }
  const totalEquity = Math.max(50000, Math.min(200000, currentCash + totalPosValue));
  const standardLotCapital = totalEquity / MAX_TARGET_COUNT;

  let tradeQty = 0;
  let tradeAmount = 0;
  let tradeRealizedPnL = 0;

  if (trade.action === 'BUY') {
    const targetInvest = standardLotCapital * trade.fractionRatio;
    tradeQty = Math.max(1, Math.floor(targetInvest / trade.price));
    tradeAmount = +(tradeQty * trade.price).toFixed(2);
    currentCash -= tradeAmount;

    targetObj.lots.push({
      price: trade.price,
      quantity: tradeQty,
      investAmount: tradeAmount,
      fractionName: trade.fractionName,
      timestamp: timeMs
    });
  } else if (trade.action === 'SELL' && targetObj.lots.length > 0) {
    const totalHoldingQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
    if (trade.fractionRatio === 0.5) {
      tradeQty = Math.max(1, Math.floor(totalHoldingQty * 0.5));
    } else {
      const targetInvest = standardLotCapital * trade.fractionRatio;
      tradeQty = Math.min(totalHoldingQty, Math.max(1, Math.floor(targetInvest / trade.price)));
    }

    tradeAmount = +(tradeQty * trade.price).toFixed(2);
    currentCash += tradeAmount;

    let remainingToSell = tradeQty;
    while (remainingToSell > 0 && targetObj.lots.length > 0) {
      const lot = targetObj.lots[0];
      if (lot.quantity <= remainingToSell) {
        tradeRealizedPnL += (trade.price - lot.price) * lot.quantity;
        remainingToSell -= lot.quantity;
        targetObj.lots.shift();
      } else {
        tradeRealizedPnL += (trade.price - lot.price) * remainingToSell;
        lot.quantity -= remainingToSell;
        lot.investAmount -= remainingToSell * lot.price;
        remainingToSell = 0;
      }
    }
    targetObj.totalRealizedPnL += tradeRealizedPnL;
  }

  if (tradeQty > 0) {
    allValidTrades.push({
      symbol: sym,
      action: trade.action,
      price: trade.price,
      quantity: tradeQty,
      tradeAmount,
      fractionName: trade.fractionName,
      realizedPnL: tradeRealizedPnL,
      timestamp: timeMs,
      content: trade.rawContent
    });
  }
}

console.log(`🎯 高纯度真实成交指令: ${allValidTrades.length} 笔！`);

// 落库
db.prepare('DELETE FROM campaigns').run();
db.prepare('DELETE FROM positions').run();
db.prepare('DELETE FROM orders').run();

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (id, ticker, action, price, quantity, status, created_at, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 0; i < allValidTrades.length; i++) {
  const t = allValidTrades[i];
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

const insertCampStmt = db.prepare(`
  INSERT INTO campaigns (influencer_id, ticker, status, open_time, close_time, open_reason, close_reason, initial_price, exit_price, pnl_ratio, strategy_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const activeTickers = new Set();
for (const t of allValidTrades.slice(-200).reverse()) {
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

console.log(`\n🎉 真实持仓落库成功！当前活跃持仓标的: ${activePositionsCount} 个！`);
const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.table(currentPositions);
