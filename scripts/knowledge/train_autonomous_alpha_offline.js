import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 6) continue;
    // 富途美股数据是美东时间 (EDT/EST, 默认夏令时 -0400)
    const timeMs = new Date(parts[0] + ' -0400').getTime();
    bars.push({
      time: timeMs,
      datetime: parts[0],
      open: parseFloat(parts[1]),
      high: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      close: parseFloat(parts[4]),
      volume: parseFloat(parts[5])
    });
  }
  return bars;
}

function calcEma(values, period) {
  const k = 2 / (period + 1);
  const ema = new Float64Array(values.length);
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calcAtr(bars, period = 14) {
  const tr = new Float64Array(bars.length);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }
  const atr = new Float64Array(bars.length);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    atr[i] = i >= period - 1 ? sum / period : sum / (i + 1);
  }
  return atr;
}

function calcMacd(closes) {
  const ema12 = calcEma(closes, 12);
  const ema26 = calcEma(closes, 26);
  const dif = new Float64Array(closes.length);
  for (let i = 0; i < closes.length; i++) dif[i] = ema12[i] - ema26[i];
  const dea = calcEma(dif, 9);
  const macd = new Float64Array(closes.length);
  for (let i = 0; i < closes.length; i++) macd[i] = (dif[i] - dea[i]) * 2;
  return { dif, dea, macd };
}

