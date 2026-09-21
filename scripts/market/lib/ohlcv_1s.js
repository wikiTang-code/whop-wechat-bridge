/**
 * CHG-056 — in-process 1s OHLCV from quote/trade ticks.
 * Longbridge Period min is Min_1; never call candlestick=1s.
 * No Yahoo interpolation, no depth/ten-level, no fake gap fill.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const CHG_ID = 'CHG-056';
export const MANIFEST_SOURCE = 'longbridge_quote_trade_agg';
export const DEFAULT_SYMBOLS = Object.freeze(['IREN', 'SOXL', 'MU', 'CRWV', 'COHR']);
export const MAX_SYMBOLS = 5;
export const BAR_MS = 1000;
export const BAR_TZ = 'America/New_York';
export const SUB_TYPE_QUOTE = 0;
export const SUB_TYPE_TRADE = 3;
export const SUB_TYPE_DEPTH = 1;
export const SUB_TYPE_BROKERS = 2;
export const BANNED_QUOTE_CTX_METHODS = Object.freeze([
  'candlesticks',
  'subscribeCandlesticks',
  'unsubscribeCandlesticks',
  'historyCandlesticksByOffset',
  'historyCandlesticksByDate',
  'realtimeCandlesticks'
]);

const FORBIDDEN_1S = new Error(
  'FORBIDDEN_1S_CANDLESTICK: Longbridge Period min is Min_1; aggregate from quote/trade push only'
);

export function toNumber(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (typeof value.valueOf === 'function') {
    const inner = value.valueOf();
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
    if (typeof inner === 'string') return Number(inner);
  }
  if (typeof value.toString === 'function') {
    const s = value.toString();
    if (s && s !== '[object Object]') return Number(s);
  }
  return NaN;
}

export function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const n = toNumber(value);
  if (!Number.isFinite(n)) return NaN;
  if (n > 0 && n < 1e11) return Math.floor(n * 1000);
  return Math.floor(n);
}

export function floorToSecondMs(tsMs) {
  return Math.floor(Number(tsMs) / BAR_MS) * BAR_MS;
}

export function calendarDateEt(tsMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BAR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(tsMs));
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function toLongbridgeSymbol(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return '';
  if (t.includes('.')) return t;
  return `${t}.US`;
}

export function fromLongbridgeSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  return s.endsWith('.US') ? s.slice(0, -3) : s;
}

export function parseSymbols(raw, fallback = DEFAULT_SYMBOLS) {
  const text = raw == null || raw === '' ? fallback.join(',') : String(raw);
  const symbols = [...new Set(text.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) {
    throw new Error('SYMBOLS_EMPTY');
  }
  if (symbols.length > MAX_SYMBOLS) {
    throw new Error(`MAX_SYMBOLS_${MAX_SYMBOLS}: 80-symbol pool is forbidden`);
  }
  return symbols;
}

export function assertQuoteTradeSubTypes(subTypes) {
  const list = Array.isArray(subTypes) ? subTypes : [];
  for (const t of list) {
    const n = typeof t === 'number' ? t : Number(t);
    if (n === SUB_TYPE_DEPTH || String(t).toLowerCase() === 'depth') {
      throw new Error('FORBIDDEN_DEPTH: ten-level / depth subscribe is out of scope');
    }
    if (n === SUB_TYPE_BROKERS || String(t).toLowerCase() === 'brokers') {
      throw new Error('FORBIDDEN_BROKERS: broker queue subscribe is out of scope');
    }
  }
  const ok = list.some((t) => t === SUB_TYPE_QUOTE || t === 'Quote' || Number(t) === SUB_TYPE_QUOTE)
    || list.some((t) => t === SUB_TYPE_TRADE || t === 'Trade' || Number(t) === SUB_TYPE_TRADE);
  if (!ok) {
    throw new Error('SUBTYPES_REQUIRED: subscribe Quote and/or Trade only');
  }
  return true;
}

export function assertNoOneSecondCandlestick(period) {
  if (period == null) return true;
  const raw = typeof period === 'string' ? period.trim().toLowerCase() : period;
  if (raw === 0 || raw === '0' || raw === '1s' || raw === 's1' || raw === 'second' || raw === 'sec') {
    throw FORBIDDEN_1S;
  }
  return true;
}

export function wrapQuoteContextNoOneSecond(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BANNED_QUOTE_CTX_METHODS.includes(prop)) {
        return () => {
          throw FORBIDDEN_1S;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function tickFromTrade(symbol, trade) {
  const price = toNumber(trade?.price);
  const tsMs = toMs(trade?.timestamp ?? trade?.tsMs ?? trade?.time);
  if (!Number.isFinite(price) || !Number.isFinite(tsMs)) return null;
  return {
    symbol: fromLongbridgeSymbol(symbol || trade?.symbol),
    tsMs,
    price,
    volume: Number.isFinite(toNumber(trade?.volume)) ? toNumber(trade.volume) : 0,
    n_trades: 1,
    source: 'trade'
  };
}

export function tickFromQuote(symbol, quote) {
  const price = toNumber(quote?.lastDone ?? quote?.price ?? quote?.last_done);
  const tsMs = toMs(quote?.timestamp ?? quote?.tsMs ?? quote?.time);
  if (!Number.isFinite(price) || !Number.isFinite(tsMs)) return null;
  return {
    symbol: fromLongbridgeSymbol(symbol || quote?.symbol),
    tsMs,
    price,
    volume: 0,
    n_trades: 0,
    source: 'quote'
  };
}

export function ticksFromPushTrades(symbol, payload) {
  const trades = Array.isArray(payload) ? payload : (payload?.trades || []);
  return trades.map((t) => tickFromTrade(symbol, t)).filter(Boolean);
}

export function normalizeTick(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'quote' || raw.source === 'quote') {
    return tickFromQuote(raw.symbol, raw);
  }
  if (raw.kind === 'trade' || raw.source === 'trade' || raw.price != null) {
    const tick = tickFromTrade(raw.symbol, raw);
    if (tick && raw.n_trades != null) tick.n_trades = Number(raw.n_trades) || 0;
    return tick;
  }
  return null;
}

function newBar(tick, tsMs) {
  return {
    ts: tsMs / 1000,
    symbol: tick.symbol,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: tick.volume || 0,
    n_trades: tick.n_trades || 0
  };
}

function applyTick(bar, tick) {
  bar.high = Math.max(bar.high, tick.price);
  bar.low = Math.min(bar.low, tick.price);
  bar.close = tick.price;
  bar.volume += tick.volume || 0;
  bar.n_trades += tick.n_trades || 0;
}

export class SecondBarAggregator {
  constructor() {
    this.open = new Map();
  }

  ingest(tick) {
    const flushed = [];
    const normalized = (tick && Number.isFinite(tick.price) && Number.isFinite(tick.tsMs) && tick.symbol)
      ? {
        symbol: tick.symbol,
        tsMs: tick.tsMs,
        price: tick.price,
        volume: tick.volume || 0,
        n_trades: Number.isFinite(tick.n_trades)
          ? tick.n_trades
          : (tick.source === 'quote' ? 0 : 1),
        source: tick.source
      }
      : normalizeTick(tick);
    if (!normalized || !normalized.symbol || !Number.isFinite(normalized.price) || !Number.isFinite(normalized.tsMs)) {
      return flushed;
    }
    const sec = floorToSecondMs(normalized.tsMs);
    const cur = this.open.get(normalized.symbol);
    if (!cur) {
      this.open.set(normalized.symbol, newBar(normalized, sec));
      return flushed;
    }
    const curMs = cur.ts * 1000;
    if (sec < curMs) {
      return flushed;
    }
    if (sec === curMs) {
      applyTick(cur, normalized);
      return flushed;
    }
    flushed.push(cur);
    this.open.set(normalized.symbol, newBar(normalized, sec));
    return flushed;
  }

  flushAll() {
    const out = [...this.open.values()];
    this.open.clear();
    return out;
  }
}

export function aggregateTicksToBars(ticks) {
  const agg = new SecondBarAggregator();
  const bars = [];
  for (const tick of ticks) {
    bars.push(...agg.ingest(tick));
  }
  bars.push(...agg.flushAll());
  return bars;
}

export function dayFilePath(outRoot, symbol, dateStr) {
  return path.join(outRoot, symbol, '1s', `${dateStr}.jsonl`);
}

export function posixRel(fromDir, absPath) {
  return path.relative(fromDir, absPath).split(path.sep).join('/');
}

export function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function countJsonlRows(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text) return 0;
  return text.split('\n').filter((line) => line.trim()).length;
}

export class DayJsonlWriter {
  constructor({ outRoot, repoRoot, lastTs = new Map() }) {
    this.outRoot = outRoot;
    this.repoRoot = repoRoot;
    this.lastTs = lastTs;
  }

  writeBar(bar) {
    const tsMs = bar.ts * 1000;
    const date = calendarDateEt(tsMs);
    const filePath = dayFilePath(this.outRoot, bar.symbol, date);
    const key = `${bar.symbol}|${date}`;
    const prev = this.lastTs.get(key);
    if (prev != null && bar.ts < prev) {
      return { skipped: true, reason: 'stale', path: filePath, date };
    }
    if (prev != null && bar.ts === prev) {
      return { skipped: true, reason: 'dup', path: filePath, date };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(bar)}\n`);
    this.lastTs.set(key, bar.ts);
    return { skipped: false, path: filePath, date, n_rows: countJsonlRows(filePath) };
  }
}

export function upsertManifest(manifestPath, row) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const rows = [];
  if (fs.existsSync(manifestPath)) {
    const text = fs.readFileSync(manifestPath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* drop corrupt line */
      }
    }
  }
  const keyOf = (r) => `${r.symbol}|${r.date}`;
  const next = {
    path: row.path,
    symbol: row.symbol,
    date: row.date,
    n_rows: row.n_rows,
    sha256: row.sha256,
    source: row.source || MANIFEST_SOURCE,
    cold_path: row.cold_path == null || row.cold_path === '' ? null : row.cold_path
  };
  const idx = rows.findIndex((r) => keyOf(r) === keyOf(next));
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, manifestPath);
  return next;
}

