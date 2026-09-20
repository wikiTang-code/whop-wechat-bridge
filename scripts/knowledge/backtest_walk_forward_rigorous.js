import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';

/**
 * scripts/knowledge/backtest_walk_forward_rigorous.js
 * 
 * [工业级严格因果 Walk-Forward 微观 Alpha 回测引擎]
 * 彻底整改 8 大方法学硬伤:
 * 1. 滚动自适应: 拒绝全样本未来ATR均值，使用 past-only 滚动 100-bar 波动率 Z-Score;
 * 2. 补齐代码疏漏: isVolAccum 真实进入判定 (volume >= 1.2 * volEma20);
 * 3. 严格因果成交: 当根收盘确认，次根 open 入场，扣除双边 10 bps (0.10%) 摩擦;
 * 4. 杜绝同根偏误: 冲动与回撤仅使用已走完的前前根与前根极值，不用当前未收盘 bar;
 * 5. 严格 Walk-Forward: 前 40 天 (In-Sample) 冻结规则，后 20 天 (Out-of-Sample) 纯盲测;
 * 6. 对账窗收窄: 废弃 ±2h，严查 5m / 15m / 30m 真实精准共振，拆分 Precision / Recall / Lead;
 * 7. 真实出场: 脉冲回吐移动止盈 vs 固定时间波段 分立报表;
 * 8. 事件级落盘: 产出 backtest_rigorous_events.jsonl。
 */

function parseCached5m(symbol) {
  const cacheFile = path.resolve(`data/runtime/${symbol}_5m_60d.json`);
  if (!fs.existsSync(cacheFile)) throw new Error(`未找到缓存文件: ${cacheFile}`);
  return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
}

function calcEma(values, period) {
  const k = 2 / (period + 1);
  const ema = new Float64Array(values.length);
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) ema[i] = values[i] * k + ema[i - 1] * (1 - k);
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

