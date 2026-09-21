#!/usr/bin/env node
/**
 * REQ-059 — Track 2 dual ledger (style S × expectancy R-precursor).
 *
 * Fixtures / CI:
 *   node scripts/knowledge/backtest_dual_ledger_track2.js \
 *     --events test/fixtures/dual_ledger_track2/events.jsonl \
 *     --bars-dir test/fixtures/dual_ledger_track2/bars \
 *     --no-fetch --lookback-days all \
 *     --out-dir data/runs/dual_ledger_track2
 *
 * Machine / GCP (whop_archive.db present):
 *   node scripts/knowledge/backtest_dual_ledger_track2.js \
 *     --db whop_archive.db --lookback-days 60 --bar 5m \
 *     --symbols IREN,SOXL,MU,CRWV,COHR \
 *     --out-dir data/runs/dual_ledger_track2
 *
 * Cloud without archive: fixtures only. Do not invent archive N.
 * Not copytrade. Not done-strat. CHG-050 is negative-control sibling.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ARCHIVE_MISSING,
  BAR_TZ,
  CREATED_AT_MISSING,
  FROZEN_DEFAULTS,
  METHOD_LABEL,
  REQ_ID,
  STATUS_BANNER,
  TOP5_TICKERS,
  TRADE_SIGNAL_CHANNELS,
  ZHAO_SPEAKER_ID,
  assertLedgersNotMerged,
  assertOralNeverEntry,
  emptySummaryShell,
  filterLookback,
  frozenRuleIds,
  hasMessagesCreatedAtColumn,
  loadZhaoEventsFromJsonlLines,
  loadZhaoEventsFromSqliteRows,
  parseSymbols,
  resolveTrack2Source,
  runDualLedger,
  sqliteZhaoQuery,
  yahooBarsFromChartJson
} from './lib/dual_ledger_track2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

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
    bar: String(argVal('--bar', FROZEN_DEFAULTS.interval)),
    symbols: parseSymbols(argVal('--symbols', TOP5_TICKERS.join(','))),
    eventsPath: argVal('--events', null),
    dbPath: argVal('--db', path.resolve(ROOT, 'whop_archive.db')),
    barsDir: argVal('--bars-dir', null),
    noFetch: hasFlag('--no-fetch'),
    lookbackDays: argVal('--lookback-days', String(FROZEN_DEFAULTS.lookbackDays)),
    range: argVal('--range', null),
    outDir: path.resolve(ROOT, argVal('--out-dir', 'data/runs/dual_ledger_track2'))
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

function printBanner() {
  console.log('===========================================================');
  console.log(`${REQ_ID} Track 2 dual ledger  method=${METHOD_LABEL}`);
  console.log(`status=${STATUS_BANNER.status}  hint_only=${STATUS_BANNER.hint_only}`);
  console.log('NOT copytrade. NOT done-strat. NOT autonomous alpha.');
  console.log(`CHG-050 sibling = ${STATUS_BANNER.chg050_sibling}`);
  console.log('Ledgers: S=style (Zhao after trigger)  R=expectancy (ignore Zhao)');
  console.log('Do NOT merge S and R into one PF headline.');
  console.log(`speaker_lock=${ZHAO_SPEAKER_ID}  TZ=${BAR_TZ}`);
  console.log(`frozen_rules=${frozenRuleIds().join(',')}`);
  console.log('Cloud: scripts+fixtures+report skeleton. Archive runs on machine/GCP.');
  console.log('===========================================================');
}

async function probeMessagesCreatedAt(dbPath) {
  const abs = path.resolve(dbPath);
  const defaultAbs = path.resolve(ROOT, 'whop_archive.db');
  let db;
  let close = false;
  try {
    if (abs === defaultAbs) {
      const { getReadOnlyArchiveDb } = await import('../../monitoring/db-readonly.js');
      db = getReadOnlyArchiveDb(abs);
      if (!db) return false;
    } else {
      const { default: Database } = await import('better-sqlite3');
      db = new Database(abs, { readonly: true, timeout: 2000 });
      close = true;
    }
    return hasMessagesCreatedAtColumn(db);
  } catch {
    return false;
  } finally {
    if (close && db) db.close();
  }
}

async function loadSqliteEvents(dbPath, symbols) {
  const abs = path.resolve(dbPath);
  const defaultAbs = path.resolve(ROOT, 'whop_archive.db');
  let db;
  let close = false;
  if (abs === defaultAbs) {
    const { getReadOnlyArchiveDb } = await import('../../monitoring/db-readonly.js');
    db = getReadOnlyArchiveDb(abs);
    if (!db) throw new Error(ARCHIVE_MISSING);
  } else {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(abs, { readonly: true, timeout: 2000 });
    close = true;
  }
  try {
    if (!hasMessagesCreatedAtColumn(db)) throw new Error(CREATED_AT_MISSING);
    const rows = db.prepare(sqliteZhaoQuery()).all(
      ZHAO_SPEAKER_ID,
      TRADE_SIGNAL_CHANNELS[0],
      TRADE_SIGNAL_CHANNELS[1]
    );
    return {
      events: loadZhaoEventsFromSqliteRows(rows, { symbols }),
      source: `sqlite-ro:${rel(abs)}#messages.created_at`,
      speaker_lock: ZHAO_SPEAKER_ID
    };
  } finally {
    if (close) db.close();
  }
}

async function resolveEvents(opts) {
  const archiveExists = fs.existsSync(opts.dbPath);
  let hasCreatedAt = false;
  if (archiveExists && !opts.eventsPath) {
    hasCreatedAt = await probeMessagesCreatedAt(opts.dbPath);
  }
  const clock = resolveTrack2Source({
    eventsPath: opts.eventsPath,
    archiveExists,
    hasMessagesCreatedAt: hasCreatedAt
  });
  if (opts.eventsPath) {
    return {
      events: loadZhaoEventsFromJsonlLines(readJsonl(opts.eventsPath), { symbols: opts.symbols }),
      source: `jsonl:${opts.eventsPath}`,
      speaker_lock: ZHAO_SPEAKER_ID,
      t_msg_kind: clock.t_msg_kind
    };
  }
  return loadSqliteEvents(opts.dbPath, opts.symbols);
}

function loadBarsFromDir(dir, symbol) {
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  if (!fs.existsSync(absDir)) return null;
  const candidates = [
    path.join(absDir, `${symbol}.json`),
    path.join(absDir, `${symbol}_5m.json`)
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const bars = Array.isArray(json) ? json : json.bars;
    if (Array.isArray(bars)) return { bars, source: `file:${rel(f)}` };
  }
  return null;
}

async function fetchYahooBars(symbol, interval, range, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${symbol}_${interval}_${range}_rth.json`);
  if (fs.existsSync(cacheFile)) {
    return { bars: JSON.parse(fs.readFileSync(cacheFile, 'utf8')), source: `cache:${rel(cacheFile)}` };
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research; dual-ledger-track2)' } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${interval} HTTP ${res.status}`);
  const json = await res.json();
  const bars = yahooBarsFromChartJson(json);
  if (!bars.length) throw new Error(`Yahoo ${symbol} ${interval} empty`);
  fs.writeFileSync(cacheFile, JSON.stringify(bars), 'utf8');
  return { bars, source: `yahoo_v8:${interval}:${range}` };
}

async function barsForSymbol(symbol, opts) {
  if (opts.barsDir) {
    const local = loadBarsFromDir(opts.barsDir, symbol);
    if (local) return local;
    if (opts.noFetch) throw new Error(`no fixture bars for ${symbol} in ${opts.barsDir}`);
  }
  if (opts.noFetch) throw new Error(`--no-fetch and no cached bars for ${symbol}`);
  const range = opts.range || (opts.bar === '1m' ? '7d' : '60d');
  return fetchYahooBars(symbol, opts.bar, range, path.join(opts.outDir, 'bars'));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
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
  console.log(`N Zhao BUY/SELL after lookback=${lookbackDays || 'all'}d: ${events.length} / raw ${pack.events.length}`);

  const styleAll = [];
  const rAll = [];
  const perSymbol = {};
  const barMeta = {};

  for (const symbol of opts.symbols) {
    const packBars = await barsForSymbol(symbol, opts);
    barMeta[symbol] = {
      n_bars: packBars.bars.length,
      source: packBars.source,
      first: packBars.bars[0]?.datetime || null,
      last: packBars.bars[packBars.bars.length - 1]?.datetime || null
    };
    const zhao = events.filter((e) => e.symbol === symbol);
    const result = runDualLedger({
      symbol,
      bars: packBars.bars,
      zhaoEvents: zhao,
      interval: opts.bar
    });
    for (const row of result.style_rows) assertOralNeverEntry(row);
    for (const row of result.r_rows) assertOralNeverEntry(row);
    styleAll.push(...result.style_rows);
    rAll.push(...result.r_rows);
    perSymbol[symbol] = {
      n_zhao: zhao.length,
      n_triggers: result.n_triggers,
      split: result.split,
      ledger_S: result.ledger_S,
      ledger_R: result.ledger_R
    };
    console.log(`  ${symbol}: zhao=${zhao.length} triggers=${result.n_triggers} S.tp30=${result.ledger_S.tp30} R.n=${result.ledger_R.exit_a_all.n} (${packBars.source})`);
  }

  const summary = {
    ...emptySummaryShell(),
    command: `node scripts/knowledge/backtest_dual_ledger_track2.js --bar ${opts.bar} --symbols ${opts.symbols.join(',')}`,
    events_source: pack.source,
    speaker_lock: pack.speaker_lock,
    lookback_days: lookbackDays || 'all',
    n_zhao_events: events.length,
    bars: barMeta,
    per_symbol: perSymbol,
    ledger_S: {
      n_rows: styleAll.length,
      note: 'see per_symbol.ledger_S; style only; not a PF headline'
    },
    ledger_R: {
      n_rows: rAll.length,
      ignore_zhao: true,
      note: 'see per_symbol.ledger_R; ExitA vs ExitB separate; not merged with S'
    }
  };
  assertLedgersNotMerged(summary);

  const styleOut = path.join(opts.outDir, 'style_ledger_s.jsonl');
  const rOut = path.join(opts.outDir, 'expectancy_ledger_r.jsonl');
  const sumOut = path.join(opts.outDir, 'summary.json');
  writeJsonl(styleOut, styleAll);
  writeJsonl(rOut, rAll);
  fs.writeFileSync(sumOut, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`wrote ${styleAll.length} S rows → ${rel(styleOut)}`);
  console.log(`wrote ${rAll.length} R rows → ${rel(rOut)}`);
  console.log(`wrote summary → ${rel(sumOut)}`);
  console.log('REFERENCE_ONLY / hint_only / not_copytrade / not_done_strat');
}

main().catch((err) => {
  console.error('[dual-ledger-track2] fatal:', err.message || err);
  process.exit(1);
});
