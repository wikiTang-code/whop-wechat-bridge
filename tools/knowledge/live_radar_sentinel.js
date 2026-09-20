#!/usr/bin/env node
/**
 * tools/knowledge/live_radar_sentinel.js
 * 美股盘中持续在线感知哨兵 (Live Radar Sentinel Daemon)
 *
 * 核心设计:
 * 1. 默认不间断持续监测美股标的池四维共振;
 * 2. 智能美股时段感知 (开市监测，休市自动休眠避免空耗 API 额度与算力);
 * 3. 尾盘黄金窗口 (15:30 - 16:00 ET) 自动升频至 15 秒高频扫盘;
 * 4. 出现重大共振事件自动持久化至 confluence_radar_events 表，供驾驶舱与回测复盘;
 * 5. 纯只读安全红线: 绝不生成实盘 BUY/SELL 下单，严禁接入 L2a。
 *
 * 启动方式:
 *   node tools/knowledge/live_radar_sentinel.js
 *   node tools/knowledge/live_radar_sentinel.js --force-open
 *   node tools/knowledge/live_radar_sentinel.js --once
 */

import dotenv from 'dotenv';
import { getDb, ensureRadarEventsTable } from '../../database.js';
import { getUsMarketSession, getNextActiveWaitMs, getRecommendedPollIntervalMs } from './market_session.js';
import { runOnlineConfluenceScan, getLiveQuoteContext } from './live_tape_feed.js';
import { pushRadarAlert } from './radar_alert_pusher.js';
import { appendForwardEventWindowBar, ensureEventWindowBarsTable } from '../../scripts/knowledge/train_recent_60d_microstructure.js';

dotenv.config();

const DEFAULT_TICKERS = ['TSLA', 'SPY', 'QQQ', 'NVDA', 'IREN', 'NBIS', 'CRWV'];
const RTH_INTERVAL_MS = 15 * 1000;         // 常规盘中 15 秒
const HIGH_FREQ_INTERVAL_MS = 5 * 1000;    // 开盘首小时与尾盘强平 5 秒超高频扫盘
const OFF_HOURS_INTERVAL_MS = 45 * 1000;   // 盘前盘后 45 秒

// 命令行参数解析
const args = process.argv.slice(2);
const forceOpen = args.includes('--force-open');
const runOnce = args.includes('--once');
const customIntervalArg = args.indexOf('--interval');
const customInterval = customIntervalArg >= 0 ? parseInt(args[customIntervalArg + 1], 10) : null;

let isRunning = true;

// 态势感知最新内存快照 (供 Web HUD 与只读 API 毫秒级提取)
let latestRadarSnapshot = {
  updated_at: null,
  market_session: null,
  results: [],
};

export function getLatestRadarSnapshot() {
  return latestRadarSnapshot;
}

export async function fetchLatestOrComputeRadar(options = {}) {
  const now = Date.now();
  if (latestRadarSnapshot.updated_at && now - latestRadarSnapshot.updated_at < 30000) {
    return latestRadarSnapshot;
  }
  const db = options.dbInstance || getDb();
  const tickers = options.tickers || DEFAULT_TICKERS;
  const session = getUsMarketSession(new Date());
  try {
    const scanResults = await runOnlineConfluenceScan(tickers, { dbInstance: db });
    latestRadarSnapshot = {
      updated_at: now,
      market_session: session,
      results: scanResults,
    };
  } catch (err) {
    console.warn('[Sentinel] fetchLatestOrComputeRadar 快速扫描跳过:', err.message);
  }
  return latestRadarSnapshot;
}

// 优雅退出处理
process.on('SIGINT', () => {
  console.log('\n[Sentinel] 🛑 收到 SIGINT 信号，正在平稳退出在线感知哨兵...');
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Sentinel] 🛑 收到 SIGTERM 信号，正在平稳退出在线感知哨兵...');
  isRunning = false;
  process.exit(0);
});