async function runRigorousBacktest() {
  console.log('=== [工业级严格因果 Walk-Forward 回测引擎] 启动 ===\n');

  // 以 SOXL 作为一号基准标的 (三倍杠杆高频代表)
  const symbol = 'SOXL';
  const bars = parseCached5m(symbol);
  console.log(`载入 ${symbol} 5m K线: ${bars.length} 根`);

  const closes = bars.map(b => b.close);
  const midLadder = calcEma(closes, 26);
  const atr = calcAtr(bars, 14);
  const { dif } = calcMacd(closes);
  const volEma20 = calcEma(bars.map(b => b.volume), 20);

  // 划分 In-Sample (前 40 天, 约 3120 根) 与 Out-of-Sample (后 20 天, 剩余约 1560 根)
  const isSplitIdx = Math.floor(bars.length * (40 / 60));
  console.log(`样本划分: In-Sample 前 ${isSplitIdx} 根 (前40天) | Out-of-Sample 后 ${bars.length - isSplitIdx} 根 (后20天)`);
  console.log(`OOS 起始时间: ${bars[isSplitIdx].datetime}\n`);

  // 调取赵哥在此期间真实的 SOXL 买单 (严格时间戳)
  const db = getReadOnlyArchiveDb();
  const minT = bars[0].time;
  const maxT = bars[bars.length - 1].time;
  const zhaoBuys = db.prepare(`
    SELECT signal_id, price, created_at
    FROM trade_signals
    WHERE speaker_id = 'user_4yeplXgbguTu4'
      AND ticker = ?
      AND action = 'BUY'
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(symbol, minT, maxT);
  console.log(`调取赵哥 ${symbol} 真实买单监督样本: ${zhaoBuys.length} 笔\n`);

  // 信号检测 (严格单向滚动因果)
  const executedTrades = [];
  const COST_BPS = 0.0010; // 双边来回 10 bps (0.10%) 摩擦与滑点

  // 滚动计算过去 100 根的 ATR/Close 分布 (过去式 Z-score)
  for (let i = 100; i < bars.length - 25; i++) {
    const b = bars[i];
    const prev = bars[i - 1];

    // 1. 严格 Past-Only 滚动波动率分位数
    let rollingSum = 0;
    let rollingSqSum = 0;
    const windowLen = 100;
    for (let k = i - windowLen; k < i; k++) {
      const r = atr[k] / closes[k];
      rollingSum += r;
      rollingSqSum += r * r;
    }
    const rollingMean = rollingSum / windowLen;
    const rollingStd = Math.sqrt(Math.max(1e-8, (rollingSqSum / windowLen) - (rollingMean * rollingMean)));
    const curRatio = atr[i] / closes[i];
    const zScore = (curRatio - rollingMean) / rollingStd;
    // 自适应系数 k: 1.0 + 0.15 * clamp(Z, -1, 1) -> 范围 [0.85, 1.15]
    const kBand = 1.0 + 0.15 * Math.max(-1, Math.min(1, zScore));

    const lowerBand = midLadder[i] - kBand * atr[i];

    // 2. 真实买入条件 (补齐代码漏洞):
    // - 当根低点击穿下轨
    // - 微观 Higher-Low: 当根 low >= prev.low 且收盘为阳线
    // - 量能吸筹严格生效: 当根量能 >= 1.2倍均量 或 前根 >= 1.2倍
    // - MACD DIF 拐头向上
    const isOversold = b.low <= lowerBand;
    const isHigherLow = b.low >= prev.low && b.close > prev.close && b.close > b.open;
    const isVolConfirmed = b.volume >= 1.2 * volEma20[i] || prev.volume >= 1.2 * volEma20[i - 1];
    const isMacdHook = dif[i] > dif[i - 1];

    if (isOversold && isHigherLow && isVolConfirmed && isMacdHook) {
      // 冷却防抖: 12 根 (1小时内) 不重复触发
      const lastTrade = executedTrades[executedTrades.length - 1];
      if (lastTrade && i - lastTrade.confirmBarIdx < 12) continue;

      // 3. 严格因果入场: 当根 i 确认，次根 i+1 open 成交
      const entryBar = bars[i + 1];
      const entryPrice = entryBar.open * (1 + COST_BPS / 2); // 买入加半程滑点

      // 4. 模拟出场:
      // 出场 A: 固定 24 根 (2小时) 持有
      const fixedExitBar = bars[i + 1 + 24];
      const fixedExitPrice = fixedExitBar.close * (1 - COST_BPS / 2);
      const fixedNetRet = (fixedExitPrice - entryPrice) / entryPrice;

      // 出场 B: 相对脉冲移动止盈 (前向最高点回撤 38.2% 或破入场低点止损)
      let dynamicExitPrice = fixedExitPrice;
      let dynamicExitReason = 'TIME_EXPIRE';
      let peakPrice = entryPrice;
      const initialStopLoss = Math.min(b.low, prev.low);

      for (let f = i + 2; f <= i + 1 + 24; f++) {
        const curBar = bars[f];
        if (curBar.high > peakPrice) peakPrice = curBar.high;
        const curPulse = peakPrice - entryPrice;

        // 跌破入场低点止损
        if (curBar.low < initialStopLoss) {
          dynamicExitPrice = initialStopLoss * (1 - COST_BPS / 2);
          dynamicExitReason = 'STOP_LOSS';
          break;
        }
        // 冲高回落 38.2% 脉冲移动止盈
        if (curPulse >= 1.0 * atr[i] && (peakPrice - curBar.close) >= 0.382 * curPulse) {
          dynamicExitPrice = curBar.close * (1 - COST_BPS / 2);
          dynamicExitReason = 'TRAIL_STOP_382';
          break;
        }
      }
      const dynamicNetRet = (dynamicExitPrice - entryPrice) / entryPrice;

      // 前向实际 MFE 与 MAE (扣成本)
      const forwardSlice = bars.slice(i + 1, i + 1 + 25);
      const forwardMaxH = Math.max(...forwardSlice.map(x => x.high));
      const forwardMinL = Math.min(...forwardSlice.map(x => x.low));
      const netMfe = (forwardMaxH - entryPrice) / entryPrice;
      const netMae = (forwardMinL - entryPrice) / entryPrice;

      // 5. 与赵哥对账 (收窄窗口: 5m, 15m, 30m)
      let match5m = false;
      let match15m = false;
      let match30m = false;
      let leadMinutes = null;

      for (const zb of zhaoBuys) {
        const t0 = Number(zb.created_at);
        const timeDiffMs = entryBar.time - t0;
        const diffMin = Math.round(timeDiffMs / 60000);
        if (Math.abs(diffMin) <= 5) match5m = true;
        if (Math.abs(diffMin) <= 15) match15m = true;
        if (Math.abs(diffMin) <= 30) {
          match30m = true;
          leadMinutes = -diffMin; // 正数代表比赵哥提前，负数代表滞后
        }
      }

      executedTrades.push({
        confirmBarIdx: i,
        entryTime: entryBar.time,
        entryDatetime: entryBar.datetime,
        entryPrice,
        kBand: Number(kBand.toFixed(3)),
        zScore: Number(zScore.toFixed(2)),
        isSampleType: i < isSplitIdx ? 'IN_SAMPLE' : 'OUT_OF_SAMPLE',
        fixedNetRet,
        dynamicNetRet,
        dynamicExitReason,
        netMfe,
        netMae,
        match5m,
        match15m,
        match30m,
        leadMinutes
      });
    }
  }

  // 统计 IS vs OOS
  const isTrades = executedTrades.filter(t => t.isSampleType === 'IN_SAMPLE');
  const oosTrades = executedTrades.filter(t => t.isSampleType === 'OUT_OF_SAMPLE');

  function summarize(trades, zhaoSubList, label) {
    if (trades.length === 0) return { label, count: 0 };
    const n = trades.length;

    // 固定 2h 出场统计
    const fixedWins = trades.filter(t => t.fixedNetRet > 0).length;
    const fixedProfit = trades.filter(t => t.fixedNetRet > 0).reduce((acc, t) => acc + t.fixedNetRet, 0);
    const fixedLoss = trades.filter(t => t.fixedNetRet <= 0).reduce((acc, t) => acc + Math.abs(t.fixedNetRet), 0);
    const fixedPF = fixedLoss > 0 ? (fixedProfit / fixedLoss).toFixed(2) : 'Infinity';
    const fixedAvgRet = (trades.reduce((acc, t) => acc + t.fixedNetRet, 0) / n * 100).toFixed(2) + '%';

    // 脉冲移动止盈出场统计
    const dynWins = trades.filter(t => t.dynamicNetRet > 0).length;
    const dynProfit = trades.filter(t => t.dynamicNetRet > 0).reduce((acc, t) => acc + t.dynamicNetRet, 0);
    const dynLoss = trades.filter(t => t.dynamicNetRet <= 0).reduce((acc, t) => acc + Math.abs(t.dynamicNetRet), 0);
    const dynPF = dynLoss > 0 ? (dynProfit / dynLoss).toFixed(2) : 'Infinity';
    const dynAvgRet = (trades.reduce((acc, t) => acc + t.dynamicNetRet, 0) / n * 100).toFixed(2) + '%';

    // 对账窗口 Precision 与 Recall
    const tp30m = trades.filter(t => t.match30m).length;
    const tp15m = trades.filter(t => t.match15m).length;
    const tp5m = trades.filter(t => t.match5m).length;

    const precision30m = (tp30m / n * 100).toFixed(1) + '%';
    const precision15m = (tp15m / n * 100).toFixed(1) + '%';
    const precision5m = (tp5m / n * 100).toFixed(1) + '%';

    const zhaoCount = Math.max(1, zhaoSubList.length);
    const recall30m = (tp30m / zhaoCount * 100).toFixed(1) + '%';

    const leadList = trades.filter(t => t.leadMinutes !== null).map(t => t.leadMinutes);
    const realLeads = leadList.filter(l => l > 0).length;
    const realLags = leadList.filter(l => l < 0).length;
    const realSync = leadList.filter(l => l === 0).length;

    return {
      label,
      tradeCount: n,
      zhaoBenchCount: zhaoCount,
      fixed2h: {
        winRate: (fixedWins / n * 100).toFixed(1) + '%',
        avgNetReturn: fixedAvgRet,
        profitFactor: fixedPF
      },
      trailStop382: {
        winRate: (dynWins / n * 100).toFixed(1) + '%',
        avgNetReturn: dynAvgRet,
        profitFactor: dynPF
      },
      narrowAlignment: {
        precision_5m: precision5m,
        precision_15m: precision15m,
        precision_30m: precision30m,
        recall_30m: recall30m,
        leadDistribution: {
          earlierThanZhao: realLeads,
          syncWithZhao: realSync,
          lagBehindZhao: realLags
        }
      }
    };
  }

  const isZhao = zhaoBuys.filter(z => z.created_at < bars[isSplitIdx].time);
  const oosZhao = zhaoBuys.filter(z => z.created_at >= bars[isSplitIdx].time);

  const isSummary = summarize(isTrades, isZhao, 'In-Sample (前40天)');
  const oosSummary = summarize(oosTrades, oosZhao, 'Out-of-Sample (后20天)');

  console.log('=== 严格 Walk-Forward 检验总结 ===');
  console.log(JSON.stringify({ isSummary, oosSummary }, null, 2));

  // 落盘逐笔事件明细 jsonl
  const jsonlPath = path.resolve('data/runtime/backtest_rigorous_events.jsonl');
  const stream = fs.createWriteStream(jsonlPath, { encoding: 'utf8' });
  for (const tr of executedTrades) {
    stream.write(JSON.stringify(tr) + '\n');
  }
  stream.end();
  console.log(`\n✅ 逐笔事件明细已落盘至: ${jsonlPath} (${executedTrades.length} 笔)`);
}

runRigorousBacktest().catch(err => {
  console.error('回测异常:', err);
  process.exit(1);
});
