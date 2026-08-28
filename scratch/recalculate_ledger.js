import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 持久化持仓推演引擎 (尊重人工标注，绝不覆盖已审核记录)');
console.log('====================================================\n');

// 1. 标的合理区间与默认配置
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

// 确保 trade_review_pool 表结构存在
db.prepare(`
  CREATE TABLE IF NOT EXISTS trade_review_pool (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL,
    price REAL NOT NULL,
    fraction_name TEXT,
    fraction_ratio REAL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    is_manual INTEGER DEFAULT 0,
    raw_content TEXT NOT NULL,
    before_qty INTEGER DEFAULT 0,
    before_avg_cost REAL DEFAULT 0,
    after_qty INTEGER DEFAULT 0,
    after_avg_cost REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

// 2. 从 trade_review_pool 表读取当前所有记录（如果表为空才从 messages 初始化）
let existingRecords = db.prepare(`SELECT * FROM trade_review_pool ORDER BY created_at ASC`).all();

if (existingRecords.length === 0) {
  console.log('⚠️ 评审池为空，正在从历史股票期权记录区初始化...');
  const initScript = await import('./rebuild_with_confidence_and_ledger.js');
  existingRecords = db.prepare(`SELECT * FROM trade_review_pool ORDER BY created_at ASC`).all();
}

console.log(`📚 当前评审池总记录数: ${existingRecords.length} 条 (其中 Confirmed: ${existingRecords.filter(r => r.status === 'confirmed').length} 条, Candidate: ${existingRecords.filter(r => r.status === 'candidate').length} 条)\n`);

// 3. 基于当前评审池中的 confirmed 状态记录，重新推演全量持仓状态机
const INITIAL_ACCOUNT_EQUITY = 90000.00;
const MAX_TARGET_COUNT = 10;
let currentCash = INITIAL_ACCOUNT_EQUITY;

const portfolio = {};
const confirmedTrades = [];

// 更新每条 confirmed 记录的前后持仓快照
const updateSnapshotStmt = db.prepare(`
  UPDATE trade_review_pool
  SET before_qty = ?, before_avg_cost = ?, after_qty = ?, after_avg_cost = ?, updated_at = ?
  WHERE id = ?
`);

for (const r of existingRecords) {
  const sym = r.ticker;
  if (!portfolio[sym]) {
    portfolio[sym] = {
      symbol: sym,
      lots: [],
      totalRealizedPnL: 0,
      lastPrice: r.price
    };
  }

  const targetObj = portfolio[sym];
  targetObj.lastPrice = r.price;

  const beforeQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
  const beforeCost = targetObj.lots.reduce((sum, l) => sum + l.investAmount, 0);
  const beforeAvgCost = beforeQty > 0 ? +(beforeCost / beforeQty).toFixed(2) : 0;

  let tradeQty = 0;
  let tradeAmount = 0;
  let tradeRealizedPnL = 0;

  if (r.status === 'confirmed') {
    // 动态资产
    let totalPosValue = 0;
    for (const s in portfolio) {
      const pItem = portfolio[s];
      totalPosValue += pItem.lots.reduce((sum, l) => sum + l.quantity * pItem.lastPrice, 0);
    }
    const totalEquity = Math.max(50000, Math.min(200000, currentCash + totalPosValue));
    const standardLotCapital = totalEquity / MAX_TARGET_COUNT;

    if (r.action === 'BUY') {
      const targetInvest = standardLotCapital * (r.fraction_ratio || 1/3);
      tradeQty = Math.max(1, Math.floor(targetInvest / r.price));
      tradeAmount = +(tradeQty * r.price).toFixed(2);
      currentCash -= tradeAmount;

      targetObj.lots.push({
        price: r.price,
        quantity: tradeQty,
        investAmount: tradeAmount,
        fractionName: r.fraction_name,
        timestamp: r.created_at
      });
    } else if (r.action === 'SELL' && targetObj.lots.length > 0) {
      if (r.fraction_ratio === 0.5) {
        tradeQty = Math.max(1, Math.floor(beforeQty * 0.5));
      } else {
        const targetInvest = standardLotCapital * (r.fraction_ratio || 1/3);
        tradeQty = Math.min(beforeQty, Math.max(1, Math.floor(targetInvest / r.price)));
      }

      tradeAmount = +(tradeQty * r.price).toFixed(2);
      currentCash += tradeAmount;

      let remainingToSell = tradeQty;
      while (remainingToSell > 0 && targetObj.lots.length > 0) {
        const lot = targetObj.lots[0];
        if (lot.quantity <= remainingToSell) {
          tradeRealizedPnL += (r.price - lot.price) * lot.quantity;
          remainingToSell -= lot.quantity;
          targetObj.lots.shift();
        } else {
          tradeRealizedPnL += (r.price - lot.price) * remainingToSell;
          lot.quantity -= remainingToSell;
          lot.investAmount -= remainingToSell * lot.price;
          remainingToSell = 0;
        }
      }
      targetObj.totalRealizedPnL += tradeRealizedPnL;
    }

    const afterQty = targetObj.lots.reduce((sum, l) => sum + l.quantity, 0);
    const afterCost = targetObj.lots.reduce((sum, l) => sum + l.investAmount, 0);
    const afterAvgCost = afterQty > 0 ? +(afterCost / afterQty).toFixed(2) : 0;

    updateSnapshotStmt.run(beforeQty, beforeAvgCost, afterQty, afterAvgCost, Date.now(), r.id);

    if (tradeQty > 0) {
      confirmedTrades.push({
        id: r.id,
        ticker: r.ticker,
        action: r.action,
        price: r.price,
        trade_qty: tradeQty,
        trade_amount: tradeAmount,
        before_qty: beforeQty,
        before_avg_cost: beforeAvgCost,
        after_qty: afterQty,
        after_avg_cost: afterAvgCost,
        created_at: r.created_at,
        raw_content: r.raw_content
      });
    }
  } else {
    // candidate / rejected 状态将前后持仓清零
    updateSnapshotStmt.run(0, 0, 0, 0, Date.now(), r.id);
  }
}

// 4. 重建 orders 表与 positions 表
db.prepare('DELETE FROM positions').run();
db.prepare('DELETE FROM orders').run();

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (id, ticker, action, price, quantity, status, created_at, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const t of confirmedTrades) {
  const evolutionDesc = `【操作前: ${t.before_qty}股 ($${t.before_avg_cost}) ➔ ${t.action === 'BUY' ? '🟢买入' : '🔴卖出'} ${t.trade_qty}股 @ $${t.price} ➔ 操作后: ${t.after_qty}股 ($${t.after_avg_cost})】| 信息源: ${t.raw_content}`;
  insertOrderStmt.run(
    t.id,
    t.ticker,
    t.action,
    t.price,
    t.trade_qty,
    'FILLED',
    t.created_at,
    evolutionDesc
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

console.log(`🎉 持久化状态机计算完成！当前活跃持仓标的: ${activePositionsCount} 个，订单流水: ${confirmedTrades.length} 笔！`);
const currentPositions = db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all();
console.table(currentPositions);