export async function runSentinelLoop(options = {}) {
  const db = options.dbInstance || getDb();
  ensureRadarEventsTable(db);
  ensureEventWindowBarsTable(db);

  const tickers = options.tickers || DEFAULT_TICKERS;
  console.log('================================================================================');
  console.log('🛰️ [Live Radar Sentinel] 美股盘中不间断在线感知哨兵启动');
  console.log(`📌 监控标的池: [${tickers.join(', ')}]`);
  console.log(`⚙️ 运行模式: ${forceOpen ? 'FORCE_OPEN (强制开市测试)' : 'AUTO_MARKET_AWARE (时段自动感知)'}`);
  console.log('================================================================================\n');

  // 预热长桥行情连接
  let quoteCtx = null;
  try {
    quoteCtx = options.quoteCtx || await getLiveQuoteContext();
    console.log('[Sentinel] ✅ 券商行情通道连接成功');
  } catch (err) {
    console.warn(`[Sentinel] ⚠️ 券商通道预热告警: ${err.message} (稍后将自动重试)`);
  }

  const insertEventStmt = db.prepare(`
    INSERT OR REPLACE INTO confluence_radar_events (
      id, ticker, current_price, confluence_score, confluence_level,
      dimensions_json, observations_json, leveraged_etf_json, created_at
    ) VALUES (
      @id, @ticker, @current_price, @confluence_score, @confluence_level,
      @dimensions_json, @observations_json, @leveraged_etf_json, @created_at
    )
  `);

  let cycleCount = 0;

  while (isRunning) {
    cycleCount += 1;
    const now = new Date();
    const marketState = getUsMarketSession(now);

    // 1. 检查是否在休市时段且未开启强制开盘
    if (!marketState.isOpen && !forceOpen) {
      const waitMs = getNextActiveWaitMs(now);
      const waitMinutes = (waitMs / 60000).toFixed(1);
      console.log(`[Sentinel] 🌙 美股当前休市: ${marketState.description}`);
      console.log(`           系统进入低功耗待机，休眠等待 ${waitMinutes} 分钟后重新感知...\n`);
      
      if (runOnce) break;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    // 2. 开盘交易时段：执行实时感知与四维共振决策
    console.log(`[Sentinel Cycle #${cycleCount}] ⏱️ ${marketState.description}`);
    const startMs = Date.now();

    try {
      const scanResults = await runOnlineConfluenceScan(tickers, {
        dbInstance: db,
        quoteCtx,
      });

      latestRadarSnapshot = {
        updated_at: Date.now(),
        market_session: marketState,
        results: scanResults,
      };

      const elapsed = Date.now() - startMs;
      console.log(`[Sentinel Cycle #${cycleCount}] 🎯 完成 ${scanResults.length} 个标的四维感知与投影 (耗时 ${elapsed}ms):`);

      for (const res of scanResults) {
        const flag = res.confluence_score >= 80 ? '🔥 [王炸共振]' : (res.confluence_score >= 60 ? '⚡ [高共振]' : '• [常规]');
        console.log(`  ${flag} ${res.ticker}: $${res.current_price} | 总分: ${res.confluence_score} (${res.confluence_level})`);
        
        if (res.leveraged_etf) {
          console.log(`     ↳ 战车联动: ${res.leveraged_etf.name} (${res.leveraged_etf.etf}) 锚点: $${res.leveraged_etf.etf_current_price}`);
        }

        // 高共振事件持久化
        if (res.confluence_score >= 60) {
          const eventId = `radar_${res.ticker}_${Date.now()}`;
          insertEventStmt.run({
            id: eventId,
            ticker: res.ticker,
            current_price: res.current_price,
            confluence_score: res.confluence_score,
            confluence_level: res.confluence_level,
            dimensions_json: JSON.stringify(res.dimensions),
            observations_json: JSON.stringify(res.observations),
            leveraged_etf_json: JSON.stringify(res.leveraged_etf),
            created_at: Date.now(),
          });
          console.log(`     📝 [事件沉淀] 高分共振已落库: ${eventId}`);

          // REQ-046: 盘中高置信度共振预警企微卡片推送 (防抖防刷屏)
          pushRadarAlert(res).catch((err) => {
            console.warn(`     ⚠️ [预警推送告警] ${res.ticker} 企微推送异常:`, err.message);
          });

          // 路径3: 盘中前瞻滚雪球 (自动累积微观 15m 高频事件切片样本)
          appendForwardEventWindowBar(db, {
            eventId,
            symbol: res.ticker,
            t0: Date.now(),
            interval: '15m'
          }).then((cnt) => {
            if (cnt > 0) console.log(`     📥 [前瞻高频落盘] ${res.ticker} 切片已增量存储至 event_window_bars (${cnt} 根)`);
          }).catch(() => {});
        }
      }
    } catch (scanErr) {
      console.error(`[Sentinel Cycle #${cycleCount}] ❌ 本轮感知扫描异常:`, scanErr.message);
    }

    if (runOnce) {
      console.log('\n[Sentinel] --once 参数生效，单轮执行完毕退出。');
      break;
    }

    // 3. 动态决定下一轮巡检间隔 (根据夜盘/盘前/盘中/尾盘自动调频)
    const nextInterval = customInterval || getRecommendedPollIntervalMs(marketState);

    console.log(`[Sentinel] ⏳ 时段 [${marketState.session}] 等待 ${nextInterval / 1000} 秒后开始下一轮感知...\n`);
    await new Promise((resolve) => setTimeout(resolve, nextInterval));
  }
}

// 直接以 CLI 形式运行
if (process.argv[1] && process.argv[1].endsWith('live_radar_sentinel.js')) {
  runSentinelLoop().catch((e) => {
    console.error('Fatal Sentinel Error:', e);
    process.exit(1);
  });
}
