import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';
import {
  METHOD_LABEL,
  TOP5_TICKERS,
  ZHAO_SPEAKER_ID,
  PARAM_GRID,
  FROZEN_DEFAULTS,
  assertMillisTimestamps,
  etTradingDate,
  chooseSplitDays,
  splitByTradingDays,
  detectTrades,
  alignZhao,
  summarizeExit,
  scoreIsCandidate,
  selectFrozenParams,
  permutationPrecision,
  sha256Hex,
  formatPct,
  publicExitStats,
  holdBarsForInterval
} from './lib/exploratory_is_oos.js';

/**
 * REQ-057 P2 / CHG-050
 * Exploratory calendar IS/OOS holdout (not walk-forward, not alpha).
 * Historical filename kept; METHOD_LABEL = exploratory_is_oos_holdout.
 *
 * Usage:
 *   node scripts/knowledge/backtest_walk_forward_rigorous.js
 *   node scripts/knowledge/backtest_walk_forward_rigorous.js --perm-b=200
 *
 * Inputs: Yahoo caches under data/runtime/{SYM}_5m_60d.json and {SYM}_1m_7d.json
 *         plus readonly trade_signals (speaker_id hard-lock, action=BUY).
 * Outputs (data/runtime/, most gitignored):
 *   chg050_params_frozen.json
 *   chg050_is_oos_summary.json
 *   chg050_events.jsonl
 */

const PERM_B = Number((process.argv.find((a) => a.startsWith('--perm-b=')) || '--perm-b=200').split('=')[1]);
const INTERVALS = [
  { key: '5m', range: '60d', cacheSuffix: '5m_60d' },
  { key: '1m', range: '7d', cacheSuffix: '1m_7d' }
];

