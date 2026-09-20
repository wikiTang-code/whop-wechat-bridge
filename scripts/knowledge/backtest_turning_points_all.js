import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';
import {
  detectSpikeTurnDown,
  detectPlungeTurnUp
} from '../../tools/trade/turning_detector.js';

async function runBacktest() {
  const db = getReadOnlyArchiveDb();
  console.log('=== 开始全量历史交易切片微观拐点回测 (All 1,512 Events) ===\n');

  const events = db.prepare(`
    SELECT DISTINCT event_id, symbol, t0
    FROM event_window_bars
    WHERE interval = '15m'
    ORDER BY t0 ASC
  `).all();

  console.log(`载入历史事件切片总数: ${events.length} 个`);

  const stats = {
    totalEvents: events.length,
    buyEvents: 0,
    sellEvents: 0,
    otherEvents: 0,
    buyMatches: {
      plungeDetected: 0,
      detectedPriorToT0: 0,
      detectedAtT0: 0,
      detectedAfterT0: 0,
      detectionRate: '0%',
      avgPlungeRet: '0%',
      avgReboundConfirm: '0%',
    },
    sellMatches: {
      spikeDetected: 0,
      detectedPriorToT0: 0,
      detectedAtT0: 0,
      detectedAfterT0: 0,
      detectionRate: '0%',
      avgSpikeRet: '0%',
      avgRetraceConfirm: '0%',
    },
    falsePositives: {
      spikeInBuyWindow: 0,
      plungeInSellWindow: 0
    }
  };

  let totalBuyPlungeSum = 0;
  let totalBuyReboundSum = 0;
  let totalSellSpikeSum = 0;
  let totalSellRetraceSum = 0;

  for (const ev of events) {
    const isBuy = ev.event_id.endsWith('_B') || ev.event_id.includes('BUY') || ev.event_id.includes('_B_');
    const isSell = ev.event_id.endsWith('_S') || ev.event_id.includes('SELL') || ev.event_id.includes('_S_');
    
    if (isBuy) stats.buyEvents++;
    else if (isSell) stats.sellEvents++;
    else stats.otherEvents++;

    const bars = db.prepare(`
      SELECT bar_time as time, open, high, low, close, volume
      FROM event_window_bars
      WHERE event_id = ?
      ORDER BY bar_time ASC
    `).all(ev.event_id);

    if (bars.length < 5) continue;
    const t0 = ev.t0;

    let plungeFound = false;
    let spikeFound = false;

    for (let endIdx = 3; endIdx < bars.length; endIdx++) {
      const windowBars = bars.slice(Math.max(0, endIdx - 8), endIdx + 1);
      const evalTime = windowBars[windowBars.length - 1].time;

      if (!plungeFound) {
        const resP = detectPlungeTurnUp(windowBars, {
          symbol: ev.symbol,
          minPlungeRatio: 0.02,
          minReboundRatio: 0.006
        });
        if (resP.detected) {
          plungeFound = true;
          const lagMinutes = Math.round((evalTime - t0) / 60000);
          totalBuyPlungeSum += Math.abs(resP.event.impulse.ret);
          totalBuyReboundSum += resP.event.confirm.retrace_from_extreme;
          
          if (isBuy) {
            stats.buyMatches.plungeDetected++;
            if (lagMinutes < -5) stats.buyMatches.detectedPriorToT0++;
            else if (lagMinutes <= 15) stats.buyMatches.detectedAtT0++;
            else stats.buyMatches.detectedAfterT0++;
          } else if (isSell) {
            stats.falsePositives.plungeInSellWindow++;
          }
        }
      }

      if (!spikeFound) {
        const resS = detectSpikeTurnDown(windowBars, {
          symbol: ev.symbol,
          minSpikeRatio: 0.03,
          minRetraceRatio: 0.008
        });
        if (resS.detected) {
          spikeFound = true;
          const lagMinutes = Math.round((evalTime - t0) / 60000);
          totalSellSpikeSum += Math.abs(resS.event.impulse.ret);
          totalSellRetraceSum += resS.event.confirm.retrace_from_extreme;

          if (isSell) {
            stats.sellMatches.spikeDetected++;
            if (lagMinutes < -5) stats.sellMatches.detectedPriorToT0++;
            else if (lagMinutes <= 15) stats.sellMatches.detectedAtT0++;
            else stats.sellMatches.detectedAfterT0++;
          } else if (isBuy) {
            stats.falsePositives.spikeInBuyWindow++;
          }
        }
      }
    }
  }

  if (stats.buyEvents > 0) {
    stats.buyMatches.detectionRate = (stats.buyMatches.plungeDetected / stats.buyEvents * 100).toFixed(1) + '%';
  }
  if (stats.sellEvents > 0) {
    stats.sellMatches.detectionRate = (stats.sellMatches.spikeDetected / stats.sellEvents * 100).toFixed(1) + '%';
  }
  if (stats.buyMatches.plungeDetected > 0) {
    stats.buyMatches.avgPlungeRet = (totalBuyPlungeSum / stats.buyMatches.plungeDetected * 100).toFixed(2) + '%';
    stats.buyMatches.avgReboundConfirm = (totalBuyReboundSum / stats.buyMatches.plungeDetected * 100).toFixed(2) + '%';
  }
  if (stats.sellMatches.spikeDetected > 0) {
    stats.sellMatches.avgSpikeRet = (totalSellSpikeSum / stats.sellMatches.spikeDetected * 100).toFixed(2) + '%';
    stats.sellMatches.avgRetraceConfirm = (totalSellRetraceSum / stats.sellMatches.spikeDetected * 100).toFixed(2) + '%';
  }

  console.log('=== 全量回测结果统计 ===');
  console.log(JSON.stringify(stats, null, 2));

  const outPath = path.resolve('data/runtime/backtest_turning_all_results.json');
  fs.writeFileSync(outPath, JSON.stringify(stats, null, 2), 'utf8');
  console.log(`\n✅ 全量统计结果已成功落盘至: ${outPath}`);
}

runBacktest().catch(err => {
  console.error('回测异常:', err);
  process.exit(1);
});
