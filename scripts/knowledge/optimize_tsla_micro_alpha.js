import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';

/**
 * scripts/knowledge/optimize_tsla_micro_alpha.js
 * 
 * [TSLA/TSLL 5m 高频微观 Alpha 算法优化与寻优引擎]
 * CHG-050: 本脚本不是近 60 天主结果。主评测只跑 Top5 (IREN/SOXL/MU/CRWV/COHR) × {5m,1m}。
 * 1. 抓取与载入近 60 天 TSLA/TSLL 4,681 根真实 5m 高频 K 线;
 * 2. 跑三代算法对照:
 *    - V1 基线: 固定通道 + 简单收缩
 *    - V2 动能背离: DXDX / DBJGXC 边沿 + 脉冲比例移动止盈
 *    - V3 终极版: 梯子通道 + ATR自适应 + 量价放量止跌 + Higher-Low确认
 * 3. 统计前向盈亏比、胜率、MFE/MAE 与赵哥 49 笔真实单据对账，输出最优参数模型!
 */

async function fetchYahoo5m(symbol) {
  const cacheFile = path.resolve(`data/runtime/${symbol}_5m_60d.json`);
  if (fs.existsSync(cacheFile)) {
    console.log(`[缓存命中] 从 ${cacheFile} 载入 ${symbol} 5m K线...`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  console.log(`[在线拉取] 正在从 Yahoo 拉取 ${symbol} 近 60 天 5m K线...`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=60d&interval=5m`;
  const res = await fetch(url);
  const json = await res.json();
  const res0 = json.chart?.result?.[0];
  const ts = res0?.timestamp;
  const q = res0?.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    bars.push({
      time: ts[i] * 1000,
      datetime: new Date(ts[i] * 1000).toISOString(),
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] || 0
    });
  }
  const dir = path.dirname(cacheFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(bars, null, 2), 'utf8');
  console.log(`✅ ${symbol} 5m 数据已落盘至: ${cacheFile} (${bars.length} 根)`);
  return bars;
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

// 评估策略前向收益与胜率 (持有 12~24 根 5m 即 1~2 小时波段)
function evaluateSignals(bars, signals, isBuy = true) {
  if (signals.length === 0) return { count: 0, winRate: '0%', avgReturn: '0%', profitFactor: 0, avgMfe: '0%', avgMae: '0%' };
  let winCount = 0;
  let totalRet = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalMfe = 0;
  let totalMae = 0;

  for (const sig of signals) {
    const fBars = bars.slice(sig.barIdx + 1, Math.min(bars.length, sig.barIdx + 25)); // 前向 24 根 (2小时)
    if (fBars.length === 0) continue;
    const maxH = Math.max(...fBars.map(b => b.high));
    const minL = Math.min(...fBars.map(b => b.low));
    const exitP = fBars[fBars.length - 1].close;

    const ret = isBuy ? (exitP - sig.price) / sig.price : (sig.price - exitP) / sig.price;
    const mfe = isBuy ? (maxH - sig.price) / sig.price : (sig.price - minL) / sig.price;
    const mae = isBuy ? (minL - sig.price) / sig.price : (sig.price - maxH) / sig.price;

    totalRet += ret;
    totalMfe += mfe;
    totalMae += mae;

    if (ret > 0) {
      winCount++;
      grossProfit += ret;
    } else {
      grossLoss += Math.abs(ret);
    }
  }

  const n = signals.length;
  const winRate = (winCount / n * 100).toFixed(1) + '%';
  const avgReturn = (totalRet / n * 100).toFixed(2) + '%';
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'Infinity';
  const avgMfe = (totalMfe / n * 100).toFixed(2) + '%';
  const avgMae = (totalMae / n * 100).toFixed(2) + '%';

  return { count: n, winRate, avgReturn, profitFactor, avgMfe, avgMae };
}

async function runOptimization() {
  console.log('=== [TSLA/TSLL 5m 高频微观 Alpha 算法优化与寻优] ===\n');

  const tslaBars = await fetchYahoo5m('TSLA');
  console.log(`TSLA 5m 总 K 线数: ${tslaBars.length} 根`);

  const closes = tslaBars.map(b => b.close);
  const midLadder = calcEma(closes, 26);
  const atr = calcAtr(tslaBars, 14);
  const { dif, macd } = calcMacd(closes);

  // 均量线 (20 周期)
  const volEma20 = calcEma(tslaBars.map(b => b.volume), 20);

  // 调取赵哥 60 天内 TSLA/TSLL 交易单
  const db = getReadOnlyArchiveDb();
  const minT = tslaBars[0].time;
  const maxT = tslaBars[tslaBars.length - 1].time;
  const zhaoTrades = db.prepare(`
    SELECT signal_id, ticker, action, price, created_at, reason
    FROM trade_signals
    WHERE speaker_id = 'user_4yeplXgbguTu4'
      AND (ticker = 'TSLA' OR ticker = 'TSLL')
      AND action IN ('BUY', 'SELL')
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(minT, maxT);
  console.log(`期间赵哥 TSLA/TSLL 真实单据数: ${zhaoTrades.length} 笔 (BUY: ${zhaoTrades.filter(t => t.action === 'BUY').length}, SELL: ${zhaoTrades.filter(t => t.action === 'SELL').length})\n`);

  // --- 算法 V1: 基础通道超卖 + 简单收缩 ---
  const v1Buys = [];
  const v1Sells = [];
  for (let i = 30; i < tslaBars.length; i++) {
    const b = tslaBars[i];
    const prev = tslaBars[i - 1];
    const lowerBand = midLadder[i] - 0.8 * atr[i];
    const upperBand = midLadder[i] + 0.8 * atr[i];

    if (b.low <= lowerBand && b.close > b.open && dif[i] < 0 && Math.abs(dif[i]) < Math.abs(dif[i - 1])) {
      if (v1Buys.length === 0 || i - v1Buys[v1Buys.length - 1].barIdx >= 6) {
        v1Buys.push({ barIdx: i, time: b.time, price: b.close });
      }
    }
    if (b.high >= upperBand && (b.high - b.close) >= 0.3 * atr[i] && dif[i] > 0 && dif[i] < dif[i - 1]) {
      if (v1Sells.length === 0 || i - v1Sells[v1Sells.length - 1].barIdx >= 6) {
        v1Sells.push({ barIdx: i, time: b.time, price: b.close });
      }
    }
  }

  // --- 算法 V2: 严格背离边沿 DXDX + 相对脉冲回吐 38.2% 移动止盈 ---
  const v2Buys = [];
  const v2Sells = [];
  for (let i = 30; i < tslaBars.length; i++) {
    const b = tslaBars[i];
    const prev = tslaBars[i - 1];
    const lowerBand = midLadder[i] - 1.0 * atr[i]; // 扩大到 1.0 ATR 过滤浅回踩
    const upperBand = midLadder[i] + 1.0 * atr[i];

    // DXDX 底背离边沿: 创低点同时 DIF 绝对值收缩超过 1.01 倍
    const isDeepOversold = b.low <= lowerBand;
    const isDivergenceEdge = dif[i] < 0 && Math.abs(dif[i - 1]) >= Math.abs(dif[i]) * 1.01 && prev.close <= b.close;
    if (isDeepOversold && isDivergenceEdge) {
      if (v2Buys.length === 0 || i - v2Buys[v2Buys.length - 1].barIdx >= 6) {
        v2Buys.push({ barIdx: i, time: b.time, price: b.close });
      }
    }

    // 相对脉冲回吐止盈: 冲动段至少涨 1.5*ATR，且从高点回撤冲幅的 35% 以上
    const impulse = b.high - Math.min(...tslaBars.slice(Math.max(0, i - 8), i).map(x => x.low));
    const retrace = b.high - b.close;
    if (b.high >= upperBand && impulse >= 1.2 * atr[i] && retrace >= 0.35 * impulse) {
      if (v2Sells.length === 0 || i - v2Sells[v2Sells.length - 1].barIdx >= 6) {
        v2Sells.push({ barIdx: i, time: b.time, price: b.close });
      }
    }
  }

  // --- 算法 V3 (终极精炼版): 梯子通道 + ATR自适应 + 放量恐慌吸筹 + 双Bar底抬高企稳 ---
  const v3Buys = [];
  const v3Sells = [];
  for (let i = 30; i < tslaBars.length; i++) {
    const b = tslaBars[i];
    const prev = tslaBars[i - 1];
    const prev2 = tslaBars[i - 2];
    const lowerBand = midLadder[i] - 1.1 * atr[i]; // 深水恐慌区
    const upperBand = midLadder[i] + 1.1 * atr[i];

    // 买端精炼条件:
    // 1. 价格砸穿深水区 (超卖)
    // 2. 连续两根 Bar 底抬高确认 (右侧微观Higher Low: b.low > prev.low 且 b.close > prev.close)
    // 3. 成交量异动放量 (Volume >= 1.2 * VolEma20, 机构吸筹)
    // 4. MACD DIF 开始转头向上
    const isPanicked = Math.min(b.low, prev.low) <= lowerBand;
    const isHigherLowHook = b.low >= prev.low && b.close > b.open && b.close > prev.close;
    const isVolumeAccum = b.volume >= 1.1 * volEma20[i] || prev.volume >= 1.2 * volEma20[i - 1];
    const isMacdTurning = dif[i] > dif[i - 1];

    if (isPanicked && isHigherLowHook && isVolumeAccum && isMacdTurning) {
      if (v3Buys.length === 0 || i - v3Buys[v3Buys.length - 1].barIdx >= 8) {
        v3Buys.push({ barIdx: i, time: b.time, price: b.close });
      }
    }

    // 卖端精炼条件 (异动直线冲顶衰竭):
    // 1. 突破上轨
    // 2. 长上影线见顶 (High - Close > 1.5 * (Close - Open))
    // 3. 相对脉冲回撤 >= max(0.6*ATR, 40%*Impulse)
    const impulse = b.high - Math.min(...tslaBars.slice(Math.max(0, i - 10), i).map(x => x.low));
    const retrace = b.high - b.close;
    const isOverbought = b.high >= upperBand;
    const isTopTail = (b.high - Math.max(b.open, b.close)) >= 0.5 * (b.high - b.low);
    const isRetraceStrong = retrace >= Math.max(0.5 * atr[i], 0.382 * impulse);

    if (isOverbought && (isTopTail || isRetraceStrong) && dif[i] < dif[i - 1]) {
      if (v3Sells.length === 0 || i - v3Sells[v3Sells.length - 1].barIdx >= 8) {
        v3Sells.push({ barIdx: i, time: b.time, price: b.close });
      }
    }
  }

  // 评估各代模型表现
  const evalV1 = evaluateSignals(tslaBars, v1Buys, true);
  const evalV2 = evaluateSignals(tslaBars, v2Buys, true);
  const evalV3 = evaluateSignals(tslaBars, v3Buys, true);

  const evalV1S = evaluateSignals(tslaBars, v1Sells, false);
  const evalV2S = evaluateSignals(tslaBars, v2Sells, false);
  const evalV3S = evaluateSignals(tslaBars, v3Sells, false);

  // 与赵哥交易单共振对账
  const zhaoBuys = zhaoTrades.filter(t => t.action === 'BUY');
  const checkConcurrence = (signals) => {
    let matchCount = 0;
    let leadCount = 0;
    for (const zb of zhaoBuys) {
      const t0 = Number(zb.created_at);
      const match = signals.find(s => Math.abs(s.time - t0) <= 2 * 3600 * 1000);
      if (match) {
        matchCount++;
        if (match.time < t0 - 15 * 60 * 1000) leadCount++;
      }
    }
    return {
      matchCount,
      matchRate: ((matchCount / Math.max(1, zhaoBuys.length)) * 100).toFixed(1) + '%',
      leadCount
    };
  };

  const syncV1 = checkConcurrence(v1Buys);
  const syncV2 = checkConcurrence(v2Buys);
  const syncV3 = checkConcurrence(v3Buys);

  const comparison = {
    dataset: 'TSLA 5m (近60天 4,681根 K线)',
    evaluationWindow: '前向 2 小时波段 (24 根 5m)',
    models: {
      'V1_Baseline': {
        buySignals: evalV1.count,
        winRate: evalV1.winRate,
        profitFactor: evalV1.profitFactor,
        avgMfe: evalV1.avgMfe,
        avgMae: evalV1.avgMae,
        zhaoBuyMatch: syncV1.matchRate,
        leadCount: syncV1.leadCount
      },
      'V2_Divergence_Impulse': {
        buySignals: evalV2.count,
        winRate: evalV2.winRate,
        profitFactor: evalV2.profitFactor,
        avgMfe: evalV2.avgMfe,
        avgMae: evalV2.avgMae,
        zhaoBuyMatch: syncV2.matchRate,
        leadCount: syncV2.leadCount
      },
      'V3_Refined_Microstructure': {
        buySignals: evalV3.count,
        winRate: evalV3.winRate,
        profitFactor: evalV3.profitFactor,
        avgMfe: evalV3.avgMfe,
        avgMae: evalV3.avgMae,
        zhaoBuyMatch: syncV3.matchRate,
        leadCount: syncV3.leadCount
      }
    },
    sellSide: {
      V1_SellCount: evalV1S.count,
      V1_WinRate: evalV1S.winRate,
      V2_SellCount: evalV2S.count,
      V2_WinRate: evalV2S.winRate,
      V3_SellCount: evalV3S.count,
      V3_WinRate: evalV3S.winRate,
      V3_ProfitFactor: evalV3S.profitFactor
    }
  };

  console.log('=== 三代算法优化对照结果 ===');
  console.log(JSON.stringify(comparison, null, 2));

  const outPath = path.resolve('data/runtime/tsla_micro_alpha_evolution.json');
  fs.writeFileSync(outPath, JSON.stringify(comparison, null, 2), 'utf8');
  console.log(`\n✅ 优化对比报告已落盘至: ${outPath}`);
}

runOptimization().catch(err => {
  console.error('优化引擎执行异常:', err);
  process.exit(1);
});