function ensureRuntimeDir() {
  const dir = path.resolve('data/runtime');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchYahooBars(symbol, interval, range, cacheSuffix) {
  const cacheFile = path.resolve(`data/runtime/${symbol}_${cacheSuffix}.json`);
  if (fs.existsSync(cacheFile)) {
    return { bars: JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cacheFile, source: 'cache' };
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${interval} HTTP ${res.status}`);
  const json = await res.json();
  const res0 = json.chart?.result?.[0];
  const ts = res0?.timestamp;
  if (!ts?.length) throw new Error(`Yahoo ${symbol} ${interval} empty`);
  const q = res0.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null || q.open?.[i] == null) continue;
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
  ensureRuntimeDir();
  fs.writeFileSync(cacheFile, JSON.stringify(bars), 'utf8');
  return { bars, cacheFile, source: 'yahoo' };
}

function loadZhaoBuys(db, symbol, minT, maxT) {
  return db.prepare(`
    SELECT signal_id, price, created_at, action
    FROM trade_signals
    WHERE speaker_id = ?
      AND ticker = ?
      AND action = 'BUY'
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(ZHAO_SPEAKER_ID, symbol, minT, maxT);
}

function filterZhao(zhaoBuys, split, sampleType) {
  return zhaoBuys.filter((z) => split.classify({ time: Number(z.created_at) }) === sampleType);
}

function evaluateSlice(bars, zhaoSlice, params, split, sampleFilter, interval) {
  const trades = detectTrades(bars, params, FROZEN_DEFAULTS, {
    interval,
    holdBars: holdBarsForInterval(interval),
    split,
    sampleFilter
  });
  const align = alignZhao(trades, zhaoSlice);
  const exitA = summarizeExit(trades.map((t) => t.fixedNetRet));
  const exitB = summarizeExit(trades.map((t) => t.dynamicNetRet));
  return { trades, align, exitA, exitB };
}

function packSlice(label, ev, perm, zhaoBuyCount) {
  return {
    label,
    method: METHOD_LABEL,
    tradeCount: ev.trades.length,
    zhaoBuyCount,
    exitA_fixedHold: publicExitStats(ev.exitA),
    exitB_trail382: publicExitStats(ev.exitB),
    alignment: {
      precision_5m: formatPct(ev.align.precision[5]),
      precision_15m: formatPct(ev.align.precision[15]),
      precision_30m: formatPct(ev.align.precision[30]),
      recall_unique_5m: formatPct(ev.align.recallUnique[5]),
      recall_unique_15m: formatPct(ev.align.recallUnique[15]),
      recall_unique_30m: formatPct(ev.align.recallUnique[30]),
      tp30: ev.align.tp30,
      fp30: ev.align.fp30,
      fn30: ev.align.fn30
    },
    permutation_30m: perm
      ? {
          b: perm.b,
          observed_precision: formatPct(perm.observed),
          null_mean: formatPct(perm.nullMean),
          null_p95: formatPct(perm.nullP95),
          p_value: perm.pValue == null ? null : Number(perm.pValue.toFixed(4))
        }
      : null
  };
}

async function runOne(symbol, intervalSpec, db, frozenFromIs) {
  const { bars, cacheFile } = await fetchYahooBars(symbol, intervalSpec.key, intervalSpec.range, intervalSpec.cacheSuffix);
  const inputHash = sha256Hex(fs.readFileSync(cacheFile));
  if (bars.length < 200) {
    return {
      symbol,
      interval: intervalSpec.key,
      skipped: true,
      reason: `bars=${bars.length} < 200`,
      inputHash,
      cacheFile
    };
  }

  const minT = bars[0].time;
  const maxT = bars[bars.length - 1].time;
  const zhaoBuys = loadZhaoBuys(db, symbol, minT, maxT);
  try {
    assertMillisTimestamps(bars.map((b) => b.time), zhaoBuys.map((z) => z.created_at), `${symbol} ${intervalSpec.key}`);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode || 1);
  }

  const nDates = new Set(bars.map((b) => etTradingDate(b.time))).size;
  const splitSpec = chooseSplitDays(nDates, { isDays: FROZEN_DEFAULTS.isDays, oosDays: FROZEN_DEFAULTS.oosDays });
  const split = splitByTradingDays(bars, splitSpec);
  const isZhao = filterZhao(zhaoBuys, split, 'IN_SAMPLE');
  const oosZhao = filterZhao(zhaoBuys, split, 'OUT_OF_SAMPLE');

  let frozen = frozenFromIs;
  let gridRows = null;
  if (!frozen) {
    const candidates = PARAM_GRID.map((p) => {
      const ev = evaluateSlice(bars, isZhao, p, split, 'IN_SAMPLE', intervalSpec.key);
      const scored = scoreIsCandidate(ev.exitA, ev.align);
      return { ...p, ...scored, n: ev.exitA.n, avgNet: ev.exitA.avgNet, precision30: ev.align.precision[30] };
    });
    const picked = selectFrozenParams(candidates);
    frozen = {
      method: METHOD_LABEL,
      symbol,
      interval: intervalSpec.key,
      params: picked.params,
      selection: picked.selection,
      isEligible: picked.isEligible,
      splitMode: splitSpec.mode,
      frozen_at: new Date().toISOString(),
      grid: PARAM_GRID,
      frozen_constants: FROZEN_DEFAULTS
    };
    gridRows = candidates.map((c) => ({
      atrPctile: c.atrPctile,
      volMult: c.volMult,
      eligible: c.eligible,
      n: c.n,
      exitA_avgNet_pct: formatPct(c.avgNet, 4),
      precision30_pct: formatPct(c.precision30)
    }));
  }

  const isEv = evaluateSlice(bars, isZhao, frozen.params, split, 'IN_SAMPLE', intervalSpec.key);
  const oosEv = evaluateSlice(bars, oosZhao, frozen.params, split, 'OUT_OF_SAMPLE', intervalSpec.key);
  const oosBarTimes = bars.filter((b) => split.classify(b) === 'OUT_OF_SAMPLE').map((b) => b.time);
  const isBarTimes = bars.filter((b) => split.classify(b) === 'IN_SAMPLE').map((b) => b.time);
  const permIs = permutationPrecision(isEv.trades, isZhao, isBarTimes, { b: PERM_B, seed: 502026, windowMin: 30 });
  const permOos = permutationPrecision(oosEv.trades, oosZhao, oosBarTimes, { b: PERM_B, seed: 502026, windowMin: 30 });

  return {
    symbol,
    interval: intervalSpec.key,
    skipped: false,
    method: METHOD_LABEL,
    inputHash,
    cacheFile: path.relative(process.cwd(), cacheFile),
    bars: bars.length,
    split: {
      mode: splitSpec.mode,
      isDaysActual: split.isDaysActual,
      oosDaysActual: split.oosDaysActual,
      gapDaysActual: split.gapDaysActual,
      isFrom: split.isDates[0] || null,
      isTo: split.isDates[split.isDates.length - 1] || null,
      oosFrom: split.oosDates[0] || null,
      oosTo: split.oosDates[split.oosDates.length - 1] || null
    },
    zhaoBuyCount: zhaoBuys.length,
    zhaoNote: 'action=BUY only; not the wide-window 78-count mix',
    frozen,
    gridRows,
    is: packSlice('IN_SAMPLE', isEv, permIs, isZhao.length),
    oos: packSlice('OUT_OF_SAMPLE', oosEv, permOos, oosZhao.length),
    isEvents: isEv.align.events.map((e) => ({ ...e, symbol, interval: intervalSpec.key, sampleType: 'IN_SAMPLE' })),
    oosEvents: oosEv.align.events.map((e) => ({ ...e, symbol, interval: intervalSpec.key, sampleType: 'OUT_OF_SAMPLE' })),
    isTrades: isEv.trades,
    oosTrades: oosEv.trades
  };
}

async function main() {
  console.log(`[${METHOD_LABEL}] CHG-050 exploratory IS/OOS holdout`);
  console.log('Not walk-forward. Not alpha. Exit-B PF is not a rule.\n');

  const db = getReadOnlyArchiveDb();
  if (!db) {
    console.error('readonly archive db missing');
    process.exit(1);
  }

  const summary = {
    method: METHOD_LABEL,
    chg: 'CHG-050',
    req: 'REQ-057',
    generated_at: new Date().toISOString(),
    perm_b: PERM_B,
    reproduce: 'node scripts/knowledge/backtest_walk_forward_rigorous.js --perm-b=200',
    role: 'Layer1 evidence, HITL only, AUTO_SUBMIT forbidden',
    deprecated_wide_window: '§7 ±2h 79% table is deprecated_wide_window and not a primary result',
    runs: []
  };

  const frozenByKey = {};
  const jsonlRows = [];

  for (const intervalSpec of INTERVALS) {
    for (const symbol of TOP5_TICKERS) {
      console.log(`-- ${symbol} ${intervalSpec.key}`);
      const frozenKey = `${symbol}_${intervalSpec.key}`;
      const result = await runOne(symbol, intervalSpec, db, frozenByKey[frozenKey]);
      if (result.skipped) {
        summary.runs.push({
          symbol,
          interval: intervalSpec.key,
          skipped: true,
          reason: result.reason,
          inputHash: result.inputHash
        });
        continue;
      }
      frozenByKey[frozenKey] = result.frozen;

      summary.runs.push({
        symbol,
        interval: intervalSpec.key,
        skipped: false,
        inputHash: result.inputHash,
        cacheFile: result.cacheFile,
        bars: result.bars,
        split: result.split,
        zhaoBuyCount: result.zhaoBuyCount,
        frozen: {
          params: result.frozen.params,
          selection: result.frozen.selection,
          isEligible: result.frozen.isEligible
        },
        gridRows: result.gridRows,
        is: result.is,
        oos: result.oos
      });

      for (const tr of [...result.isTrades, ...result.oosTrades]) {
        jsonlRows.push({ kind: 'trade', symbol, interval: intervalSpec.key, ...tr });
      }
      for (const ev of [...result.isEvents, ...result.oosEvents]) {
        jsonlRows.push({ kind: 'align', ...ev });
      }
    }
  }

  const runtime = ensureRuntimeDir();
  const frozenPath = path.join(runtime, 'chg050_params_frozen.json');
  const summaryPath = path.join(runtime, 'chg050_is_oos_summary.json');
  const jsonlPath = path.join(runtime, 'chg050_events.jsonl');

  fs.writeFileSync(frozenPath, JSON.stringify({
    method: METHOD_LABEL,
    chg: 'CHG-050',
    frozen_constants: FROZEN_DEFAULTS,
    grid: PARAM_GRID,
    by_run: Object.fromEntries(
      summary.runs.filter((r) => !r.skipped).map((r) => [`${r.symbol}_${r.interval}`, r.frozen])
    )
  }, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(jsonlPath, jsonlRows.map((r) => JSON.stringify(r)).join('\n') + (jsonlRows.length ? '\n' : ''));

  console.log('\n=== exploratory IS/OOS (do not promote to rules) ===');
  for (const r of summary.runs) {
    if (r.skipped) {
      console.log(`${r.symbol} ${r.interval}: SKIP ${r.reason}`);
      continue;
    }
    console.log(
      `${r.symbol} ${r.interval} frozen k%=${r.frozen.params.atrPctile} vol=${r.frozen.params.volMult} ` +
      `IS n=${r.is.exitA_fixedHold.n} avgNet=${r.is.exitA_fixedHold.avgNet}% p30=${r.is.alignment.precision_30m}% ` +
      `OOS n=${r.oos.exitA_fixedHold.n} avgNet=${r.oos.exitA_fixedHold.avgNet}% p30=${r.oos.alignment.precision_30m}% ` +
      `permP=${r.oos.permutation_30m?.p_value}`
    );
  }
  console.log(`\nfrozen: ${frozenPath}`);
  console.log(`summary: ${summaryPath}`);
  console.log(`jsonl (gitignored): ${jsonlPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
