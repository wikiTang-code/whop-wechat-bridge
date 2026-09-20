import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';

/**
 * scripts/knowledge/benchmark_top5_micro_alpha.js
 * 
 * [独立纯净微观 Alpha 统一自适应引擎 · 赵哥近60天高频 Top 5 标的全量回测]
 * 标的清单:
 * 1. IREN (97笔)
 * 2. SOXL (78笔)
 * 3. MU   (73笔)
 * 4. CRWV (70笔)
 * 5. COHR (67笔)
 * 
 * Deprecated for primary claims: ±2h zhao match is `deprecated_wide_window` (CHG-050).
 * Do not cite 79% resonance as a main result. Use scripts/knowledge/backtest_walk_forward_rigorous.js.

const TOP5_TICKERS = ['IREN', 'SOXL', 'MU', 'CRWV', 'COHR'];

async function fetchYahoo5m(symbol) {
  const cacheFile = path.resolve(`data/runtime/${symbol}_5m_60d.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  console.log(`  -> 在线拉取 ${symbol} 近 60 天 5m K线...`);
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

function evaluateSignals(bars, signals, isBuy = true) {
  if (signals.length === 0) return { count: 0, winRate: '0%', avgReturn: '0%', profitFactor: '0.00', avgMfe: '0%', avgMae: '0%' };
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
  return {
    count: n,
    winRate: (winCount / n * 100).toFixed(1) + '%',
    avgReturn: (totalRet / n * 100).toFixed(2) + '%',
    profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'Infinity',
    avgMfe: (totalMfe / n * 100).toFixed(2) + '%',
    avgMae: (totalMae / n * 100).toFixed(2) + '%'
  };
}

async function runBenchmark() {
  console.log('=== [赵哥近60天交易频次 Top 5 标的 · 独立纯净 Alpha 全量横向基准测试] ===\n');

  const db = getReadOnlyArchiveDb();
  const summaryResults = [];

  for (const symbol of TOP5_TICKERS) {
    console.log(`------------------------------------------------------------`);
    console.log(`>>> 正在处理标的: ${symbol}...`);

    // 1. 获取 5m 行情数据
    const bars = await fetchYahoo5m(symbol);
    console.log(`  -> 获取到 5m K线: ${bars.length} 根`);

    const closes = bars.map(b => b.close);
    const midLadder = calcEma(closes, 26);
    const atr = calcAtr(bars, 14);
    const { dif } = calcMacd(closes);
    const volEma20 = calcEma(bars.map(b => b.volume), 20);

    // 计算标的自身归一化相对波动率: atrRatio = ATR / Close
    let sumAtrRatio = 0;
    for (let i = 14; i < bars.length; i++) sumAtrRatio += (atr[i] / closes[i]);
    const avgAtrRatio = sumAtrRatio / (bars.length - 14);
    // 自适应通道宽度: 高弹性股(>1%)通道系数自然展宽，低弹性股自适应收窄
    const kBand = avgAtrRatio > 0.008 ? 1.15 : 0.95;
    console.log(`  -> 标的平均5m波动率: ${(avgAtrRatio * 100).toFixed(2)}%, 自适应通道系数 k=${kBand}`);

    // 2. 纯净独立算法统一运算
    const autoBuys = [];
    const autoSells = [];

    for (let i = 30; i < bars.length; i++) {
      const b = bars[i];
      const prev = bars[i - 1];
      const curAtr = atr[i];
      const lowerBand = midLadder[i] - kBand * curAtr;
      const upperBand = midLadder[i] + kBand * curAtr;

      // 独立纯净买点:
      // 深水超卖 + 机构吸筹量能异动 + Higher Low确认 + DIF开始抬头
      const isUnderLowerBand = b.low <= lowerBand;
      const isHigherLow = b.low >= prev.low && b.close > prev.close && b.close > b.open;
      const isVolAccum = b.volume >= 1.1 * volEma20[i] || prev.volume >= 1.2 * volEma20[i - 1];
      const isMacdTurning = dif[i] > dif[i - 1];

      if (isUnderLowerBand && isHigherLow && isMacdTurning) {
        if (autoBuys.length === 0 || i - autoBuys[autoBuys.length - 1].barIdx >= 8) {
          autoBuys.push({ barIdx: i, time: b.time, price: b.close });
        }
      }

      // 独立纯净卖点 (脉冲移动止盈):
      // 突破上轨超买 + 脉冲回吐35%确认 + DIF见顶
      const impulse = b.high - Math.min(...bars.slice(Math.max(0, i - 10), i).map(x => x.low));
      const retrace = b.high - b.close;
      const isOverbought = b.high >= upperBand;
      const isRetraceConfirmed = retrace >= Math.max(0.5 * curAtr, 0.35 * impulse);

      if (isOverbought && isRetraceConfirmed && dif[i] < dif[i - 1]) {
        if (autoSells.length === 0 || i - autoSells[autoSells.length - 1].barIdx >= 8) {
          autoSells.push({ barIdx: i, time: b.time, price: b.close });
        }
      }
    }

    const buyEval = evaluateSignals(bars, autoBuys, true);
    const sellEval = evaluateSignals(bars, autoSells, false);

    // 3. 与赵哥该标的近 60 天真实单据对账
    const minT = bars[0].time;
    const maxT = bars[bars.length - 1].time;
    const zhaoTrades = db.prepare(`
      SELECT signal_id, ticker, action, price, created_at
      FROM trade_signals
      WHERE speaker_id = 'user_4yeplXgbguTu4'
        AND ticker = ?
        AND action IN ('BUY', 'SELL')
        AND created_at BETWEEN ? AND ?
      ORDER BY created_at ASC
    `).all(symbol, minT, maxT);

    const zhaoBuys = zhaoTrades.filter(t => t.action === 'BUY');
    const zhaoSells = zhaoTrades.filter(t => t.action === 'SELL');

    let buyMatches = 0;
    let buyLeads = 0;
    for (const zb of zhaoBuys) {
      const t0 = Number(zb.created_at);
      const m = autoBuys.find(s => Math.abs(s.time - t0) <= 2 * 3600 * 1000);
      if (m) {
        buyMatches++;
        if (m.time < t0 - 10 * 60 * 1000) buyLeads++;
      }
    }

    let sellMatches = 0;
    for (const zs of zhaoSells) {
      const t0 = Number(zs.created_at);
      const m = autoSells.find(s => Math.abs(s.time - t0) <= 2 * 3600 * 1000);
      if (m) sellMatches++;
    }

    summaryResults.push({
      symbol,
      barsCount: bars.length,
      volatility5m: (avgAtrRatio * 100).toFixed(2) + '%',
      zhaoTotalTrades: zhaoTrades.length,
      zhaoBuys: zhaoBuys.length,
      zhaoSells: zhaoSells.length,
      alphaBuySignals: buyEval.count,
      alphaBuyWinRate: buyEval.winRate,
      alphaBuyPF: buyEval.profitFactor,
      alphaBuyMfe: buyEval.avgMfe,
      alphaBuyMae: buyEval.avgMae,
      alphaSellSignals: sellEval.count,
      alphaSellWinRate: sellEval.winRate,
      alphaSellPF: sellEval.profitFactor,
      zhaoBuyMatchRate: ((buyMatches / Math.max(1, zhaoBuys.length)) * 100).toFixed(1) + '%',
      zhaoBuyLeadCount: buyLeads,
      zhaoSellMatchRate: ((sellMatches / Math.max(1, zhaoSells.length)) * 100).toFixed(1) + '%'
    });
  }

  console.log('\n============================================================');
  console.log('=== [Top 5 标的全量独立纯净 Alpha 测试大总表] ===');
  console.log('============================================================');
  console.table(summaryResults.map(r => ({
    '标的': r.symbol,
    '5m波动率': r.volatility5m,
    '赵哥交易数': r.zhaoTotalTrades,
    '买单共振率': r.zhaoBuyMatchRate,
    '超前发现(Lead)': r.zhaoBuyLeadCount,
    '自主买胜率': r.alphaBuyWinRate,
    '买端盈亏比(PF)': r.alphaBuyPF,
    '平均最大上涨(MFE)': r.alphaBuyMfe,
    '自主卖胜率': r.alphaSellWinRate,
    '卖端盈亏比(PF)': r.alphaSellPF
  })));

  const outPath = path.resolve('data/runtime/top5_micro_alpha_benchmark.json');
  fs.writeFileSync(outPath, JSON.stringify(summaryResults, null, 2), 'utf8');
  console.log(`\n✅ 完整横向基准测试报告已落盘至: ${outPath}`);
}

runBenchmark().catch(console.error);
