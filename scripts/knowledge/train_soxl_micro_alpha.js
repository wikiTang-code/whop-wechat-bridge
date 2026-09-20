import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';

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

function evaluateSignals(bars, signals, isBuy = true) {
  if (signals.length === 0) return { count: 0, winRate: '0%', avgReturn: '0%', profitFactor: 0, avgMfe: '0%', avgMae: '0%' };
  let winCount = 0;
  let totalRet = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalMfe = 0;
  let totalMae = 0;

  for (const sig of signals) {
    const fBars = bars.slice(sig.barIdx + 1, Math.min(bars.length, sig.barIdx + 25));
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

async function runSoxlTraining() {
  console.log('=== [一号王者样本: SOXL 近 60 天 5m 微观 Alpha 训练与对账] ===\n');

  const soxlBars = await fetchYahoo5m('SOXL');
  console.log(`SOXL 5m 总 K 线数: ${soxlBars.length} 根`);

  const closes = soxlBars.map(b => b.close);
  const midLadder = calcEma(closes, 26);
  const atr = calcAtr(soxlBars, 14);
  const { dif } = calcMacd(closes);
  const volEma20 = calcEma(soxlBars.map(b => b.volume), 20);

  // 调取赵哥 SOXL 真实单据
  const db = getReadOnlyArchiveDb();
  const minT = soxlBars[0].time;
  const maxT = soxlBars[soxlBars.length - 1].time;
  const zhaoTrades = db.prepare(`
    SELECT signal_id, ticker, action, price, created_at, reason
    FROM trade_signals
    WHERE speaker_id = 'user_4yeplXgbguTu4'
      AND ticker = 'SOXL'
      AND action IN ('BUY', 'SELL')
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(minT, maxT);

  const zhaoBuys = zhaoTrades.filter(t => t.action === 'BUY');
  const zhaoSells = zhaoTrades.filter(t => t.action === 'SELL');
  console.log(`期间赵哥 SOXL 真实单据: ${zhaoTrades.length} 笔 (BUY: ${zhaoBuys.length}, SELL: ${zhaoSells.length})\n`);

  // 自主微观 Alpha 算法 (针对 SOXL 高弹性标的自适应微调)
  // SOXL 是 3 倍杠杆，波动率极高，ATR 门槛需相应放大至 1.2 * ATR
  const autoBuys = [];
  const autoSells = [];

  for (let i = 30; i < soxlBars.length; i++) {
    const b = soxlBars[i];
    const prev = soxlBars[i - 1];
    const curAtr = atr[i];
    const lowerBand = midLadder[i] - 1.2 * curAtr;
    const upperBand = midLadder[i] + 1.2 * curAtr;

    // 买入条件: 深砸下轨恐慌区 + 缩量/放量反转 + Higher Low + MACD拐头
    const isUnderLowerBand = b.low <= lowerBand;
    const isHigherLow = b.low >= prev.low && b.close > prev.close && b.close > b.open;
    const isMacdTurning = dif[i] > dif[i - 1];

    if (isUnderLowerBand && isHigherLow && isMacdTurning) {
      if (autoBuys.length === 0 || i - autoBuys[autoBuys.length - 1].barIdx >= 8) {
        autoBuys.push({ barIdx: i, time: b.time, price: b.close });
      }
    }

    // 卖出条件: 突破上轨超买 + 冲高回落脉冲 35% 确认
    const impulse = b.high - Math.min(...soxlBars.slice(Math.max(0, i - 10), i).map(x => x.low));
    const retrace = b.high - b.close;
    const isOverbought = b.high >= upperBand;
    const isRetraceConfirmed = retrace >= Math.max(0.6 * curAtr, 0.35 * impulse);

    if (isOverbought && isRetraceConfirmed && dif[i] < dif[i - 1]) {
      if (autoSells.length === 0 || i - autoSells[autoSells.length - 1].barIdx >= 8) {
        autoSells.push({ barIdx: i, time: b.time, price: b.close });
      }
    }
  }

  const buyEval = evaluateSignals(soxlBars, autoBuys, true);
  const sellEval = evaluateSignals(soxlBars, autoSells, false);

  // 与赵哥对账 (±2小时)
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

  const report = {
    symbol: 'SOXL (3X Semiconductor ETF)',
    barsCount: soxlBars.length,
    zhaoTradesInRange: {
      total: zhaoTrades.length,
      buys: zhaoBuys.length,
      sells: zhaoSells.length
    },
    autonomousStrategy: {
      buyCount: buyEval.count,
      buyWinRate: buyEval.winRate,
      buyProfitFactor: buyEval.profitFactor,
      buyAvgMfe: buyEval.avgMfe,
      buyAvgMae: buyEval.avgMae,
      sellCount: sellEval.count,
      sellWinRate: sellEval.winRate,
      sellProfitFactor: sellEval.profitFactor
    },
    zhaoConcurrence: {
      buyMatchCount: buyMatches,
      buyMatchRate: ((buyMatches / Math.max(1, zhaoBuys.length)) * 100).toFixed(1) + '%',
      buyLeadCount: buyLeads,
      sellMatchCount: sellMatches,
      sellMatchRate: ((sellMatches / Math.max(1, zhaoSells.length)) * 100).toFixed(1) + '%'
    }
  };

  console.log('=== SOXL 5m 微观训练报告 ===');
  console.log(JSON.stringify(report, null, 2));

  fs.writeFileSync('data/runtime/soxl_micro_alpha_results.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('\n✅ SOXL 训练结果已落盘至: data/runtime/soxl_micro_alpha_results.json');
}

runSoxlTraining().catch(console.error);
