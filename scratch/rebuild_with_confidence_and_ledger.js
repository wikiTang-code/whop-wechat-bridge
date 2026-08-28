import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 置信度评分引擎与持仓前后演变台账计算落库');
console.log('====================================================\n');

// 1. 标的合理区间与默认价
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

// 2. 解析发言并计算置信度得分 (0 ~ 100)
function evaluateMessageConfidence(content) {
  const cleanContent = content.replace(/\[IMAGE:.*?\]/gi, '').trim();

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

  // 强动作动词
  const hasStrongBuy = /(加了|买了|加回|开了|建仓|补了|接了|进了|买入|开仓|加仓|再加|开了常规)/i.test(cleanContent);
  const hasStrongSell = /(出了|卖了|出掉|清了|止损|止盈|平仓|出剩下|出了一半|卖出一半|出一半|出半|出完)/i.test(cleanContent);
  
  // 弱动作/观点
  const hasWeakAction = /(拿一点|进点|有个常规|可以.*加|可以.*出|挂了)/i.test(cleanContent);
  const hasChatWords = /(散户|搜btc|报价|维持目前的涨幅|带动了|分流了|为什么|怎么看|建议|探讨|如果|迹象)/i.test(cleanContent);

  if (!hasStrongBuy && !hasStrongSell && !hasWeakAction) return null;

  // 置信度评分体系
  let confidence = 50; // 基础分

  if (hasStrongBuy || hasStrongSell) confidence += 35; // 强动作动词加 35 分
  if (hasWeakAction && !hasStrongBuy && !hasStrongSell) confidence += 15; // 弱动作加 15 分
  if (hasChatWords) confidence -= 25; // 闲聊或假设词扣 25 分

  // 点位提取与合理区间
  const cfg = tickerConfig[matchedTicker] || { minP: 1, maxP: 2000, defaultP: 100 };
  let price = null;
  const pMatches = cleanContent.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
  if (pMatches) {
    for (const p of pMatches) {
      const pVal = parseFloat(p);
      if (pVal >= cfg.minP && pVal <= cfg.maxP) {
        price = pVal;
        confidence += 15; // 有合理正股点位加 15 分
        break;
      }
    }
  }
  if (!price) price = cfg.defaultP;

  // 常规仓份额
  let fractionName = '1/3 常规仓';
  let fractionRatio = 1 / 3;

  if (/6分之一|1\/6/i.test(cleanContent)) {
    fractionName = '1/6 常规仓';
    fractionRatio = 1 / 6;
    confidence += 5;
  } else if (/出一半|出半|剩下一半|再加一半|常规一半|常规仓一半|1\/2|半份|半仓/i.test(cleanContent)) {
    fractionName = '1/2 仓位 (半仓)';
    fractionRatio = 1 / 2;
    confidence += 5;
  } else if (/1\/3|三分之一/i.test(cleanContent)) {
    fractionName = '1/3 常规仓';
    fractionRatio = 1 / 3;
    confidence += 5;
  } else if (/满仓|买满|全部/i.test(cleanContent)) {
    fractionName = '满仓 (1个常规仓)';
    fractionRatio = 1.0;
    confidence += 5;
  }

  // 约束置信度在 0 ~ 100 之间
  confidence = Math.max(10, Math.min(99, confidence));

  // 大于等于 80 分为 confirmed（已确认实战交易），否则为 candidate（待确认候选池）
  const status = confidence >= 80 ? 'confirmed' : 'candidate';
  const action = (hasStrongBuy || (hasWeakAction && !hasStrongSell)) ? 'BUY' : 'SELL';

  return {
    symbol: matchedTicker,
    action,
    price,
    fractionName,
    fractionRatio,
    confidence,
    status,
    rawContent: cleanContent
  };
}

// 3. 读取频道消息并执行动态台账推演
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
  ORDER BY created_at ASC
