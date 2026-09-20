#!/usr/bin/env node
/**
 * tools/trade/historical_signals_lifecycle_analyzer.js
 * [DEBT-017] 历史交易信号开平仓生命周期配对分析器
 * 
 * 严格遵循安全红线与合规要求：
 * 1. 纯只读句柄（readonly: true），绝对隔离实盘下单与生产写操作；
 * 2. 大V身份绝对硬锁（sender_id = 'user_4yeplXgbguTu4'，即 xiaozhaolucky）；
 * 3. 交易专属频道严格物理限定：
 *    - 历史股票期权记录区 (forum_feed_1CTr7SqVMzFfuFiiRJLEHN)
 *    - 不用翻墙期权 (chat_feed_1CTrCEx44dP13jW3RVkYiS)
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
const EXCLUSIVE_CHANNELS = [
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS'
];

export const DB_PATH = process.env.SQLITE_PATH || (fs.existsSync('whop_archive.db') ? 'whop_archive.db' : 'data/whop_bridge.db');

export function analyzeTradeLifecycles(db = new Database(DB_PATH, { readonly: true }), options = {}) {
  console.log('===========================================================');
  console.log('🔍 [DEBT-017] 专属交易频道历史交易单生命周期配对分析');
  console.log('===========================================================');


  // 1. 查询两大专属频道中赵哥的所有原始消息
  const placeholders = EXCLUSIVE_CHANNELS.map(() => '?').join(',');
  const query = `
    SELECT id, channel_id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE channel_id IN (${placeholders})
      AND sender_id = ?
    ORDER BY created_at ASC
  `;

  const messages = db.prepare(query).all(...EXCLUSIVE_CHANNELS, ZHAO_SENDER_ID);
  console.log(`📊 专属频道赵哥原始发言总数: ${messages.length} 条`);

  // 2. 提取交易动作与要素 (扩展期权、暗语与多空执行词库)
  const BUY_REGEX = /(?:买入|开仓|加仓|建仓|低吸|做多|追|抄底|买点|入场|买call|买put|开call|开put|上了|上车|干了|打了|买了|加了|接了|打底|试仓|小仓位)/i;
  const SELL_REGEX = /(?:卖出|平仓|减仓|止盈|止损|砍仓|走人|清仓|落袋|出掉|割肉|出call|出put|收米|获利|离场|分批走|保本|卖了|走了|清了|出了|减了|止了|跑了|止血|出本|翻倍出)/i;
  
  const TICKER_MAP = [
    [/TSLL|特斯拉两倍|特斯拉双倍/i, 'TSLL'],
    [/TSLA|特斯拉/i, 'TSLA'],
    [/NVDL|英伟达两倍|英伟达双倍/i, 'NVDL'],
    [/NVDA|英伟达/i, 'NVDA'],
    [/SOXL|半导体三倍|半导体/i, 'SOXL'],
    [/QQQ|纳指/i, 'QQQ'],
    [/SPY|标普/i, 'SPY'],
    [/IREN/i, 'IREN'],
    [/NBIS/i, 'NBIS'],
    [/CRWV/i, 'CRWV'],
    [/LITE/i, 'LITE'],
    [/COHR/i, 'COHR'],
    [/MU|美光/i, 'MU'],
    [/AMD/i, 'AMD'],
    [/PLTR/i, 'PLTR'],
    [/SMCI|超微/i, 'SMCI'],
    [/ARM/i, 'ARM'],
    [/AVGO|博通/i, 'AVGO'],
    [/MSTR|微策/i, 'MSTR'],
    [/CONL|COIN|coinbase|币安/i, 'CONL'],
    [/AAPL|苹果/i, 'AAPL'],
    [/AMZN|亚马逊/i, 'AMZN'],
    [/MSFT|微软/i, 'MSFT'],
    [/META/i, 'META'],
    [/GOOGL|谷歌/i, 'GOOGL'],
    [/MARA/i, 'MARA'],
    [/INTC|英特尔/i, 'INTC'],
    [/RDDT/i, 'RDDT']
  ];
  const PRICE_REGEX = /(?:\$|@|\bat\b|\b价格\b|\b现价\b|\b成本\b)?\s*(\d{1,4}(?:\.\d{1,2})?)/i;

  const rawSignals = [];

  for (const msg of messages) {
    const text = String(msg.content || '');
    const isBuy = BUY_REGEX.test(text);
    const isSell = SELL_REGEX.test(text);

    if (!isBuy && !isSell) continue;

    let ticker = null;
    for (const [re, sym] of TICKER_MAP) {
      if (re.test(text)) {
        ticker = sym;
        break;
      }
    }
    if (!ticker) continue;

    const action = isBuy && !isSell ? 'BUY' : isSell && !isBuy ? 'SELL' : (text.indexOf('买') < text.indexOf('卖') ? 'BUY' : 'SELL');

    // 提取价格
    let price = null;
    const priceMatch = text.match(/\$(\d{1,4}(?:\.\d{1,2})?)/) || text.match(PRICE_REGEX);
    if (priceMatch) {
      const p = parseFloat(priceMatch[1]);
      if (Number.isFinite(p) && p > 0.1 && p < 10000) {
        price = p;
      }
    }

    rawSignals.push({
      message_id: msg.id,
      channel_id: msg.channel_id,
      created_at: msg.created_at,
      date_str: new Date(msg.created_at).toISOString().slice(0, 19).replace('T', ' '),
      ticker,
      action,
      price,
      content: text.slice(0, 120).replace(/[\r\n]+/g, ' ')
    });
  }

  console.log(`🎯 提取出结构化交易信号候选: ${rawSignals.length} 笔`);

  // 3. 启发式生命周期配对算法 (Matching Engine)
  const openPositions = {}; // ticker -> array of buy signals
  const closedTrades = [];
  const orphanSells = [];

  for (const sig of rawSignals) {
    const t = sig.ticker;
    if (!openPositions[t]) openPositions[t] = [];

    if (sig.action === 'BUY') {
      openPositions[t].push(sig);
    } else if (sig.action === 'SELL') {
      if (openPositions[t].length > 0) {
        // 匹配最早未闭环的开仓单 (FIFO)
        const buy = openPositions[t].shift();
        const holdDurationHours = ((sig.created_at - buy.created_at) / (1000 * 3600)).toFixed(1);
        let retPct = null;
        if (buy.price && sig.price) {
          retPct = (((sig.price - buy.price) / buy.price) * 100).toFixed(2);
        }
        closedTrades.push({
          ticker: t,
          buy_msg_id: buy.message_id,
          buy_time: buy.date_str,
          buy_price: buy.price,
          sell_msg_id: sig.message_id,
          sell_time: sig.date_str,
          sell_price: sig.price,
          hold_hours: parseFloat(holdDurationHours),
          return_pct: retPct ? parseFloat(retPct) : null,
          buy_snippet: buy.content,
          sell_snippet: sig.content
        });
      } else {
        orphanSells.push(sig);
      }
    }
  }

  const orphanBuys = [];
  for (const t of Object.keys(openPositions)) {
    for (const b of openPositions[t]) {
      orphanBuys.push(b);
    }
  }

  // 4. 统计标的分布与生命周期指标
  const tickerStats = {};
  for (const tr of closedTrades) {
    if (!tickerStats[tr.ticker]) tickerStats[tr.ticker] = { pairs: 0, win: 0, loss: 0, sumRet: 0, withRetCount: 0 };
    tickerStats[tr.ticker].pairs++;
    if (tr.return_pct !== null) {
      tickerStats[tr.ticker].withRetCount++;
      tickerStats[tr.ticker].sumRet += tr.return_pct;
      if (tr.return_pct > 0) tickerStats[tr.ticker].win++;
      else if (tr.return_pct < 0) tickerStats[tr.ticker].loss++;
    }
  }

  const pairedRatio = rawSignals.length > 0 ? (((closedTrades.length * 2) / rawSignals.length) * 100).toFixed(1) : 0;

  const summary = {
    ok: true,
    total_channel_messages: messages.length,
    extracted_signals_count: rawSignals.length,
    completed_round_trips: closedTrades.length,
    orphan_buys_count: orphanBuys.length,
    orphan_sells_count: orphanSells.length,
    lifecycle_pairing_ratio_pct: parseFloat(pairedRatio),
    ticker_stats: tickerStats,
    sample_closed_trades: closedTrades.slice(0, 10),
    sample_orphan_buys: orphanBuys.slice(0, 5),
    sample_orphan_sells: orphanSells.slice(0, 5),
    generated_at: new Date().toISOString()
  };

  const outDir = options.outDir === false ? null : (options.outDir || path.resolve('data/runtime'));
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'trade_lifecycle_summary.json');
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`📁 完整诊断报告已落盘至: ${outPath}\n`);
  }

  console.log(`✅ 生命周期闭环配对单数: ${closedTrades.length} 对`);
  console.log(`⚠️ 孤立开仓单 (未平仓): ${orphanBuys.length} 笔`);
  console.log(`⚠️ 孤立平仓单 (无前序开仓关联): ${orphanSells.length} 笔`);
  console.log(`📈 开平仓配对闭环率: ${pairedRatio}%\n`);

  return summary;
}


if (process.argv[1] && process.argv[1].endsWith('historical_signals_lifecycle_analyzer.js')) {
  analyzeTradeLifecycles();
}
