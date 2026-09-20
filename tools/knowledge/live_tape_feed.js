/**
 * tools/knowledge/live_tape_feed.js
 * 自动驾驶感知总线 (Live Sensor Hub) — 驱动四维共振雷达
 *
 * 职责:
 * 1. 毫秒级汇聚长桥模拟仓实时现价、正股深度盘口与高低点;
 * 2. 汇聚富途 OpenD / GEX Sidecar 的做市商 Gamma 墙分布;
 * 3. 构造标准化四维共振输入特征向量 (Market Sensor Payload);
 * 4. 驱动四维共振决策中枢完成在线实时扫描与 2x 杠杆做多 ETF 动态投影。
 *
 * 安全红线:
 * - 纯只读数据抽取，严禁接入 place_order / 真实下单;
 * - 纯学术与智能驾驶辅助参谋，绝不接 L2a。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Config, QuoteContext } from 'longbridge';
import dotenv from 'dotenv';
import { getDb } from '../../database.js';
import { detectTapeConfluence, projectLeveragedEtfLevels } from './tape_confluence_detector.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const GEX_PATH = path.join(ROOT_DIR, 'data/gex/latest.json');

/**
 * 初始化长桥行情上下文 QuoteContext (单例)
 */
let sharedQuoteCtx = null;
export async function getLiveQuoteContext() {
  if (sharedQuoteCtx) return sharedQuoteCtx;

  const appKey = process.env.LONGBRIDGE_APP_KEY;
  const appSecret = process.env.LONGBRIDGE_APP_SECRET;
  const accessToken = process.env.LONGBRIDGE_ACCESS_TOKEN;

  if (!appKey || !appSecret || !accessToken) {
    throw new Error('MISSING_LONGBRIDGE_CREDENTIALS: LONGBRIDGE_APP_KEY/SECRET/TOKEN required');
  }

  const config = typeof Config.fromApikey === 'function'
    ? Config.fromApikey(appKey, appSecret, accessToken)
    : new Config({ appKey, appSecret, accessToken });

  if (typeof QuoteContext.new === 'function') {
    sharedQuoteCtx = await QuoteContext.new(config);
  } else if (typeof QuoteContext.create === 'function') {
    sharedQuoteCtx = await QuoteContext.create(config);
  } else {
    throw new Error('QuoteContext initialization method not found');
  }

  return sharedQuoteCtx;
}

/**
 * 转换标的代码为长桥 symbol (如 TSLA -> TSLA.US)
 */
export function toLongbridgeSymbol(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (t.includes('.')) return t;
  return `${t}.US`;
}

/**
 * 从盘口 Depth 数据提取微观大单扫盘特征 (Tape Event)
 */
export function deriveTapeEventFromDepth(ticker, currentPrice, depth) {
  if (!depth) return null;
  const asks = depth.asks || [];
  const bids = depth.bids || [];

  const totalBidVol = bids.reduce((acc, b) => acc + (Number(b.volume) || 0), 0);
  const totalAskVol = asks.reduce((acc, a) => acc + (Number(a.volume) || 0), 0);

  // 买卖盘比例
  const imbalance = totalAskVol > 0 ? (totalBidVol / totalAskVol) : 1.0;
  
  // 假定是否有明显的大买单挂单或吃单
  const topBidVol = bids.length > 0 ? Number(bids[0].volume || 0) : 0;
  const topBidAmountUsd = topBidVol * currentPrice;

  // 构造时钟信息 (ET 格式)
  const now = new Date();
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  const etMin = String(now.getUTCMinutes()).padStart(2, '0');
  const timeEt = `${String(etHour).padStart(2, '0')}:${etMin}`;

  return {
    block_buy_usd: topBidAmountUsd,
    imbalance_ratio: parseFloat(imbalance.toFixed(2)),
    is_sweep: imbalance >= 1.8 || topBidAmountUsd >= 500000,
    retail_panic: false,
    time_et: timeEt,
    depth_summary: {
      top_bid: bids[0] ? `${bids[0].price} x ${bids[0].volume}` : 'none',
      top_ask: asks[0] ? `${asks[0].price} x ${asks[0].volume}` : 'none',
    }
  };
}

/**
 * 核心感知函数：批量抓取实时行情并进行多传感器特征融合
 */
export async function fetchLiveMarketSensors(tickers = ['TSLA', 'SPY', 'QQQ', 'NVDA'], options = {}) {
  const quoteCtx = options.quoteCtx || await getLiveQuoteContext();
  const symbols = tickers.map(toLongbridgeSymbol);

  // 1. 实时获取正股 Quote
  const quotes = await quoteCtx.quote(symbols);
  const quoteMap = new Map();
  for (const q of (quotes || [])) {
    const rawTicker = (q.symbol || '').split('.')[0].toUpperCase();
    quoteMap.set(rawTicker, {
      ticker: rawTicker,
      symbol: q.symbol,
      last_price: parseFloat(q.lastDone || '0'),
      prev_close: parseFloat(q.prevClose || '0'),
      high: parseFloat(q.high || '0'),
      low: parseFloat(q.low || '0'),
      volume: parseInt(q.volume || '0', 10),
      timestamp: Date.now(),
    });
  }

  // 2. 依次读取关键标的 Depth 盘口
  const sensors = [];
  for (const t of tickers) {
    const sym = toLongbridgeSymbol(t);
    const q = quoteMap.get(t.toUpperCase());
    if (!q || !q.last_price) continue;

    let depth = null;
    try {
      depth = await quoteCtx.depth(sym);
    } catch (_) {}

    const tapeEvent = deriveTapeEventFromDepth(t, q.last_price, depth);

    sensors.push({
      ticker: t.toUpperCase(),
      quote: q,
      tape_event: tapeEvent,
    });
  }

  return sensors;
}

/**
 * 驱动决策中枢：在线实时扫描四维共振
 */
export async function runOnlineConfluenceScan(tickers = ['TSLA', 'SPY', 'QQQ', 'NVDA', 'IREN', 'NBIS', 'CRWV'], options = {}) {
  const dbInstance = options.dbInstance || getDb();
  const sensors = await fetchLiveMarketSensors(tickers, options);

  let gexSnapshot = null;
  if (fs.existsSync(GEX_PATH)) {
    try {
      gexSnapshot = JSON.parse(fs.readFileSync(GEX_PATH, 'utf8'));
    } catch (_) {}
  }

  const results = [];
  for (const sensor of sensors) {
    const { ticker, quote, tape_event } = sensor;
    
    // 执行四维共振判定
    const report = detectTapeConfluence({
      ticker,
      currentPrice: quote.last_price,
      tapeEvent: tape_event,
      gexSnapshot,
      dbInstance,
    });

    // 杠杆做多 ETF 对应折算
    const leveragedProjections = projectLeveragedEtfLevels(
      ticker,
      {
        underlying_price: quote.last_price,
        gex_wall: report.dimensions.d1_gex_structure.details?.major_wall_price,
        zhao_sr: report.dimensions.d2_zhao_outlook.details?.key_sr_levels?.[0],
      },
      quote.last_price
    );

    results.push({
      ticker,
      current_price: quote.last_price,
      high: quote.high,
      low: quote.low,
      confluence_score: report.total_confluence_score,
      confluence_level: report.confluence_level,
      dimensions: report.dimensions,
      observations: report.observations,
      leveraged_etf: leveragedProjections,
      tape_summary: tape_event?.depth_summary || null,
      detected_at: report.detected_at,
    });
  }

  // 按共振总分降序排列
  results.sort((a, b) => b.confluence_score - a.confluence_score);
  return results;
}
