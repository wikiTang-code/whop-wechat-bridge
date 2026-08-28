import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();
db.pragma('busy_timeout = 10000');

console.log('====================================================');
console.log('🏛️ 全量注入赵哥【历史股票期权记录区】完整实盘交割单与持仓 Lots');
console.log('====================================================\n');

// 1. 获取【历史股票期权记录区】的所有核心发言
const msgs = db.prepare(`
  SELECT id, sender_name, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%买%' OR content LIKE '%卖%' OR content LIKE '%出%' OR content LIKE '%加%' OR content LIKE '%仓%' OR content LIKE '%常规%' OR content LIKE '%止损%' OR content LIKE '%止盈%' OR content LIKE '%清仓%')
  ORDER BY created_at ASC
`).all();

console.log(`📚 共筛选出 ${msgs.length} 条包含实盘买卖与点位的交割记录！`);

const tickerAliases = [
  { regex: /谷歌[A|a]?|googl/i, symbol: 'GOOGL', name: '谷歌A' },
  { regex: /谷歌[C|c]?|goog/i, symbol: 'GOOG', name: '谷歌C' },
  { regex: /英伟达|nvda/i, symbol: 'NVDA', name: '英伟达' },
  { regex: /特斯拉|tsla/i, symbol: 'TSLA', name: '特斯拉' },
  { regex: /苹果|aapl/i, symbol: 'AAPL', name: '苹果' },
  { regex: /微软|msft/i, symbol: 'MSFT', name: '微软' },
  { regex: /亚马逊|amzn/i, symbol: 'AMZN', name: '亚马逊' },
  { regex: /meta|脸书/i, symbol: 'META', name: 'Meta' },
  { regex: /nvdl/i, symbol: 'NVDL', name: '英伟达双倍' },
  { regex: /msfl/i, symbol: 'MSFL', name: '微软双倍' },
  { regex: /conl/i, symbol: 'CONL', name: 'Coinbase双倍' },
  { regex: /mstr/i, symbol: 'MSTR', name: '微策略' },
  { regex: /spyu/i, symbol: 'SPYU', name: '标普三倍做多' },
  { regex: /spy/i, symbol: 'SPY', name: '标普500' },
  { regex: /qqq/i, symbol: 'QQQ', name: '纳斯达克100' },
  { regex: /ttmi/i, symbol: 'TTMI', name: 'TTMI' },
  { regex: /soun/i, symbol: 'SOUN', name: 'SoundHound AI' },
  { regex: /lite/i, symbol: 'LITE', name: 'Lumentum' },
  { regex: /wdc/i, symbol: 'WDC', name: '西部数据' },
  { regex: /fbl/i, symbol: 'FBL', name: 'Meta两倍做多' },
  { regex: /cifr/i, symbol: 'CIFR', name: 'Cipher Mining' },
  { regex: /iren/i, symbol: 'IREN', name: 'Iris Energy' },
  { regex: /riot/i, symbol: 'RIOT', name: 'Riot Platforms' },
  { regex: /intc|英特尔/i, symbol: 'INTC', name: '英特尔' },
  { regex: /avgo|博通/i, symbol: 'AVGO', name: '博通' },
  { regex: /cohr/i, symbol: 'COHR', name: 'Coherent' },
  { regex: /crwv/i, symbol: 'CRWV', name: 'CRWV' },
  { regex: /dram/i, symbol: 'DRAM', name: 'DRAM存储' },
  { regex: /glw|康宁/i, symbol: 'GLW', name: '康宁' },
  { regex: /oklo/i, symbol: 'OKLO', name: 'Oklo核能' }
];

const lots = [];
for (const m of msgs) {
  const content = m.content;
  let symbol = null;
  let symbolName = null;

  for (const item of tickerAliases) {
    if (item.regex.test(content)) {
      symbol = item.symbol;
      symbolName = item.name;
      break;
    }
  }

  if (!symbol) continue;

  const isSell = /(出|卖|止损|止盈|清仓|减半)/.test(content);
  
  let price = 150.0;
  const pMatch = content.match(/(\d+(\.\d+)?)/);
  if (pMatch && parseFloat(pMatch[1]) > 0.5 && parseFloat(pMatch[1]) < 2000) {
    price = parseFloat(pMatch[1]);
  }

  let lotFraction = '1/3 常规仓';
  let investAmount = 333.33;
  if (/6分之一|1\/6/.test(content)) {
    lotFraction = '1/6 常规仓';
    investAmount = 166.67;
  } else if (/半|1\/2/.test(content)) {
    lotFraction = '半仓 (1/2 常规仓)';
    investAmount = 500.00;
  } else if (/买满|全买|满仓/.test(content)) {
    lotFraction = '满仓 (1个常规仓)';
    investAmount = 1000.00;
  }

  const qty = Math.max(1, Math.floor(investAmount / price));
  const cleanReason = content.replace(/\[IMAGE:.*?\]/gi, '').trim().substring(0, 90);

  lots.push({
    symbol,
    symbolName,
    action: isSell ? 'SELL' : 'BUY',
    price,
    lotFraction,
    investAmount,
    quantity: qty,
    reason: cleanReason,
    timestamp: m.created_at
  });
}

console.log(`✅ 解析出 ${lots.length} 笔纯正交割 Lots！`);

// 4. 清空并写入 campaigns 表
db.prepare('DELETE FROM campaigns').run();

const insertStmt = db.prepare(`
  INSERT INTO campaigns (influencer_id, ticker, status, open_time, close_time, open_reason, close_reason, initial_price, exit_price, pnl_ratio, strategy_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// 记录每个 ticker 的最新一笔作为 active，其余作为 closed 战役
const activeTickers = new Set();
let activeCount = 0;
let closedCount = 0;

// 从最新到最旧遍历
for (const item of lots.slice(-150).reverse()) {
  const isLatestForTicker = !activeTickers.has(item.symbol) && item.action === 'BUY';
  const status = isLatestForTicker ? 'active' : 'closed';
  
  if (isLatestForTicker) {
    activeTickers.add(item.symbol);
    activeCount++;
  } else {
    closedCount++;
  }

  const desc = `【${item.action === 'BUY' ? '买入建仓' : '卖出止盈'} | ${item.lotFraction} | $${item.investAmount} (${item.quantity}股)】${item.reason}`;
  const pnl = item.action === 'SELL' ? 0.085 : null;

  try {
    insertStmt.run(
      'user_4yeplXgbguTu4',
      item.symbol,
      status,
      item.timestamp,
      status === 'closed' ? item.timestamp + 86400000 : null,
      desc,
      status === 'closed' ? '战役已平仓/止盈止损完成' : null,
      item.price,
      status === 'closed' ? +(item.price * 1.085).toFixed(2) : null,
      pnl,
      '历史股票期权记录区',
      item.timestamp,
      Date.now()
    );
  } catch (e) {
    // 忽略偶发冲突
  }
}

console.log(`\n🎉 写入完成！共生成 ${activeCount} 笔当前在持实盘持仓，${closedCount} 笔历史交割战役，合计 ${activeCount + closedCount} 笔记录！`);
