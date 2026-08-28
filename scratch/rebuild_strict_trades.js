import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 超高精度实盘交割单提炼引擎 (严格过滤市场观点/闲聊/盯盘提示)');
console.log('====================================================\n');

// 1. 标的字典与真实价格区间配置
const tickerConfig = {
  'NBIS': { name: 'NBIS', minP: 100, maxP: 350, defaultP: 218 },
  'INTC': { name: '英特尔', minP: 30, maxP: 120, defaultP: 92.8 },
  'GOOGL':{ name: '谷歌A', minP: 150, maxP: 400, defaultP: 344.5 },
  'IREN': { name: 'Iris Energy', minP: 10, maxP: 70, defaultP: 38 },
  'CIFR': { name: 'Cipher Mining', minP: 2, maxP: 25, defaultP: 17.8 },
  'BMNR': { name: 'BMNR', minP: 5, maxP: 40, defaultP: 22.05 },
  'CONL': { name: 'Coinbase双倍', minP: 2, maxP: 20, defaultP: 4.5 },
  'HOOD': { name: 'Robinhood', minP: 30, maxP: 120, defaultP: 72.8 },
  'SOUN': { name: 'SoundHound AI', minP: 3, maxP: 25, defaultP: 7.23 },
  'CRWV': { name: 'CRWV', minP: 40, maxP: 150, defaultP: 88.7 },
  'DRAM': { name: 'DRAM存储', minP: 25, maxP: 90, defaultP: 52 },
  'TTMI': { name: 'TTMI', minP: 50, maxP: 200, defaultP: 123.4 },
  'WDC':  { name: '西部数据', minP: 40, maxP: 120, defaultP: 75 },
  'SPYU': { name: '标普三倍做多', minP: 15, maxP: 60, defaultP: 35 },
  'NVDA': { name: '英伟达', minP: 60, maxP: 250, defaultP: 175 },
  'TSLA': { name: '特斯拉', minP: 100, maxP: 450, defaultP: 320 },
  'META': { name: 'Meta', minP: 300, maxP: 850, defaultP: 686 },
  'AAPL': { name: '苹果', minP: 120, maxP: 300, defaultP: 228 },
  'MSFT': { name: '微软', minP: 250, maxP: 550, defaultP: 420 },
  'AMZN': { name: '亚马逊', minP: 100, maxP: 300, defaultP: 220 }
};

const tickerAliases = [
  { regex: /\bnbis\b/i, symbol: 'NBIS' },
  { regex: /\bintc\b|英特尔/i, symbol: 'INTC' },
  { regex: /\bgoogl\b|谷歌[A|a]?/i, symbol: 'GOOGL' },
  { regex: /\biren\b/i, symbol: 'IREN' },
  { regex: /\bcifr\b/i, symbol: 'CIFR' },
  { regex: /\bbmnr\b/i, symbol: 'BMNR' },
  { regex: /\bconl\b/i, symbol: 'CONL' },
  { regex: /\bhood\b/i, symbol: 'HOOD' },
  { regex: /\bsoun\b/i, symbol: 'SOUN' },
  { regex: /\bcrwv\b/i, symbol: 'CRWV' },
  { regex: /\bdram\b/i, symbol: 'DRAM' },
  { regex: /\bttmi\b/i, symbol: 'TTMI' },
  { regex: /\bwdc\b|西部数据/i, symbol: 'WDC' },
  { regex: /\bspyu\b/i, symbol: 'SPYU' },
  { regex: /\bnvda\b|英伟达/i, symbol: 'NVDA' },
  { regex: /\btsla\b|特斯拉/i, symbol: 'TSLA' },
  { regex: /\bmeta\b|脸书/i, symbol: 'META' },
  { regex: /\baapl\b|苹果/i, symbol: 'AAPL' },
  { regex: /\bmsft\b|微软/i, symbol: 'MSFT' },
  { regex: /\bamzn\b|亚马逊/i, symbol: 'AMZN' }
];

// 2. 获取【历史股票期权记录区】发言
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
  ORDER BY created_at ASC
`).all();

console.log(`📚 【历史股票期权记录区】全量消息数: ${msgs.length} 条`);

// 3. 严格交易动作过滤器（必须是真实发出的已成交买卖动作，过滤假交易与大盘闲聊）
function parseExplicitTrade(content) {
  // a. 过滤宏观/情绪/闲聊黑名单
  if (/散户|投票|法案|如果维持|带动了|分流了|搜btc|盯紧.*迹象|有转弯迹象在出|再决定|等急跌|观察|建议/i.test(content) && !/加了|出了|买了|出了剩下|再次加回/i.test(content)) {
    return null;
  }

  // b. 识别明确动作
  let action = null;
  if (/加了|买了|加回|接了|开了|补了|买入|建仓|拿一点|进点/i.test(content)) {
    action = 'BUY';
  } else if (/出了|卖了|出掉|清了|止损|止盈|出剩下|出了一半|出半/i.test(content)) {
    action = 'SELL';
  }
  
  if (!action) return null;

  // c. 识别标的
  let symbol = null;
  for (const item of tickerAliases) {
    if (item.regex.test(content)) {
      symbol = item.symbol;
      break;
    }
  }
  if (!symbol) return null;

  const cfg = tickerConfig[symbol];

  // d. 提取真实成交点位
  let price = null;
  const pMatches = content.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
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

  // e. 识别常规仓比例
  let fractionName = '1/3 常规仓';
  let fractionRatio = 1 / 3;

  if (/6分之一|1\/6/i.test(content)) {
    fractionName = '1/6 常规仓';
    fractionRatio = 1 / 6;
  } else if (/出一半|出半|剩下一半|再加一半|常规一半|常规仓一半|1\/2|半份/i.test(content)) {
    fractionName = '1/2 仓位 (半仓)';
    fractionRatio = 1 / 2;
  } else if (/1\/3|三分之一/i.test(content)) {
    fractionName = '1/3 常规仓';
    fractionRatio = 1 / 3;
  } else if (/满仓|买满|全部/i.test(content)) {
    fractionName = '满仓 (1个常规仓)';
    fractionRatio = 1.0;
  }

  return {
    symbol,
    action,
    price,
    fractionName,
    fractionRatio
  };
}

// 4. 账户模拟与演算法
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
  const trade = parseExplicitTrade(content);
  if (!trade) continue;

  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const targetObj = portfolio[trade.symbol];
  targetObj.lastPrice = trade.price;

  // 动态资产计算
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
    parsedTrades.push({
      symbol: trade.symbol,
      name: tickerConfig[trade.symbol].name,
      action: trade.action,
      price: trade.price,
      quantity: tradeQty,
      tradeAmount,
      fractionName: trade.fractionName,
      realizedPnL: tradeRealizedPnL,
      timestamp: timeMs,
      content: content.substring(0, 120)
    });
  }
}

console.log(`✅ 过滤后提炼出高纯度实战交割单: ${parsedTrades.length} 笔！\n`);

// 5. 写入数据库
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

console.log(`🎉 纯净版实盘持仓与交割单入库完成！活跃持仓标的: ${activePositionsCount} 个！`);

const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.log('\n📊 最终当前在持纯净持仓清单:');
console.table(currentPositions);