export function manifestRowForFile({ repoRoot, filePath, symbol, date, source = MANIFEST_SOURCE }) {
  return {
    path: posixRel(repoRoot, filePath),
    symbol,
    date,
    n_rows: countJsonlRows(filePath),
    sha256: sha256File(filePath),
    source,
    cold_path: null
  };
}

export function persistBars(bars, { outRoot, repoRoot, manifestPath, writer, source = MANIFEST_SOURCE }) {
  const w = writer || new DayJsonlWriter({ outRoot, repoRoot });
  const touched = new Map();
  const results = [];
  for (const bar of bars) {
    const wrote = w.writeBar(bar);
    results.push(wrote);
    if (!wrote.skipped) {
      touched.set(`${bar.symbol}|${wrote.date}`, { filePath: wrote.path, symbol: bar.symbol, date: wrote.date });
    }
  }
  const manifestRows = [];
  for (const item of touched.values()) {
    const row = manifestRowForFile({
      repoRoot,
      filePath: item.filePath,
      symbol: item.symbol,
      date: item.date,
      source
    });
    if (manifestPath) upsertManifest(manifestPath, row);
    manifestRows.push(row);
  }
  return { results, manifestRows, writer: w };
}

export function loadFixtureTicks(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const ticks = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    const tick = normalizeTick(obj);
    if (tick) ticks.push(tick);
  }
  return ticks;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithReconnect(opts) {
  const {
    connect,
    onError,
    shouldStop = () => false,
    backoffMs = 2000,
    maxAttempts = Infinity,
    once = false
  } = opts;
  let attempt = 0;
  let lastError = null;
  while (!shouldStop()) {
    attempt += 1;
    try {
      await connect(attempt);
      if (once) return { attempts: attempt, ok: true };
    } catch (err) {
      lastError = err;
      if (typeof onError === 'function') onError(err, attempt);
      if (once && attempt >= (Number.isFinite(maxAttempts) ? maxAttempts : 1)) {
        throw err;
      }
      if (Number.isFinite(maxAttempts) && attempt >= maxAttempts) {
        throw err;
      }
      if (shouldStop()) break;
      await sleep(backoffMs);
    }
  }
  return { attempts: attempt, ok: false, lastError };
}

export function rcloneCopyExample(symbol, dateStr) {
  const [y, m] = String(dateStr).split('-');
  return `rclone copy data/market/hot/${symbol}/1s/${dateStr}.jsonl gdrive:whop-market/${y}/${m}/${symbol}/1s/`;
}

export function dryRunPlan(opts) {
  const symbols = opts.symbols || DEFAULT_SYMBOLS;
  const date = opts.date || calendarDateEt(Date.now());
  return {
    chg: CHG_ID,
    mode: 'dry-run',
    symbols,
    outRoot: opts.outRoot,
    manifestPath: opts.manifestPath,
    source: MANIFEST_SOURCE,
    period_min: 'Min_1',
    candlestick_1s: 'forbidden',
    backfill: 'forbidden',
    depth: 'forbidden',
    yahoo_1s: 'forbidden',
    systemd_storage_claim: 'forbidden',
    rclone_installed: false,
    rclone_example: rcloneCopyExample(symbols[0], date),
    hot_retention: 'gcp 60-90d (operator after merge; Gemini deploys)',
    paper_filled: 'separate lane',
    cold_path: null
  };
}
