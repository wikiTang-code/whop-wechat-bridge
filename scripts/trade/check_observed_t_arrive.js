/**
 * CHG-054 — read-only check: recent trade_signals / trade_intents t_arrive coverage.
 *
 * SQLite { readonly: true }. Fail-closed if DB file missing or t_arrive column absent.
 * Does not backfill. Does not invent t_arrive from K-line or oral price.
 *
 * Windows (repo root, next to whop_archive.db):
 *   node scripts/trade/check_observed_t_arrive.js --db whop_archive.db --limit 20
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);

export const EXIT_OK = 0;
export const EXIT_NO_DB = 2;
export const EXIT_SCHEMA = 3;

function parseArgs(argv = process.argv.slice(2)) {
  const out = { db: 'whop_archive.db', limit: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) out.db = argv[++i];
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (a.startsWith('--db=')) out.db = a.slice(5);
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice(8), 10) || 20);
  }
  return out;
}

function hasColumn(conn, table, column) {
  try {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  } catch (_) {
    return false;
  }
}

function tableExists(conn, table) {
  try {
    const row = conn.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);
    return !!row;
  } catch (_) {
    return false;
  }
}

function iso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  try { return new Date(n).toISOString(); } catch (_) { return String(ms); }
}

function countCoverage(conn, table) {
  const total = conn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c || 0;
  const withArrive = conn.prepare(
    `SELECT COUNT(*) AS c FROM ${table} WHERE t_arrive IS NOT NULL AND t_arrive > 0`
  ).get()?.c || 0;
  return { total, with_t_arrive: withArrive, without_t_arrive: total - withArrive };
}

function recentRows(conn, table, idCol, limit) {
  return conn.prepare(
    `SELECT ${idCol} AS id, ticker, t_arrive, created_at
     FROM ${table}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(limit);
}

export function checkObservedTArrive({ dbPath, limit = 20 } = {}) {
  const resolved = path.resolve(dbPath || 'whop_archive.db');
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      exitCode: EXIT_NO_DB,
      reason: `FAIL_CLOSED no DB: ${resolved}`
    };
  }

  let conn;
  try {
    conn = new Database(resolved, { readonly: true, timeout: 2000 });
  } catch (err) {
    return {
      ok: false,
      exitCode: EXIT_NO_DB,
      reason: `FAIL_CLOSED cannot open readonly: ${err.message}`
    };
  }

  try {
    const need = [
      ['trade_signals', 't_arrive'],
      ['trade_intents', 't_arrive']
    ];
    for (const [table, col] of need) {
      if (!tableExists(conn, table)) {
        return {
          ok: false,
          exitCode: EXIT_SCHEMA,
          reason: `FAIL_CLOSED missing table ${table}`
        };
      }
      if (!hasColumn(conn, table, col)) {
        return {
          ok: false,
          exitCode: EXIT_SCHEMA,
          reason: `FAIL_CLOSED missing column ${table}.${col}`
        };
      }
    }

    const signals = countCoverage(conn, 'trade_signals');
    const intents = countCoverage(conn, 'trade_intents');
    const signalRows = recentRows(conn, 'trade_signals', 'signal_id', limit);
    const intentRows = recentRows(conn, 'trade_intents', 'intent_id', limit);

    return {
      ok: true,
      exitCode: EXIT_OK,
      db: resolved,
      limit,
      trade_signals: signals,
      trade_intents: intents,
      recent_signals: signalRows,
      recent_intents: intentRows
    };
  } finally {
    try { conn.close(); } catch (_) {}
  }
}

function printReport(result) {
  if (!result.ok) {
    console.error(result.reason);
    return;
  }
  console.log(`db=${result.db}`);
  console.log(`limit=${result.limit}`);
  console.log(
    `trade_signals total=${result.trade_signals.total} with_t_arrive=${result.trade_signals.with_t_arrive} without_t_arrive=${result.trade_signals.without_t_arrive}`
  );
  console.log(
    `trade_intents total=${result.trade_intents.total} with_t_arrive=${result.trade_intents.with_t_arrive} without_t_arrive=${result.trade_intents.without_t_arrive}`
  );
  console.log('--- recent trade_signals ---');
  for (const row of result.recent_signals) {
    const flag = row.t_arrive ? 'HAS' : 'NULL';
    console.log(`${flag}\t${row.id}\t${row.ticker}\tt_arrive=${row.t_arrive || ''}\t${iso(row.t_arrive)}`);
  }
  console.log('--- recent trade_intents ---');
  for (const row of result.recent_intents) {
    const flag = row.t_arrive ? 'HAS' : 'NULL';
    console.log(`${flag}\t${row.id}\t${row.ticker}\tt_arrive=${row.t_arrive || ''}\t${iso(row.t_arrive)}`);
  }
  console.log('note: historical rows stay NULL (no backfill). live ingest should HAS after CHG-054 deploy.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = parseArgs();
  const result = checkObservedTArrive({ dbPath: args.db, limit: args.limit });
  printReport(result);
  process.exit(result.exitCode);
}