`).all();

console.log(`📚 频道总消息数: ${msgs.length} 条\n`);

const INITIAL_ACCOUNT_EQUITY = 90000.00;
const MAX_TARGET_COUNT = 10;
let currentCash = INITIAL_ACCOUNT_EQUITY;

const portfolio = {};
const allParsedRecords = [];

for (const m of msgs) {
  const item = evaluateMessageConfidence(m.content);
  if (!item) continue;

  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const sym = item.symbol;

  if (!portfolio[sym]) {
    portfolio[sym] = {
      symbol: sym,
      lots: [],
      totalRealizedPnL: 0,
      lastPrice: item.price
    };
  }

  const targetObj = portfolio[sym];
  targetObj.lastPrice = item.price;

  // 记录操作前的持仓快照
  const beforeQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
  const beforeCost = targetObj.lots.reduce((sum, l) => sum + l.investAmount, 0);
  const beforeAvgCost = beforeQty > 0 ? +(beforeCost / beforeQty).toFixed(2) : 0;

  // 动态资产
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

  // 只有 status === 'confirmed' 才参与持仓状态机计算
  if (item.status === 'confirmed') {
    if (item.action === 'BUY') {
      const targetInvest = standardLotCapital * item.fractionRatio;
      tradeQty = Math.max(1, Math.floor(targetInvest / item.price));
      tradeAmount = +(tradeQty * item.price).toFixed(2);
      currentCash -= tradeAmount;

      targetObj.lots.push({
        price: item.price,
        quantity: tradeQty,
        investAmount: tradeAmount,
        fractionName: item.fractionName,
        timestamp: timeMs
      });
    } else if (item.action === 'SELL' && targetObj.lots.length > 0) {
      if (item.fractionRatio === 0.5) {
        tradeQty = Math.max(1, Math.floor(beforeQty * 0.5));
      } else {
        const targetInvest = standardLotCapital * item.fractionRatio;
        tradeQty = Math.min(beforeQty, Math.max(1, Math.floor(targetInvest / item.price)));
      }

      tradeAmount = +(tradeQty * item.price).toFixed(2);
      currentCash += tradeAmount;

      let remainingToSell = tradeQty;
      while (remainingToSell > 0 && targetObj.lots.length > 0) {
        const lot = targetObj.lots[0];
        if (lot.quantity <= remainingToSell) {
          tradeRealizedPnL += (item.price - lot.price) * lot.quantity;
          remainingToSell -= lot.quantity;
          targetObj.lots.shift();
        } else {
          tradeRealizedPnL += (item.price - lot.price) * remainingToSell;
          lot.quantity -= remainingToSell;
          lot.investAmount -= remainingToSell * lot.price;
          remainingToSell = 0;
        }
      }
      targetObj.totalRealizedPnL += tradeRealizedPnL;
    }
  }

  // 记录操作后的持仓快照
  const afterQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
  const afterCost = targetObj.lots.reduce((sum, l) => sum + l.investAmount, 0);
  const afterAvgCost = afterQty > 0 ? +(afterCost / afterQty).toFixed(2) : 0;

  allParsedRecords.push({
    id: `rev_${timeMs}_${allParsedRecords.length}`,
    message_id: m.id,
    ticker: sym,
    action: item.action,
    price: item.price,
    fraction_name: item.fractionName,
    fraction_ratio: item.fractionRatio,
    confidence: item.confidence,
    status: item.status,
    raw_content: item.rawContent,
    trade_qty: tradeQty,
    trade_amount: tradeAmount,
    before_qty: beforeQty,
    before_avg_cost: beforeAvgCost,
    after_qty: afterQty,
    after_avg_cost: afterAvgCost,
    created_at: timeMs,
    updated_at: Date.now()
  });
}

console.log(`✅ 解析完成！共提取 ${allParsedRecords.length} 条记录，其中 Confirmed: ${allParsedRecords.filter(r => r.status === 'confirmed').length} 条，Candidate 待确认: ${allParsedRecords.filter(r => r.status === 'candidate').length} 条！\n`);

// 4. 落库全表
db.prepare('DELETE FROM trade_review_pool').run();
db.prepare('DELETE FROM campaigns').run();
db.prepare('DELETE FROM positions').run();
db.prepare('DELETE FROM orders').run();

// 写入 trade_review_pool 表
const insertReviewStmt = db.prepare(`
  INSERT INTO trade_review_pool (
    id, message_id, ticker, action, price, fraction_name, fraction_ratio,
    confidence, status, raw_content, before_qty, before_avg_cost, after_qty, after_avg_cost,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const r of allParsedRecords) {
  insertReviewStmt.run(
    r.id, r.message_id, r.ticker, r.action, r.price, r.fraction_name, r.fraction_ratio,
    r.confidence, r.status, r.raw_content, r.before_qty, r.before_avg_cost, r.after_qty, r.after_avg_cost,
    r.created_at, r.updated_at
  );
}

// 写入 orders 表 (仅写入 confirmed 交易)
const insertOrderStmt = db.prepare(`
  INSERT INTO orders (id, ticker, action, price, quantity, status, created_at, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const confirmedTrades = allParsedRecords.filter(r => r.status === 'confirmed' && r.trade_qty > 0);
for (const t of confirmedTrades) {
  const evolutionDesc = `【操作前: ${t.before_qty}股 ($${t.before_avg_cost}) ➔ ${t.action === 'BUY' ? '🟢买入' : '🔴卖出'} ${t.trade_qty}股 @ $${t.price} ➔ 操作后: ${t.after_qty}股 ($${t.after_avg_cost})】| 信息源: ${t.raw_content}`;
  insertOrderStmt.run(
    `ord_${t.created_at}_${t.id}`,
    t.ticker,
    t.action,
    t.price,
    t.trade_qty,
    'FILLED',
    t.created_at,
    evolutionDesc
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
for (const t of confirmedTrades.slice(-200).reverse()) {
  const isHolding = (portfolio[t.ticker].lots.reduce((sum, l) => sum + l.quantity, 0) > 0) && !activeTickers.has(t.ticker);
  const status = isHolding ? 'active' : 'closed';
  if (isHolding) activeTickers.add(t.ticker);

  const desc = `【${t.action === 'BUY' ? '买入建仓' : '卖出止盈'} | 置信度 ${t.confidence}%】${t.raw_content}`;
  try {
    insertCampStmt.run(
      'user_4yeplXgbguTu4',
      t.ticker,
      status,
      t.created_at,
      status === 'closed' ? t.created_at + 86400000 : null,
      desc,
      status === 'closed' ? `已平仓实现退出` : null,
      t.price,
      status === 'closed' ? +(t.price * 1.05).toFixed(2) : null,
      0.05,
      '历史股票期权记录区',
      t.created_at,
      Date.now()
    );
  } catch (e) {}
}

console.log(`🎉 落库完毕！当前活跃持仓: ${activePositionsCount} 个标的！`);
const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.table(currentPositions);
