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

async function runQqqTraining() {
  console.log('=== [二号核心样本: QQQ 大盘中枢 + 周哥量化波段辅证引擎] ===\n');

  const qqqBars = await fetchYahoo5m('QQQ');
  console.log(`QQQ 5m 总 K 线数: ${qqqBars.length} 根`);

  const closes = qqqBars.map(b => b.close);
  const midLadder = calcEma(closes, 26);
  const atr = calcAtr(qqqBars, 14);
  const { dif } = calcMacd(closes);

  // 调取周哥在数据库里的波段与工具箱信号
  const db = getReadOnlyArchiveDb();
  const zhouCards = db.prepare(`
    SELECT id, content, created_at
    FROM messages
    WHERE (sender_id = 'user_HnSG7BJWMTfDz' OR sender_name LIKE '%zhou%')
      AND (content LIKE '%QQQ%' OR content LIKE '%减仓%' OR content LIKE '%加仓%' OR content LIKE '%低点%' OR content LIKE '%抄底%')
    ORDER BY created_at ASC
  `).all();

  console.log(`数据库中检索到周哥大盘波段与量化参考记录: ${zhouCards.length} 条\n`);

  // QQQ 属于大盘指数 ETF，波动率较个股小得多，微观门槛设定为 0.9 * ATR
  const qqqBottomTurns = [];
  const qqqTopTurns = [];

  for (let i = 30; i < qqqBars.length; i++) {
    const b = qqqBars[i];
    const prev = qqqBars[i - 1];
    const curAtr = atr[i];
    const lowerBand = midLadder[i] - 0.9 * curAtr;
    const upperBand = midLadder[i] + 0.9 * curAtr;

    // 大盘转弯买: 触碰下轨 + 动能DIF底背离收敛 + 底抬高
    const isUnder = b.low <= lowerBand;
    const isHigherLow = b.low >= prev.low && b.close > b.open;
    const isDifHook = dif[i] < 0 && Math.abs(dif[i]) < Math.abs(dif[i - 1]);

    if (isUnder && isHigherLow && isDifHook) {
      if (qqqBottomTurns.length === 0 || i - qqqBottomTurns[qqqBottomTurns.length - 1].barIdx >= 8) {
        qqqBottomTurns.push({ barIdx: i, time: b.time, datetime: b.datetime, price: b.close });
      }
    }

    // 大盘见顶回落: 触碰上轨 + 脉冲回吐
    const isOver = b.high >= upperBand;
    const isRetrace = (b.high - b.close) >= 0.4 * curAtr;
    const isDifDown = dif[i] > 0 && dif[i] < dif[i - 1];

    if (isOver && isRetrace && isDifDown) {
      if (qqqTopTurns.length === 0 || i - qqqTopTurns[qqqTopTurns.length - 1].barIdx >= 8) {
        qqqTopTurns.push({ barIdx: i, time: b.time, datetime: b.datetime, price: b.close });
      }
    }
  }

  // 计算 QQQ 前向收益与稳定性
  let winCount = 0;
  let totalRet = 0;
  let totalMfe = 0;
  for (const sig of qqqBottomTurns) {
    const fBars = qqqBars.slice(sig.barIdx + 1, Math.min(qqqBars.length, sig.barIdx + 25));
    if (fBars.length === 0) continue;
    const maxH = Math.max(...fBars.map(b => b.high));
    const ret = (fBars[fBars.length - 1].close - sig.price) / sig.price;
    const mfe = (maxH - sig.price) / sig.price;
    totalRet += ret;
    totalMfe += mfe;
    if (ret > 0) winCount++;
  }

  const qqqWinRate = (winCount / Math.max(1, qqqBottomTurns.length) * 100).toFixed(1) + '%';
  const qqqAvgMfe = (totalMfe / Math.max(1, qqqBottomTurns.length) * 100).toFixed(2) + '%';

  const report = {
    symbol: 'QQQ (Nasdaq 100 Benchmark)',
    barsCount: qqqBars.length,
    zhouQuantReferenceRecords: zhouCards.length,
    qqqBottomTurnSignals: qqqBottomTurns.length,
    qqqTopTurnSignals: qqqTopTurns.length,
    qqqStandaloneMetrics: {
      winRate: qqqWinRate,
      avgMfeGain: '+' + qqqAvgMfe,
      note: '大盘指数日内平均波幅 +0.8%~1.2% 即对应个股 2%~5% 脉冲空间'
    },
    zhouConfluenceSample: zhouCards.slice(-3).map(c => ({
      time: new Date(Number(c.created_at)).toISOString(),
      content: c.content.slice(0, 100)
    }))
  };

  console.log('=== QQQ 大盘中枢与周哥参谋报告 ===');
  console.log(JSON.stringify(report, null, 2));

  fs.writeFileSync('data/runtime/qqq_macro_alpha_results.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('\n✅ QQQ 大盘中枢报告已落盘至: data/runtime/qqq_macro_alpha_results.json');
}

runQqqTraining().catch(console.error);
