/**
 * CHG-056 — 1s OHLCV from trades only (no live Longbridge).
 * Grok nail-down: trades only; empty seconds write nothing; no 1m/5m interp.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import {
  BANNED_QUOTE_CTX_METHODS,
  DEFAULT_SYMBOLS,
  DayJsonlWriter,
  MANIFEST_SOURCE,
  SecondBarAggregator,
  SUB_TYPE_DEPTH,
  SUB_TYPE_QUOTE,
  SUB_TYPE_TRADE,
  aggregateTicksToBars,
  assertNoOneSecondCandlestick,
  assertQuoteTradeSubTypes,
  calendarDateEt,
  dryRunPlan,
  expandMinuteBarsTo1s,
  floorToSecondMs,
  loadFixtureTicks,
  parseSymbols,
  persistBars,
  quoteHeartbeat,
  runWithReconnect,
  tickFromQuote,
  tickFromTrade,
  ticksFromPushTrades,
  wrapQuoteContextNoOneSecond
} from '../scripts/market/lib/ohlcv_1s.js';
import { main, parseCliArgs } from '../scripts/market/collect_1s_ohlcv.js';

const ROOT = path.resolve('.');
const SCRIPT = path.resolve('scripts/market/collect_1s_ohlcv.js');
const FIXTURE = path.resolve('test/fixtures/market_1s/ticks.jsonl');
const T0 = Date.UTC(2026, 8, 21, 14, 0, 0, 0);

describe('CHG-056 1s OHLCV aggregator', () => {
  it('cross-second bar cut', () => {
    const ticks = [
      { symbol: 'IREN', tsMs: T0, price: 10, volume: 1, n_trades: 1, source: 'trade' },
      { symbol: 'IREN', tsMs: T0 + 999, price: 12, volume: 2, n_trades: 1, source: 'trade' },
      { symbol: 'IREN', tsMs: T0 + 1000, price: 11, volume: 3, n_trades: 1, source: 'trade' }
    ];
    const agg = new SecondBarAggregator();
    assert.equal(agg.ingest(ticks[0]).length, 0);
    assert.equal(agg.ingest(ticks[1]).length, 0);
    const cut = agg.ingest(ticks[2]);
    assert.equal(cut.length, 1);
    assert.equal(cut[0].ts, T0 / 1000);
    assert.equal(cut[0].open, 10);
    assert.equal(cut[0].high, 12);
    assert.equal(cut[0].low, 10);
    assert.equal(cut[0].close, 12);
    assert.equal(cut[0].volume, 3);
    assert.equal(cut[0].n_trades, 2);
    const rest = agg.flushAll();
    assert.equal(rest[0].ts, (T0 + 1000) / 1000);
    assert.equal(rest[0].open, 11);
  });

  it('same-second multi-trade merge', () => {
    const bars = aggregateTicksToBars([
      { symbol: 'MU', tsMs: T0, price: 20, volume: 1, n_trades: 1, source: 'trade' },
      { symbol: 'MU', tsMs: T0 + 250, price: 22, volume: 4, n_trades: 1, source: 'trade' },
      { symbol: 'MU', tsMs: T0 + 800, price: 19, volume: 2, n_trades: 1, source: 'trade' }
    ]);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].open, 20);
    assert.equal(bars[0].high, 22);
    assert.equal(bars[0].low, 19);
    assert.equal(bars[0].close, 19);
    assert.equal(bars[0].volume, 7);
    assert.equal(bars[0].n_trades, 3);
  });

  it('second with no trade writes nothing', () => {
    const bars = aggregateTicksToBars([
      { symbol: 'CRWV', tsMs: T0, price: 5, volume: 1, n_trades: 1, source: 'trade' },
      { symbol: 'CRWV', tsMs: T0 + 4000, price: 6, volume: 1, n_trades: 1, source: 'trade' }
    ]);
    assert.equal(bars.length, 2);
    const seconds = bars.map((b) => b.ts);
    assert.equal(seconds.includes((T0 + 1000) / 1000), false);
    assert.equal(seconds.includes((T0 + 2000) / 1000), false);
    assert.equal(seconds.includes((T0 + 3000) / 1000), false);

    const quoteOnly = aggregateTicksToBars([
      { symbol: 'COHR', source: 'quote', tsMs: T0, lastDone: 51, bid: 50.9, ask: 51.1 }
    ]);
    assert.equal(quoteOnly.length, 0);

    const midOnly = aggregateTicksToBars([
      { symbol: 'COHR', tsMs: T0, mid: 51, bid: 50.9, ask: 51.1 }
    ]);
    assert.equal(midOnly.length, 0);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chg056-empty-'));
    const { results } = persistBars(quoteOnly, {
      outRoot: path.join(tmp, 'hot'),
      repoRoot: tmp,
      manifestPath: path.join(tmp, 'm.jsonl')
    });
    assert.equal(results.length, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'hot', 'COHR', '1s')), false);
    const skipped = new DayJsonlWriter({ outRoot: path.join(tmp, 'hot'), repoRoot: tmp }).writeBar({
      ts: T0 / 1000,
      symbol: 'COHR',
      open: 51,
      high: 51,
      low: 51,
      close: 51,
      volume: 0,
      n_trades: 0
    });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'no_trade');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('quote heartbeat never fills OHLC; prior close is not copied', () => {
    const bars = aggregateTicksToBars([
      { symbol: 'COHR', source: 'trade', tsMs: T0, price: 50, volume: 8 },
      { symbol: 'COHR', source: 'quote', tsMs: T0 + 10, lastDone: 51 },
      { symbol: 'COHR', source: 'quote', tsMs: T0 + 1500, lastDone: 52 }
    ]);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].high, 50);
    assert.equal(bars[0].close, 50);
    assert.equal(bars[0].n_trades, 1);
    const hb = quoteHeartbeat('SOXL.US', { lastDone: '9.1', timestamp: T0 + 1 });
    assert.equal(hb.kind, 'heartbeat');
    assert.equal(hb.source, 'quote');
    assert.equal(tickFromQuote('SOXL.US', { lastDone: '9.1', timestamp: T0 + 1 }).kind, 'heartbeat');
  });

  it('maps PushTrades; late ticks do not backfill', () => {
    const trades = ticksFromPushTrades('IREN.US', {
      trades: [{ price: '7.5', volume: 4, timestamp: new Date(T0) }]
    });
    assert.equal(trades[0].symbol, 'IREN');
    assert.equal(trades[0].price, 7.5);
    assert.equal(tickFromTrade('MU', { price: null, timestamp: T0 }), null);
    const agg = new SecondBarAggregator();
    agg.ingest({ symbol: 'CRWV', tsMs: T0, price: 1, volume: 1, n_trades: 1, source: 'trade' });
    const flushed = agg.ingest({ symbol: 'CRWV', tsMs: T0 + 1000, price: 2, volume: 1, n_trades: 1, source: 'trade' });
    assert.equal(flushed.length, 1);
    assert.equal(agg.ingest({ symbol: 'CRWV', tsMs: T0 + 500, price: 9, volume: 99, n_trades: 9, source: 'trade' }).length, 0);
    assert.equal(agg.flushAll()[0].high, 2);
  });

  it('bans interpolating 1s from 1m/5m', () => {
    const m1 = [{ ts: T0 / 1000, open: 1, high: 2, low: 1, close: 1.5, volume: 100, interval: '1m' }];
    const m5 = [{ ts: T0 / 1000, open: 1, high: 2, low: 1, close: 1.5, volume: 100, interval: '5m' }];
    assert.throws(() => expandMinuteBarsTo1s(m1), /FORBIDDEN_INTERPOLATE_1S/);
    assert.throws(() => expandMinuteBarsTo1s(m5), /FORBIDDEN_INTERPOLATE_1S/);
  });

  it('rotates day files on America/New_York midnight', () => {
    const before = Date.UTC(2026, 8, 22, 3, 59, 59, 400);
    const after = Date.UTC(2026, 8, 22, 4, 0, 0, 100);
    assert.equal(calendarDateEt(before), '2026-09-21');
    assert.equal(calendarDateEt(after), '2026-09-22');
    assert.equal(floorToSecondMs(before + 600), Date.UTC(2026, 8, 22, 4, 0, 0, 0));
  });

  it('writes jsonl + manifest source=longbridge_trade_agg', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chg056-'));
    const outRoot = path.join(tmp, 'hot');
    const manifestPath = path.join(tmp, 'market_1s.jsonl');
    const bars = aggregateTicksToBars([
      { symbol: 'IREN', tsMs: T0, price: 42, volume: 1, n_trades: 1, source: 'trade' }
    ]);
    const { manifestRows } = persistBars(bars, { outRoot, repoRoot: tmp, manifestPath });
    assert.equal(MANIFEST_SOURCE, 'longbridge_trade_agg');
    assert.equal(manifestRows[0].source, 'longbridge_trade_agg');
    assert.equal(manifestRows[0].cold_path, null);
    assert.match(manifestRows[0].sha256, /^[a-f0-9]{64}$/);
    const date = calendarDateEt(T0);
    const row = JSON.parse(fs.readFileSync(path.join(outRoot, 'IREN', '1s', `${date}.jsonl`), 'utf8').trim());
    assert.equal(row.n_trades, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reconnects without filling the hole', async () => {
    const seen = [];
    const out = await runWithReconnect({
      backoffMs: 1,
      maxAttempts: 3,
      once: true,
      connect: async (attempt) => {
        seen.push(attempt);
        if (attempt === 1) throw new Error('socket hang up');
      }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(seen, [1, 2]);
  });

  it('hard-fails Period.Second / candlestick=1s / depth / quote-only subscribe', () => {
    assert.throws(() => assertNoOneSecondCandlestick('1s'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertNoOneSecondCandlestick('Period.Second'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertNoOneSecondCandlestick('second'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertNoOneSecondCandlestick(0), /FORBIDDEN_1S_CANDLESTICK/);
    const ctx = wrapQuoteContextNoOneSecond({
      subscribe: async () => {},
      candlesticks: async () => [],
      subscribeCandlesticks: async () => []
    });
    assert.throws(() => ctx.candlesticks('IREN.US', '1s'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => ctx.subscribeCandlesticks('IREN.US', 0), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertQuoteTradeSubTypes([SUB_TYPE_DEPTH]), /FORBIDDEN_DEPTH/);
    assert.throws(() => assertQuoteTradeSubTypes([SUB_TYPE_QUOTE]), /SUBTYPES_REQUIRED/);
    assert.equal(assertQuoteTradeSubTypes([SUB_TYPE_TRADE]), true);
    assert.equal(assertQuoteTradeSubTypes([SUB_TYPE_TRADE, SUB_TYPE_QUOTE]), true);
    assert.throws(() => parseSymbols('A,B,C,D,E,F'), /MAX_SYMBOLS_5/);
  });

  it('fixture file ignores quotes; trade seconds only', () => {
    assert.equal(T0, 1789999200000);
    const ticks = loadFixtureTicks(FIXTURE);
    assert.equal(ticks.every((t) => t.source === 'trade'), true);
    const bars = aggregateTicksToBars(ticks);
    const iren = bars.filter((b) => b.symbol === 'IREN');
    assert.equal(iren.length, 2);
    assert.equal(iren[0].open, 42.1);
    assert.equal(iren[0].high, 42.25);
    assert.equal(iren[0].close, 42.15);
    assert.equal(iren[0].volume, 160);
    assert.equal(iren[0].n_trades, 3);
    assert.equal(iren[1].ts, (T0 + 1000) / 1000);
    const soxl = bars.filter((b) => b.symbol === 'SOXL');
    assert.equal(soxl.length, 1);
    assert.equal(soxl[0].close, 30);
    assert.equal(soxl[0].high, 30);
  });

  it('CLI --dry-run and --once --fixture work without live creds', async () => {
    const dry = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--symbols', 'IREN,SOXL,MU,CRWV,COHR'], {
      encoding: 'utf8',
      env: { ...process.env, LONGBRIDGE_APP_KEY: '', LONGBRIDGE_APP_SECRET: '', LONGBRIDGE_ACCESS_TOKEN: '' }
    });
    assert.equal(dry.status, 0, dry.stderr);
    const plan = JSON.parse(dry.stdout);
    assert.equal(plan.source, 'longbridge_trade_agg');
    assert.equal(plan.agg, 'trades_only');
    assert.equal(plan.empty_seconds, 'no_row');
    assert.equal(plan.candlestick_1s, 'forbidden');
    assert.equal(plan.period_second, 'forbidden');
    assert.equal(plan.interpolate_1m_5m, 'forbidden');
    assert.equal(plan.rclone_in_collector, false);
    assert.equal(Object.hasOwn(plan, 'rclone_example'), false);
    assert.deepEqual(plan.symbols, DEFAULT_SYMBOLS);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chg056-cli-'));
    const outRoot = path.join(tmp, 'hot');
    const manifest = path.join(tmp, 'manifest.jsonl');
    const once = await main(['--once', '--fixture', FIXTURE, '--out-root', outRoot, '--manifest', manifest]);
    assert.equal(once.ok, true);
    const date = calendarDateEt(T0);
    const irenLines = fs.readFileSync(path.join(outRoot, 'IREN', '1s', `${date}.jsonl`), 'utf8').trim().split('\n');
    assert.equal(irenLines.length, 2);
    const man = fs.readFileSync(manifest, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(man.every((r) => r.source === 'longbridge_trade_agg'), true);
    const liveFail = spawnSync(process.execPath, [SCRIPT, '--once'], {
      encoding: 'utf8',
      env: { ...process.env, LONGBRIDGE_APP_KEY: '', LONGBRIDGE_APP_SECRET: '', LONGBRIDGE_ACCESS_TOKEN: '' }
    });
    assert.equal(liveFail.status, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('collector never calls 1s candles or rclone; gitignore pins data/market/', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gi, /^data\/market\/$/m);
    const lib = fs.readFileSync(path.join(ROOT, 'scripts/market/lib/ohlcv_1s.js'), 'utf8');
    const cli = fs.readFileSync(path.join(ROOT, 'scripts/market/collect_1s_ohlcv.js'), 'utf8');
    for (const src of [lib, cli]) {
      assert.equal(/rclone\s+copy/i.test(src), false);
      assert.equal(/spawnSync\(\s*['"]rclone/.test(src), false);
      assert.equal(/query1\.finance\.yahoo|yahooapis/i.test(src), false);
      assert.equal(/place_order/.test(src), false);
      assert.equal(/subscribeCandlesticks\(/.test(src), false);
      assert.equal(/\.candlesticks\(/.test(src), false);
    }
    assert.equal(BANNED_QUOTE_CTX_METHODS.includes('subscribeCandlesticks'), true);
    const plan = dryRunPlan(parseCliArgs(['--symbols', 'IREN,SOXL,MU,CRWV,COHR']));
    assert.equal(plan.rclone_in_collector, false);
  });
});
