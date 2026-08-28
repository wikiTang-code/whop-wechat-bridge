import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 全面改良版语义解析引擎 (全量大V交易动词+正股区间+双向语法)');
console.log('====================================================\n');

// 1. 标的合理区间与默认价
const tickerConfig = {
  'NBIS': { minP: 60, maxP: 350, defaultP: 218 },
  'INTC': { minP: 25, maxP: 130, defaultP: 92.8 },
  'GOOGL':{ minP: 150, maxP: 400, defaultP: 344.5 },
  'GOOG': { minP: 150, maxP: 400, defaultP: 344.5 },
  'IREN': { minP: 10, maxP: 70, defaultP: 38 },
  'CIFR': { minP: 2, maxP: 25, defaultP: 17.8 },
  'BMNR': { minP: 5, maxP: 40, defaultP: 22.05 },
  'CONL': { minP: 1.5, maxP: 20, defaultP: 4.5 },
  'HOOD': { minP: 20, maxP: 150, defaultP: 72.8 },
  'SOUN': { minP: 3, maxP: 25, defaultP: 7.23 },
  'CRWV': { minP: 35, maxP: 150, defaultP: 88.7 },
  'DRAM': { minP: 20, maxP: 90, defaultP: 52 },
  'TTMI': { minP: 40, maxP: 200, defaultP: 123.4 },
  'WDC':  { minP: 30, maxP: 120, defaultP: 75 },
  'LITE': { minP: 25, maxP: 150, defaultP: 75 },
  'COHR': { minP: 25, maxP: 150, defaultP: 95 },
  'OKLO': { minP: 8, maxP: 110, defaultP: 25 },
  'GLW':  { minP: 20, maxP: 70, defaultP: 48 },
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
  'AMD':  { minP: 70, maxP: 250, defaultP: 180 },
  'MSTR': { minP: 80, maxP: 500, defaultP: 320 },
  'MSTX': { minP: 15, maxP: 80, defaultP: 35 },
  'QQQ':  { minP: 350, maxP: 550, defaultP: 490 },
  'TQQQ': { minP: 30, maxP: 120, defaultP: 75 },
  'SQQQ': { minP: 5, maxP: 30, defaultP: 10 },
  'SPY':  { minP: 400, maxP: 650, defaultP: 580 },
  'SPYU': { minP: 15, maxP: 60, defaultP: 35 },
  'SOXL': { minP: 15, maxP: 80, defaultP: 45 },
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

// 2. 根本性改良扫描引擎
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

  // 强买入动词 (涵盖回吸、低吸、打底、加回、抄底等)
  const hasStrongBuy = /(加了|买了|加回|开了|建仓|补了|接了|进了|买入|开仓|加仓|再加|开了常规|回吸|低吸|抄底|吸了|补仓|低买)/i.test(cleanContent);
  // 强卖出动词 (涵盖出、出掉、先出、出底仓、出剩下一半、减、减持等)
  const hasStrongSell = /(出了|卖了|出掉|清了|止损|止盈|平仓|出剩下|出了一半|卖出一半|出一半|出半|出完|先出|出底仓|\b出\b|附近出|减个|减掉|减了)/i.test(cleanContent) || /\d+(\.\d+)?出\s+/i.test(cleanContent);
  
  // 弱动作/设想
  const hasWeakAction = /(拿一点|进点|有个常规|可以.*加|可以.*出|挂了|新开|找机会|注意.*吸|反弹.*减)/i.test(cleanContent);
  const hasChatWords = /(散户|搜btc|报价|维持目前的涨幅|带动了|分流了|为什么|怎么看|建议|探讨|如果|迹象|资讯|大会摘要|讲话)/i.test(cleanContent);

  if (!hasStrongBuy && !hasStrongSell && !hasWeakAction) return null;

  let confidence = 50;
  if (hasStrongBuy || hasStrongSell) confidence += 35;
  if (hasWeakAction && !hasStrongBuy && !hasStrongSell) confidence += 15;
  if (hasChatWords) confidence -= 20;

  // 点位提取与合理区间
  const cfg = tickerConfig[matchedTicker] || { minP: 1, maxP: 2000, defaultP: 100 };
  let price = null;
  const pMatches = cleanContent.match(/\b([1-9]\d{0,3}(\.\d+)?)\b/g);
  if (pMatches) {
    for (const p of pMatches) {
      const pVal = parseFloat(p);
      if (pVal >= cfg.minP && pVal <= cfg.maxP) {
        price = pVal;
        confidence += 15;
        break;
      }
    }
  }
  if (!price) price = cfg.defaultP;

  // 份额计算
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

  confidence = Math.max(10, Math.min(99, confidence));
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

// 3. 读取频道消息
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
  ORDER BY created_at ASC
`).all();

console.log(`📚 历史股票期权记录区总消息数: ${msgs.length} 条\n`);

const allParsedRecords = [];
for (const m of msgs) {
  const item = evaluateMessageConfidence(m.content);
  if (!item) continue;

  const timeMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  allParsedRecords.push({
    id: `rev_${timeMs}_${allParsedRecords.length}`,
    message_id: m.id,
    ticker: item.symbol,
    action: item.action,
    price: item.price,
    fraction_name: item.fractionName,
    fraction_ratio: item.fractionRatio,
    confidence: item.confidence,
    status: item.status,
    is_manual: 0,
    raw_content: item.rawContent,
    created_at: timeMs,
    updated_at: Date.now()
  });
}

console.log(`✅ 改良版解析完成！共提炼出 ${allParsedRecords.length} 条记录 (Confirmed: ${allParsedRecords.filter(r => r.status === 'confirmed').length} 条, Candidate: ${allParsedRecords.filter(r => r.status === 'candidate').length} 条)\n`);

// 4. 安全落库 trade_review_pool 表（保留已有人工修改）
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

try {
  db.prepare("ALTER TABLE trade_review_pool ADD COLUMN is_manual INTEGER DEFAULT 0").run();
} catch (e) {}

// 读取原有手动修改过的内容
const manualOverrides = new Map();
try {
  const oldManuals = db.prepare("SELECT * FROM trade_review_pool WHERE is_manual = 1").all();
  for (const o of oldManuals) {
    manualOverrides.set(o.message_id || o.id, o.status);
  }
} catch (e) {}

db.prepare('DELETE FROM trade_review_pool').run();

const insertReviewStmt = db.prepare(`
  INSERT INTO trade_review_pool (
    id, message_id, ticker, action, price, fraction_name, fraction_ratio,
    confidence, status, is_manual, raw_content, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const r of allParsedRecords) {
  const manualStatus = manualOverrides.get(r.message_id) || manualOverrides.get(r.id);
  const finalStatus = manualStatus || r.status;
  const isManual = manualStatus ? 1 : 0;
  insertReviewStmt.run(
    r.id, r.message_id, r.ticker, r.action, r.price, r.fraction_name, r.fraction_ratio,
    r.confidence, finalStatus, isManual, r.raw_content, r.created_at, r.updated_at
  );
}

// 5. 执行持仓状态机计算
const calcScript = await import('./recalculate_ledger.js');
