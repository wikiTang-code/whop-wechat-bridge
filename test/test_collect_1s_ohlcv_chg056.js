/**
 * CHG-056 — 1s OHLCV from fake ticks (no live Longbridge).
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
  floorToSecondMs,
  loadFixtureTicks,
  parseSymbols,
  persistBars,
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
  it('cuts bars on the second boundary and keeps OHLCV', () => {
    const ticks = [
      { symbol: 'IREN', tsMs: T0, price: 10, volume: 1, n_trades: 1, source: 'trade' },
      { symbol: 'IREN', tsMs: T0 + 999, price: 12, volume: 2, n_trades: 1, source: 'trade' },
      { symbol: 'IREN', tsMs: T0 + 1000, price: 11, volume: 3, n_trades: 1, source: 'trade' }
    ];
    const agg = new SecondBarAggregator();
    const first = agg.ingest(ticks[0]);
    assert.equal(first.length, 0);
    const stillOpen = agg.ingest(ticks[1]);
    assert.equal(stillOpen.length, 0);
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
    assert.equal(rest[0].volume, 3);
  });

  it('does not invent bars across a gap', () => {
    const bars = aggregateTicksToBars([
      { symbol: 'MU', tsMs: T0, price: 100, volume: 1, n_trades: 1, source: 'trade' },
      { symbol: 'MU', tsMs: T0 + 4000, price: 101, volume: 1, n_trades: 1, source: 'trade' }
    ]);
    assert.equal(bars.length, 2);
    assert.equal(bars[0].ts, T0 / 1000);
    assert.equal(bars[1].ts, (T0 + 4000) / 1000);
    const seconds = bars.map((b) => b.ts);
    assert.equal(seconds.includes((T0 + 1000) / 1000), false);
    assert.equal(seconds.includes((T0 + 2000) / 1000), false);
    assert.equal(seconds.includes((T0 + 3000) / 1000), false);
  });

  it('drops late ticks after the open bar moved (no fake backfill)', () => {
    const agg = new SecondBarAggregator();
    agg.ingest({ symbol: 'CRWV', tsMs: T0, price: 1, volume: 1, n_trades: 1, source: 'trade' });
    const flushed = agg.ingest({ symbol: 'CRWV', tsMs: T0 + 1000, price: 2, volume: 1, n_trades: 1, source: 'trade' });
    assert.equal(flushed.length, 1);
    const late = agg.ingest({ symbol: 'CRWV', tsMs: T0 + 500, price: 9, volume: 99, n_trades: 9, source: 'trade' });
    assert.equal(late.length, 0);
    const open = agg.flushAll();
    assert.equal(open[0].open, 2);
    assert.equal(open[0].high, 2);
    assert.equal(open[0].volume, 1);
  });

  it('quotes update OHLC but do not count as trades', () => {
    const bars = aggregateTicksToBars([
      { symbol: 'COHR', source: 'trade', tsMs: T0, price: 50, volume: 8 },
      { symbol: 'COHR', source: 'quote', tsMs: T0 + 10, lastDone: 51 }
    ]);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].open, 50);
    assert.equal(bars[0].high, 51);
    assert.equal(bars[0].close, 51);
    assert.equal(bars[0].volume, 8);
    assert.equal(bars[0].n_trades, 1);
  });

  it('maps PushTrades / PushQuote plain objects', () => {
    const trades = ticksFromPushTrades('IREN.US', {
      trades: [{ price: '7.5', volume: 4, timestamp: new Date(T0) }]
    });
    assert.equal(trades[0].symbol, 'IREN');
    assert.equal(trades[0].price, 7.5);
    const q = tickFromQuote('SOXL.US', { lastDone: '9.1', timestamp: T0 + 1 });
    assert.equal(q.symbol, 'SOXL');
    assert.equal(q.n_trades, 0);
    assert.equal(tickFromTrade('MU', { price: null, timestamp: T0 }), null);
  });

  it('rotates day files on America/New_York midnight', () => {
    const before = Date.UTC(2026, 8, 22, 3, 59, 59, 400);
    const after = Date.UTC(2026, 8, 22, 4, 0, 0, 100);
    assert.equal(calendarDateEt(before), '2026-09-21');
    assert.equal(calendarDateEt(after), '2026-09-22');
    assert.equal(floorToSecondMs(before + 600), Date.UTC(2026, 8, 22, 4, 0, 0, 0));
  });

  it('writes jsonl + manifest with sha256 and nullable cold_path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chg056-'));
    const outRoot = path.join(tmp, 'hot');
    const manifestPath = path.join(tmp, 'market_1s.jsonl');
    const bars = aggregateTicksToBars([
      { symbol: 'IREN', tsMs: T0, price: 42, volume: 1, n_trades: 1, source: 'trade' }
    ]);
    const { manifestRows } = persistBars(bars, {
      outRoot,
      repoRoot: tmp,
      manifestPath
    });
    assert.equal(manifestRows.length, 1);
    assert.equal(manifestRows[0].source, MANIFEST_SOURCE);
    assert.equal(manifestRows[0].cold_path, null);
    assert.equal(manifestRows[0].n_rows, 1);
    assert.match(manifestRows[0].sha256, /^[a-f0-9]{64}$/);
    const date = calendarDateEt(T0);
    const filePath = path.join(outRoot, 'IREN', '1s', `${date}.jsonl`);
    assert.equal(fs.existsSync(filePath), true);
    const row = JSON.parse(fs.readFileSync(filePath, 'utf8').trim());
    assert.equal(row.symbol, 'IREN');
    assert.equal(row.open, 42);
    persistBars(bars, { outRoot, repoRoot: tmp, manifestPath, writer: new DayJsonlWriter({ outRoot, repoRoot: tmp }) });
    assert.equal(fs.readFileSync(manifestPath, 'utf8').trim().split('\n').length, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reconnects without filling the hole', async () => {
    const seen = [];
    let n = 0;
    const out = await runWithReconnect({
      backoffMs: 1,
      maxAttempts: 3,
      once: true,
      connect: async (attempt) => {
        n += 1;
        seen.push(attempt);
        if (attempt === 1) throw new Error('socket hang up');
      }
    });
    assert.equal(out.ok, true);
    assert.equal(n, 2);
    assert.deepEqual(seen, [1, 2]);
  });

  it('hard-fails candlestick=1s and depth subscribe', () => {
    assert.throws(() => assertNoOneSecondCandlestick('1s'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertNoOneSecondCandlestick(0), /FORBIDDEN_1S_CANDLESTICK/);
    const ctx = wrapQuoteContextNoOneSecond({
      subscribe: async () => {},
      candlesticks: async () => [],
      subscribeCandlesticks: async () => []
    });
    assert.throws(() => ctx.candlesticks('IREN.US', '1s'), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => ctx.subscribeCandlesticks('IREN.US', 0), /FORBIDDEN_1S_CANDLESTICK/);
    assert.throws(() => assertQuoteTradeSubTypes([SUB_TYPE_DEPTH]), /FORBIDDEN_DEPTH/);
    assert.equal(assertQuoteTradeSubTypes([SUB_TYPE_QUOTE, SUB_TYPE_TRADE]), true);
    assert.throws(() => parseSymbols('A,B,C,D,E,F'), /MAX_SYMBOLS_5/);
    assert.deepEqual(parseSymbols('iren,soxl'), ['IREN', 'SOXL']);
  });

  it('fixture file aggregates the same as the unit ticks', () => {
    assert.equal(T0, 1789999200000);
    const ticks = loadFixtureTicks(FIXTURE);
    const bars = aggregateTicksToBars(ticks);
    const iren = bars.filter((b) => b.symbol === 'IREN');
    assert.equal(iren.length, 3);
    assert.equal(iren[0].open, 42.1);
    assert.equal(iren[0].high, 42.25);
    assert.equal(iren[0].low, 42.1);
    assert.equal(iren[0].close, 42.15);
    assert.equal(iren[0].volume, 160);
    assert.equal(iren[0].n_trades, 3);
    assert.equal(iren[1].ts, (T0 + 1000) / 1000);
    assert.equal(iren[2].n_trades, 0);
    assert.equal(iren[2].volume, 0);
    assert.equal(iren[2].close, 42.3);
  });

  it('CLI --dry-run and --once --fixture work without live creds', async () => {
    const dry = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--symbols', 'IREN,SOXL,MU,CRWV,COHR'], {
      encoding: 'utf8',
      env: { ...process.env, LONGBRIDGE_APP_KEY: '', LONGBRIDGE_APP_SECRET: '', LONGBRIDGE_ACCESS_TOKEN: '' }
    });
    assert.equal(dry.status, 0, dry.stderr);
    const plan = JSON.parse(dry.stdout);
    assert.equal(plan.candlestick_1s, 'forbidden');
    assert.equal(plan.yahoo_1s, 'forbidden');
    assert.equal(plan.rclone_installed, false);
    assert.match(plan.rclone_example, /rclone copy .*gdrive:whop-market\//);
    assert.equal(plan.cold_path, null);
    assert.deepEqual(plan.symbols, DEFAULT_SYMBOLS);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chg056-cli-'));
    const outRoot = path.join(tmp, 'hot');
    const manifest = path.join(tmp, 'manifest.jsonl');
    const once = await main([
      '--once',
      '--fixture', FIXTURE,
      '--out-root', outRoot,
      '--manifest', manifest
    ]);
    assert.equal(once.ok, true);
    assert.equal(once.mode, 'fixture');
    const date = calendarDateEt(T0);
    assert.equal(fs.existsSync(path.join(outRoot, 'IREN', '1s', `${date}.jsonl`)), true);
    assert.equal(fs.existsSync(path.join(outRoot, 'SOXL', '1s', `${date}.jsonl`)), true);
    const man = fs.readFileSync(manifest, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(man.every((r) => r.source === MANIFEST_SOURCE), true);
    assert.equal(man.every((r) => r.cold_path === null), true);
    const liveFail = spawnSync(process.execPath, [SCRIPT, '--once'], {
      encoding: 'utf8',
      env: { ...process.env, LONGBRIDGE_APP_KEY: '', LONGBRIDGE_APP_SECRET: '', LONGBRIDGE_ACCESS_TOKEN: '' }
    });
    assert.equal(liveFail.status, 2);
    assert.match(liveFail.stderr, /ONCE_NEEDS_FIXTURE_OR_CREDS|MISSING_LONGBRIDGE/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('gitignore pins data/market/ and collector sources never call 1s candles', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gi, /^data\/market\/$/m);
    assert.match(gi, /rclone\.conf/);
    const lib = fs.readFileSync(path.join(ROOT, 'scripts/market/lib/ohlcv_1s.js'), 'utf8');
    const cli = fs.readFileSync(path.join(ROOT, 'scripts/market/collect_1s_ohlcv.js'), 'utf8');
    for (const src of [lib, cli]) {
      assert.equal(/query1\.finance\.yahoo|yahooapis/i.test(src), false);
      assert.equal(/place_order/.test(src), false);
      assert.equal(/subscribeCandlesticks\(/.test(src), false);
      assert.equal(/\.candlesticks\(/.test(src), false);
    }
    assert.equal(BANNED_QUOTE_CTX_METHODS.includes('subscribeCandlesticks'), true);
    const args = parseCliArgs(['--symbols', 'IREN,SOXL,MU,CRWV,COHR', '--out-root', 'data/market/hot']);
    assert.deepEqual(args.symbols, DEFAULT_SYMBOLS);
    const plan = dryRunPlan(args);
    assert.equal(plan.systemd_storage_claim, 'forbidden');
  });
});
