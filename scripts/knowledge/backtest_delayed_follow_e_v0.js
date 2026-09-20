#!/usr/bin/env node
/**
 * REQ-058 — delayed-follow E-layer v0 historical backtest (research only).
 *
 *   node scripts/knowledge/backtest_delayed_follow_e_v0.js \
 *     --delta-mins 0,1,3,5 --bar 5m --symbols IREN,SOXL,MU,CRWV,COHR
 *
 * One command writes event jsonl + summary.json.
 * Does NOT invent t_fill. t_arrive_hat is hypothesized, not observed t_arrive.
 * Not wired to HUD / L2a / place_order.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  BAR_TZ,
  DEFAULT_DELTA_MINS,
  DEFAULT_UNIVERSE,
  DELAYED_FOLLOW_POLICY,
  METHOD_LABEL,
  TRADE_SIGNAL_CHANNELS,
  ZHAO_SPEAKER_ID,
  assertNoOralPriceLeakage,
  filterLookback,
  loadBuyEventsFromJsonlLines,
  loadBuyEventsFromSqliteRows,
  parseDeltaMins,
  parseSymbols,
  sqliteBuyQuery,
  summarizeRows,
  sweepEvent,
  yahooBarsFromChartJson
} from './lib/delayed_follow_e_v0.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const L2A_DEFAULTS = [
  'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl',
  'data/runs/l2a_cleaned_20260828_incr01.jsonl'
];

function argVal(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  const pref = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (pref) return pref.slice(flag.length + 1);
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseArgs() {
  return {
    deltaMins: parseDeltaMins(argVal('--delta-mins', DEFAULT_DELTA_MINS.join(','))),
    bar: String(argVal('--bar', '5m')),
    symbols: parseSymbols(argVal('--symbols', DEFAULT_UNIVERSE.join(','))),
    eventsPath: argVal('--events', null),
    dbPath: argVal('--db', path.resolve(ROOT, 'whop_archive.db')),
    barsDir: argVal('--bars-dir', null),
    noFetch: hasFlag('--no-fetch'),
    includePrepost: hasFlag('--include-prepost'),
    lookbackDays: argVal('--lookback-days', '60'),
    range: argVal('--range', null),
    outDir: path.resolve(ROOT, argVal('--out-dir', 'data/runs/delayed_follow_e_v0'))
  };
}

function readJsonl(file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(ROOT, file);
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/);
}

function rel(p) {
  return path.relative(ROOT, p);
}

function loadL2aEvents(symbols) {
  const events = [];
  const used = [];
  for (const p of L2A_DEFAULTS) {
    const abs = path.resolve(ROOT, p);
    if (!fs.existsSync(abs)) continue;
    used.push(p);
    events.push(...loadBuyEventsFromJsonlLines(readJsonl(abs), { symbols }));
  }
  return {
    events,
    source: used.length ? `l2a:${used.join(',')}` : 'none',
    speaker_lock: `${ZHAO_SPEAKER_ID} (assumed: trade-channel L2A ledger; jsonl has no speaker_id)`
  };
}

async function loadSqliteEvents(dbPath, symbols) {
  const abs = path.resolve(dbPath);
  const defaultAbs = path.resolve(ROOT, 'whop_archive.db');
  let db;
  let close = false;
  if (abs === defaultAbs) {
    const { getReadOnlyArchiveDb } = await import('../../monitoring/db-readonly.js');
    db = getReadOnlyArchiveDb(abs);
    if (!db) throw new Error('readonly archive db unavailable');
  } else {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(abs, { readonly: true, timeout: 2000 });
    close = true;
  }
  try {
    const rows = db.prepare(sqliteBuyQuery()).all(
      ZHAO_SPEAKER_ID,
      TRADE_SIGNAL_CHANNELS[0],
      TRADE_SIGNAL_CHANNELS[1]
    );
    return {
      events: loadBuyEventsFromSqliteRows(rows, { symbols }),
      source: `sqlite-ro:${rel(abs)}`,
      speaker_lock: ZHAO_SPEAKER_ID
    };
  } finally {
    if (close) db.close();
  }
}

async function resolveEvents(opts) {
  if (opts.eventsPath) {
    return {
      events: loadBuyEventsFromJsonlLines(readJsonl(opts.eventsPath), {
        symbols: opts.symbols,
        requireZhaoLock: false
      }),
      source: `jsonl:${opts.eventsPath}`,
      speaker_lock: 'as-provided-jsonl'
    };
  }
  if (fs.existsSync(opts.dbPath)) {
    try {
      return await loadSqliteEvents(opts.dbPath, opts.symbols);
    } catch (err) {
      console.warn(`[delayed-follow] sqlite failed: ${err.message}; falling back to L2A jsonl`);
    }
  }
  return loadL2aEvents(opts.symbols);
}

function loadBarsFromDir(dir, symbol) {
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  if (!fs.existsSync(absDir)) return null;
  const candidates = [
    path.join(absDir, `${symbol}.json`),
    path.join(absDir, `${symbol}_5m.json`),
    path.join(absDir, `${symbol}_5m_60d.json`),
    path.join(absDir, `${symbol}_1m.json`)
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const bars = Array.isArray(json) ? json : json.bars;
    if (Array.isArray(bars)) return { bars, source: `file:${rel(f)}` };
  }
  return null;
}

function defaultRange(bar) {
  return bar === '1m' ? '7d' : '60d';
}

async function fetchYahooBars(symbol, interval, range, includePrepost, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(
    cacheDir,
    `${symbol}_${interval}_${range}${includePrepost ? '_prepost' : '_rth'}.json`
  );
  if (fs.existsSync(cacheFile)) {
    return { bars: JSON.parse(fs.readFileSync(cacheFile, 'utf8')), source: `cache:${rel(cacheFile)}` };
  }
  const pre = includePrepost ? '&includePrePost=true' : '&includePrePost=false';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}${pre}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research; delayed-follow-e-v0)' } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${interval} HTTP ${res.status}`);
  const json = await res.json();
  const bars = yahooBarsFromChartJson(json);
  if (!bars.length) throw new Error(`Yahoo ${symbol} ${interval} empty`);
  fs.writeFileSync(cacheFile, JSON.stringify(bars), 'utf8');
  return { bars, source: `yahoo_v8:${interval}:${range}:includePrePost=${includePrepost}` };
}

async function barsForSymbol(symbol, opts) {
  if (opts.barsDir) {
    const local = loadBarsFromDir(opts.barsDir, symbol);
    if (local) return local;
    if (opts.noFetch) throw new Error(`no fixture bars for ${symbol} in ${opts.barsDir}`);
  }
  const runtimeCache = path.resolve(ROOT, 'data/runtime');
  const cached = loadBarsFromDir(runtimeCache, symbol);
  if (cached && opts.noFetch) return cached;
  if (opts.noFetch) throw new Error(`--no-fetch and no cached bars for ${symbol}`);
  const range = opts.range || defaultRange(opts.bar);
  const cacheDir = path.join(opts.outDir, 'bars');
  try {
    return await fetchYahooBars(symbol, opts.bar, range, opts.includePrepost, cacheDir);
  } catch (err) {
    if (cached) {
      console.warn(`[delayed-follow] Yahoo failed for ${symbol} (${err.message}); using runtime cache`);
      return cached;
    }
    throw err;
  }
}

function printBanner() {
  console.log('===========================================================');
  console.log('REQ-058 delayed-follow E-layer v0');
  console.log('HYPOTHESIZED arrival  t_arrive_hat = t_msg + Δ');
  console.log('NOT observed t_arrive. NOT autonomous alpha. NOT Zhao PnL.');
  console.log('px_arrive = bar OPEN containing t_arrive_hat. Never px_zhao.');
  console.log('No t_fill field. Bar high/low is not a fill clock.');
  console.log(`TZ=${BAR_TZ}  method=${METHOD_LABEL}`);
  console.log(`policy=${DELAYED_FOLLOW_POLICY.policy_id} (${DELAYED_FOLLOW_POLICY.policy_status})`);
  console.log('===========================================================');
}

async function main() {
  const opts = parseArgs();
  const lookbackDays = opts.lookbackDays === 'all' || opts.lookbackDays === '0'
    ? 0
    : Number(opts.lookbackDays);
  printBanner();
  fs.mkdirSync(opts.outDir, { recursive: true });

  const pack = await resolveEvents(opts);
  const events = filterLookback(pack.events, lookbackDays);
  console.log(`events source: ${pack.source}`);
  console.log(`speaker lock: ${pack.speaker_lock}`);
  console.log(`N buy events after lookback=${lookbackDays || 'all'}d: ${events.length} / raw ${pack.events.length}`);
  const nBySym = {};
  for (const e of events) nBySym[e.symbol] = (nBySym[e.symbol] || 0) + 1;
  console.log('N per symbol:', JSON.stringify(nBySym));

  const barMeta = {};
  const rows = [];
  for (const symbol of opts.symbols) {
    const packBars = await barsForSymbol(symbol, opts);
    barMeta[symbol] = {
      n_bars: packBars.bars.length,
      source: packBars.source,
      first: packBars.bars[0]?.datetime || null,
      last: packBars.bars[packBars.bars.length - 1]?.datetime || null
    };
    const subset = events.filter((e) => e.symbol === symbol);
    console.log(`  ${symbol}: ${subset.length} events, ${packBars.bars.length} bars (${packBars.source})`);
    for (const ev of subset) {
      const swept = sweepEvent(ev, packBars.bars, opts.deltaMins, {
        interval: opts.bar,
        barSource: packBars.source,
        includePrepost: opts.includePrepost
      });
      for (const row of swept) {
        assertNoOralPriceLeakage(row);
        rows.push(row);
      }
    }
  }

  const summary = {
    banner: {
      hypothesized_arrival: true,
      observed_t_arrive: false,
      autonomous_alpha: false,
      zhao_own_pnl: false,
      invented_t_fill: false,
      timezone: BAR_TZ,
      premarket_included: opts.includePrepost,
      premarket_note: opts.includePrepost
        ? 'Yahoo includePrePost=true (extended hours share unix timestamps; not a separate clock).'
        : 'Yahoo includePrePost=false (RTH bars only; premarket not included/aligned).',
      bar_interval: opts.bar,
      bar_range: opts.range || defaultRange(opts.bar),
      yahoo_1m_note: 'Yahoo 1m typically only ~7 sessions; 5m ~60d is the v0 default.'
    },
    policy: DELAYED_FOLLOW_POLICY,
    method: METHOD_LABEL,
    command: `node scripts/knowledge/backtest_delayed_follow_e_v0.js --delta-mins ${opts.deltaMins.join(',')} --bar ${opts.bar} --symbols ${opts.symbols.join(',')}`,
    events_source: pack.source,
    speaker_lock: pack.speaker_lock,
    lookback_days: lookbackDays || 'all',
    n_events: events.length,
    n_events_per_symbol: nBySym,
    bars: barMeta,
    stats: summarizeRows(rows)
  };

  const eventsOut = path.join(opts.outDir, 'events.jsonl');
  const summaryOut = path.join(opts.outDir, 'summary.json');
  fs.writeFileSync(eventsOut, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`wrote ${rows.length} rows → ${rel(eventsOut)}`);
  console.log(`wrote summary → ${rel(summaryOut)}`);
  console.log(JSON.stringify(summary.stats.per_delta, null, 2));
}

main().catch((err) => {
  console.error('[delayed-follow] fatal:', err);
  process.exit(1);
});
