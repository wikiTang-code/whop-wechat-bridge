/**
 * tools/knowledge/real_market_confluence_verifier.js
 * 真实券商行情/K线数据 与 做市商GEX/大V点位 绝对空间实测印证器
 *
 * 核心准则:
 * 量化容不得半分马虎，一切用数据说话。
 * 1. 抓取真实市场实时价格、日K高低区间、成交量分布;
 * 2. 对齐大V多模态真实卡片技术点位与做市商GEX结构;
 * 3. 计算绝对空间偏差 (Absolute Mathematical Error Rate);
 * 4. 严禁凭空构造点位，纯数据驱动复核。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { fetchTickerKlineData } from '../../kline.js';
import { getDb } from '../../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const GEX_PATH = path.join(ROOT_DIR, 'data/gex/latest.json');

export async function verifyRealMarketData(tickers = ['TSLA', 'IREN', 'CRWV', 'LITE', 'MU', 'QQQ', 'SPY'], options = {}) {
  const { dbInstance = getDb() } = options;

  console.log('================================================================================');
  console.log('📊 [Real Market Verifier] 真实券商行情/K线数据 ＆ 结构点位绝对空间印证');
  console.log('   核心原则: 拒绝脑补，一切用真实数据说话');
  console.log('================================================================================\n');

  let gexData = null;
  if (fs.existsSync(GEX_PATH)) {
    try {
      gexData = JSON.parse(fs.readFileSync(GEX_PATH, 'utf8'));
    } catch (_) {}
  }

  const reports = [];

  for (const ticker of tickers) {
    const t = ticker.toUpperCase();
    console.log(`🔍 [${t}] 正在从市场获取实时 K 线与盘口基准数据...`);

    let marketKline = null;
    try {
      marketKline = await fetchTickerKlineData(t);
    } catch (err) {
      console.warn(`  ⚠️ 真实市场数据拉取失败 (${t}):`, err.message);
    }

    if (!marketKline) {
      console.log(`  ❌ 跳过 ${t} (无有效券商数据)\n`);
      continue;
    }

    const {
      currentPrice,
      previousClose,
      changePercent,
      high,
      low,
      sma5,
      last5Closes,
    } = marketKline;

    // 1. 检索赵哥真实多模态点位
    const cards = dbInstance
      .prepare(`
        SELECT id, title, schema_json, created_at 
        FROM ontology_card 
        WHERE (tickers_json LIKE ? OR title LIKE ?) AND provider = 'multimodal_vl'
        ORDER BY created_at DESC 
        LIMIT 10
      `)
      .all(`%"${t}"%`, `%${t}%`);

    let closestCardLevel = null;
    let minCardDiff = Infinity;
    let matchedCard = null;

    for (const card of cards) {
      let sr = null;
      try {
        const p = JSON.parse(card.schema_json || '{}');
        sr = p.support_resistance;
      } catch (_) {}

      const levels = [...(sr?.support || []), ...(sr?.resistance || [])];
      for (const lvl of levels) {
        if (typeof lvl === 'number' && lvl > 0) {
          const diff = Math.abs(currentPrice - lvl) / currentPrice;
          if (diff < minCardDiff) {
            minCardDiff = diff;
            closestCardLevel = lvl;
            matchedCard = card;
          }
        }
      }
    }

    // 2. 检索做市商 GEX 墙
    let gexSupport = null;
    let gexResistance = null;
    let gexPutDist = null;
    let gexCallDist = null;

    if (gexData) {
      const targetGex = gexData.zero_dte?.[t] || gexData.matrix?.[t];
      if (targetGex) {
        gexSupport = targetGex.king?.strike;
        gexResistance = targetGex.floor?.strike;
        if (gexSupport) gexPutDist = (Math.abs(currentPrice - gexSupport) / currentPrice * 100).toFixed(2);
        if (gexResistance) gexCallDist = (Math.abs(currentPrice - gexResistance) / currentPrice * 100).toFixed(2);
      }
    }

    // 3. 检索赵哥历史真实交易单实际成交价
    const realTrades = dbInstance
      .prepare(`
        SELECT signal_id, action, price, quantity, created_at 
        FROM trade_signals 
        WHERE ticker = ? AND (channel_id IS NULL OR channel_id IN ('forum_feed_1CTr7SqVMzFfuFiiRJLEHN', 'chat_feed_1CTrCEx44dP13jW3RVkYiS'))
        ORDER BY created_at DESC 
        LIMIT 5
      `)
      .all(t);

    let closestTrade = null;
    let minTradeDiff = Infinity;
    for (const tr of realTrades) {
      if (tr.price > 0) {
        const diff = Math.abs(currentPrice - tr.price) / currentPrice;
        if (diff < minTradeDiff) {
          minTradeDiff = diff;
          closestTrade = tr;
        }
      }
    }

    const itemReport = {
      ticker: t,
      market: {
        realCurrentPrice: currentPrice,
        previousClose,
        changePercent: `${changePercent}%`,
        dayRange: `${low} - ${high}`,
        sma5,
        last5Closes,
      },
      confluence_verification: {
        zhao_multimodal: closestCardLevel
          ? {
              level: closestCardLevel,
              distancePct: `${(minCardDiff * 100).toFixed(2)}%`,
              cardId: matchedCard.id,
              isAccurateWithin2Pct: minCardDiff <= 0.02,
            }
          : '暂无多模态点位',
        gex_option_walls: {
          putWall: gexSupport,
          callWall: gexResistance,
          distanceToPutWall: gexPutDist ? `${gexPutDist}%` : 'N/A',
          distanceToCallWall: gexCallDist ? `${gexCallDist}%` : 'N/A',
        },
        real_executed_trades: closestTrade
          ? {
              signalId: closestTrade.signal_id,
              action: closestTrade.action,
              tradePrice: closestTrade.price,
              distanceToRealMarket: `${(minTradeDiff * 100).toFixed(2)}%`,
            }
          : '两大专属频道暂无历史单',
      },
    };

    console.log(`📌 标的: ${t}`);
    console.log(`   🟢 真实市场现价: $${currentPrice} (${changePercent}%) | 日区间: $${low} - $${high} | 5日均线: $${sma5}`);
    if (closestCardLevel) {
      console.log(`   📐 多模态卡片点位: $${closestCardLevel} [卡片: ${matchedCard.id}] -> 实际空间偏差: ${(minCardDiff * 100).toFixed(2)}% ${minCardDiff <= 0.02 ? '✅ [高精对齐]' : ''}`);
    }
    if (gexSupport) {
      console.log(`   🛡️ 做市商 GEX 支撑 (Put Wall): $${gexSupport} -> 实际空间偏差: ${gexPutDist}%`);
    }
    if (closestTrade) {
      console.log(`   💰 赵哥历史真实单: [${closestTrade.signal_id}] ${closestTrade.action} @ $${closestTrade.price} -> 距离现价偏差: ${(minTradeDiff * 100).toFixed(2)}%`);
    }
    console.log('--------------------------------------------------------------------------------');

    reports.push(itemReport);
  }

  return reports;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyRealMarketData();
}
