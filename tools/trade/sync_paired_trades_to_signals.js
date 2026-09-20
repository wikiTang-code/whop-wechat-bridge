#!/usr/bin/env node
/**
 * tools/trade/sync_paired_trades_to_signals.js
 * [DEBT-017] 历史交易信号闭环配对同步落库引擎
 * 
 * 严格遵循安全红线与合规要求：
 * 1. 纯只读隔离实盘，仅操作本地分析表 trade_signals；
 * 2. 大V身份绝对硬锁（user_4yeplXgbguTu4 / xiaozhaolucky）；
 * 3. 交易专属频道严格物理限定：
 *    - 历史股票期权记录区 (forum_feed_1CTr7SqVMzFfuFiiRJLEHN)
 *    - 不用翻墙期权 (chat_feed_1CTrCEx44dP13jW3RVkYiS)
 * 4. 幂等入库（INSERT OR IGNORE），不影响已有信号。
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { analyzeTradeLifecycles, DB_PATH } from './historical_signals_lifecycle_analyzer.js';

export function syncPairedTradesToSignals(db, options = {}) {
  const { apply = false } = options;

  console.log('===========================================================');
  console.log('🚀 [DEBT-017] 历史交易信号闭环配对标准化落库同步');
  console.log(`   模式: ${apply ? 'APPLY (执行落库)' : 'DRY-RUN (仅演练)'}`);
  console.log('===========================================================');

  // 1. 运行生命周期分析器获取闭环交易单
  const summary = analyzeTradeLifecycles(db, options);
  const samplePairs = summary.sample_closed_trades || [];


  // 获取完整闭环交易单对（通过重新提取或者内部分析）
  const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
  const ZHAO_SENDER_NAME = 'xiaozhaolucky';
  const EXCLUSIVE_CHANNELS = [
    'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
    'chat_feed_1CTrCEx44dP13jW3RVkYiS'
  ];

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

  const placeholders = EXCLUSIVE_CHANNELS.map(() => '?').join(',');
  const messages = db.prepare(`
    SELECT id, channel_id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE channel_id IN (${placeholders})
      AND sender_id = ?
    ORDER BY created_at ASC
  `).all(...EXCLUSIVE_CHANNELS, ZHAO_SENDER_ID);

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
      ticker,
      action,
      price: price || 0,
      content: text.slice(0, 100).replace(/[\r\n]+/g, ' ')
    });
  }

  // FIFO 完整闭环配对
  const openPositions = {};
  const allClosedPairs = [];
  for (const sig of rawSignals) {
    const t = sig.ticker;
    if (!openPositions[t]) openPositions[t] = [];
    if (sig.action === 'BUY') {
      openPositions[t].push(sig);
    } else if (sig.action === 'SELL') {
      if (openPositions[t].length > 0) {
        const buy = openPositions[t].shift();
        allClosedPairs.push({ buy, sell: sig });
      }
    }
  }

  console.log(`📦 待同步闭环单据总量: ${allClosedPairs.length} 对 (${allClosedPairs.length * 2} 笔有效信号)`);

  let insertedCount = 0;
  let skippedCount = 0;

  if (apply) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO trade_signals (
        signal_id, message_id, channel_id, speaker_id, speaker_name,
        ticker, action, price, quantity, stop_loss, reason, parse_status, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const pair of allClosedPairs) {
        const buySigId = `sig_pair_${pair.buy.ticker}_${pair.buy.created_at}_B`;
        const sellSigId = `sig_pair_${pair.sell.ticker}_${pair.sell.created_at}_S`;

        // 插入开仓信号
        const r1 = insertStmt.run(
          buySigId,
          pair.buy.message_id,
          pair.buy.channel_id,
          ZHAO_SENDER_ID,
          ZHAO_SENDER_NAME,
          pair.buy.ticker,
          'BUY',
          pair.buy.price,
          100, // 默认标准化份额
          null,
          `[历史配对买入] ${pair.buy.content}`,
          'ok',
          'lifecycle_paired_v1',
          pair.buy.created_at
        );
        if (r1.changes > 0) insertedCount++; else skippedCount++;

        // 插入平仓信号
        const holdHours = ((pair.sell.created_at - pair.buy.created_at) / (1000 * 3600)).toFixed(1);
        const retPct = (pair.buy.price > 0 && pair.sell.price > 0)
          ? (((pair.sell.price - pair.buy.price) / pair.buy.price) * 100).toFixed(1) + '%'
          : 'N/A';

        const r2 = insertStmt.run(
          sellSigId,
          pair.sell.message_id,
          pair.sell.channel_id,
          ZHAO_SENDER_ID,
          ZHAO_SENDER_NAME,
          pair.sell.ticker,
          'SELL',
          pair.sell.price,
          100,
          null,
          `[历史配对卖出 | 持仓 ${holdHours}h | 盈亏: ${retPct} | 对应买入: ${buySigId}] ${pair.sell.content}`,
          'ok',
          'lifecycle_paired_v1',
          pair.sell.created_at
        );
        if (r2.changes > 0) insertedCount++; else skippedCount++;
      }
    })();

    console.log(`✅ 落库完成: 新增 ${insertedCount} 笔, 幂等跳过已有 ${skippedCount} 笔`);
  } else {
    console.log(`💡 [DRY-RUN 演练] 预计可新增或对齐入库 ${allClosedPairs.length * 2} 笔信号。使用 --apply 执行实际入库。`);
  }

  const finalCount = db.prepare('SELECT count(*) as c FROM trade_signals').get().c;
  console.log(`📊 trade_signals 表当前总记录数: ${finalCount} 笔\n`);

  return {
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    pairs_count: allClosedPairs.length,
    signals_count: allClosedPairs.length * 2,
    inserted_count: insertedCount,
    skipped_count: skippedCount,
    final_trade_signals_count: finalCount
  };
}

if (process.argv[1] && process.argv[1].endsWith('sync_paired_trades_to_signals.js')) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const db = new Database(DB_PATH, { readonly: !apply });
  syncPairedTradesToSignals(db, { apply });
  db.close();
}