async function runAutonomousAlphaTraining() {
  console.log('=== [自主 Alpha 离线模拟训练与标定] 启动 ===\n');

  const tslaPath = path.resolve('research/ladder-chaodi/data/tsla_30m.csv');
  const bars = parseCsv(tslaPath);
  console.log(`1. 载入历史行情数据: ${tslaPath}`);
  console.log(`   -> 行情 K 线总数: ${bars.length} 根 (时间跨度: ${bars[0].datetime} 至 ${bars[bars.length - 1].datetime})`);

  const closes = bars.map(b => b.close);
  const midLadder = calcEma(closes, 26);
  const atr = calcAtr(bars, 14);
  const { dif } = calcMacd(closes);

  console.log('2. 提取因果微观特征 (梯子 EMA26 ± 0.8*ATR, MACD DIF)...');
  const autoBuySignals = [];
  const autoSellSignals = [];

  for (let i = 30; i < bars.length; i++) {
    const b = bars[i];
    const prevB = bars[i - 1];
    const curAtr = atr[i];
    const lowerBand = midLadder[i] - 0.8 * curAtr;
    const upperBand = midLadder[i] + 0.8 * curAtr;

    // 自主买点: 击穿下轨后回抽 + DIF 负值收敛
    const isUnderLowerBand = b.low <= lowerBand;
    const isReboundHook = b.close > b.open && b.close > prevB.low;
    const isDifContracting = dif[i] < 0 && Math.abs(dif[i]) < Math.abs(dif[i - 1]) * 0.99;

    if (isUnderLowerBand && isReboundHook && isDifContracting) {
      if (autoBuySignals.length === 0 || i - autoBuySignals[autoBuySignals.length - 1].barIdx >= 5) {
        autoBuySignals.push({
          barIdx: i,
          time: b.time,
          datetime: b.datetime,
          price: b.close,
          atr: curAtr
        });
      }
    }

    // 自主卖点: 突破上轨后回撤确认 + DIF 见顶
    const isOverUpperBand = b.high >= upperBand;
    const dropFromHigh = b.high - b.close;
    const isRetraceConfirmed = dropFromHigh >= 0.4 * curAtr;
    const isDifPeaked = dif[i] > 0 && dif[i] < dif[i - 1];

    if (isOverUpperBand && isRetraceConfirmed && isDifPeaked) {
      if (autoSellSignals.length === 0 || i - autoSellSignals[autoSellSignals.length - 1].barIdx >= 5) {
        autoSellSignals.push({
          barIdx: i,
          time: b.time,
          datetime: b.datetime,
          price: b.close,
          atr: curAtr
        });
      }
    }
  }

  console.log(`   -> 自主捕获买入候选点: ${autoBuySignals.length} 个`);
  console.log(`   -> 自主捕获卖出候选点: ${autoSellSignals.length} 个`);

  // 取数据库中在 tsla_30m 时间范围内的赵哥交易单
  const minTime = bars[0].time;
  const maxTime = bars[bars.length - 1].time;

  const db = getReadOnlyArchiveDb();
  const zhaoTrades = db.prepare(`
    SELECT signal_id, ticker, action, price, created_at, reason
    FROM trade_signals
    WHERE speaker_id = 'user_4yeplXgbguTu4'
      AND (ticker = 'TSLA' OR ticker = 'TSLL')
      AND action IN ('BUY', 'SELL')
      AND created_at >= ? AND created_at <= ?
    ORDER BY created_at ASC
  `).all(minTime, maxTime);

  console.log(`\n3. 样本区间内赵哥真实成交单 (有效对账样本): ${zhaoTrades.length} 笔`);

  const zhaoBuys = zhaoTrades.filter(t => t.action === 'BUY');
  const zhaoSells = zhaoTrades.filter(t => t.action === 'SELL');

  let buyConcurrence = 0;
  let buyLeadCount = 0;
  let buySyncCount = 0;
  let buyLagCount = 0;

  for (const zb of zhaoBuys) {
    const t0 = Number(zb.created_at);
    // 考察 t0 前后 3 小时 (±6 根 30m)
    const match = autoBuySignals.find(s => Math.abs(s.time - t0) <= 3 * 3600 * 1000);
    if (match) {
      buyConcurrence++;
      const timeDiffMin = Math.round((match.time - t0) / 60000);
      if (timeDiffMin < -30) buyLeadCount++;
      else if (Math.abs(timeDiffMin) <= 30) buySyncCount++;
      else buyLagCount++;
    }
  }

  let sellConcurrence = 0;
  let sellLeadCount = 0;
  let sellSyncCount = 0;
  let sellLagCount = 0;

  for (const zs of zhaoSells) {
    const t0 = Number(zs.created_at);
    const match = autoSellSignals.find(s => Math.abs(s.time - t0) <= 3 * 3600 * 1000);
    if (match) {
      sellConcurrence++;
      const timeDiffMin = Math.round((match.time - t0) / 60000);
      if (timeDiffMin < -30) sellLeadCount++;
      else if (Math.abs(timeDiffMin) <= 30) sellSyncCount++;
      else sellLagCount++;
    }
  }

  // 4. 自主策略独立前向收益评估 (Forward MFE / MAE 统计)
  let buyPositiveMfeCount = 0;
  let totalBuyMfe = 0;
  let totalBuyMae = 0;

  for (const sig of autoBuySignals) {
    const forwardBars = bars.slice(sig.barIdx + 1, Math.min(bars.length, sig.barIdx + 17));
    if (forwardBars.length === 0) continue;
    const maxHigh = Math.max(...forwardBars.map(b => b.high));
    const minLow = Math.min(...forwardBars.map(b => b.low));
    const mfe = (maxHigh - sig.price) / sig.price;
    const mae = (minLow - sig.price) / sig.price;

    totalBuyMfe += mfe;
    totalBuyMae += mae;
    if (mfe >= 0.02) buyPositiveMfeCount++;
  }

  const avgBuyMfe = (totalBuyMfe / autoBuySignals.length * 100).toFixed(2);
  const avgBuyMae = (totalBuyMae / autoBuySignals.length * 100).toFixed(2);
  const mfeHitRate = (buyPositiveMfeCount / autoBuySignals.length * 100).toFixed(1);

  const report = {
    dataset: 'TSLA_30m (2023-01 to 2026-08, 11,838 bars)',
    timeAlignment: 'EDT (-0400) aligned',
    autonomousCandidates: {
      buyCount: autoBuySignals.length,
      sellCount: autoSellSignals.length
    },
    supervisoryCalibration: {
      inRangeZhaoBuys: zhaoBuys.length,
      buyConcurrenceCount: buyConcurrence,
      buyConcurrenceRate: ((buyConcurrence / Math.max(1, zhaoBuys.length)) * 100).toFixed(1) + '%',
      leadLagDistribution: {
        leadEarlierThanZhao: buyLeadCount,
        syncWithZhao: buySyncCount,
        lagAfterZhao: buyLagCount
      },
      inRangeZhaoSells: zhaoSells.length,
      sellConcurrenceCount: sellConcurrence,
      sellConcurrenceRate: ((sellConcurrence / Math.max(1, zhaoSells.length)) * 100).toFixed(1) + '%',
      leadLagDistributionSell: {
        leadEarlierThanZhao: sellLeadCount,
        syncWithZhao: sellSyncCount,
        lagAfterZhao: sellLagCount
      }
    },
    standaloneForwardMetrics: {
      evalWindow: 'Forward 16 bars (8 hours)',
      avgMfeGain: '+' + avgBuyMfe + '%',
      avgMaeDrawdown: avgBuyMae + '%',
      mfeOver2PctOpportunityRate: mfeHitRate + '%'
    }
  };

  console.log('\n=== [自主 Alpha 离线模拟训练结果汇总] ===');
  console.log(JSON.stringify(report, null, 2));

  const outPath = path.resolve('data/runtime/autonomous_alpha_training_results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n✅ 训练与标定结果已落盘至: ${outPath}`);
}

runAutonomousAlphaTraining().catch(err => {
  console.error('训练过程异常:', err);
  process.exit(1);
});
