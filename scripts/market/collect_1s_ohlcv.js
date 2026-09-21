#!/usr/bin/env node
/**
 * CHG-056 — collect 1s OHLCV from Longbridge trade push only.
 *
 *   node scripts/market/collect_1s_ohlcv.js --symbols IREN,SOXL,MU,CRWV,COHR --out-root data/market/hot
 *   node scripts/market/collect_1s_ohlcv.js --dry-run
 *   node scripts/market/collect_1s_ohlcv.js --once --fixture test/fixtures/market_1s/ticks.jsonl --out-root /tmp/hot
 *
 * Live: subscribe Trade (OHLC) + optional Quote heartbeat. Never candlestick=1s / Period.Second.
 * Empty seconds: no row. Disconnect → reconnect; do not backfill.
 * Collector does not call rclone. GCP deploy after merge = Gemini.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CHG_ID,
  DEFAULT_SYMBOLS,
  DayJsonlWriter,
  MANIFEST_SOURCE,
  SecondBarAggregator,
  SUB_TYPE_QUOTE,
  SUB_TYPE_TRADE,
  assertQuoteTradeSubTypes,
  dryRunPlan,
  loadFixtureTicks,
  parseSymbols,
  persistBars,
  runWithReconnect,
  toLongbridgeSymbol,
  wrapQuoteContextNoOneSecond
} from './lib/ohlcv_1s.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

function argVal(argv, flag, fallback = null) {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) {
    return argv[i + 1];
  }
  const pref = argv.find((a) => a.startsWith(`${flag}=`));
  if (pref) return pref.slice(flag.length + 1);
  return fallback;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const outRoot = path.resolve(ROOT, argVal(argv, '--out-root', 'data/market/hot'));
  const manifestPath = path.resolve(ROOT, argVal(argv, '--manifest', 'data/manifest/market_1s.jsonl'));
  return {
    symbols: parseSymbols(argVal(argv, '--symbols', DEFAULT_SYMBOLS.join(','))),
    outRoot,
    manifestPath,
    dryRun: hasFlag(argv, '--dry-run'),
    once: hasFlag(argv, '--once'),
    fixture: argVal(argv, '--fixture', null),
    backoffMs: Number(argVal(argv, '--reconnect-ms', '2000')) || 2000,
    maxAttempts: argVal(argv, '--max-reconnects', null) == null
      ? Infinity
      : Number(argVal(argv, '--max-reconnects')),
    heartbeatMs: Number(argVal(argv, '--heartbeat-ms', '15000')) || 15000,
    idleMs: Number(argVal(argv, '--idle-ms', '0')) || 0
  };
}

function missingLiveCreds() {
  return !process.env.LONGBRIDGE_APP_KEY
    || !process.env.LONGBRIDGE_APP_SECRET
    || !process.env.LONGBRIDGE_ACCESS_TOKEN;
}

export async function createLiveQuoteContext() {
  const { Config, QuoteContext, SubType } = await import('longbridge');
  const appKey = process.env.LONGBRIDGE_APP_KEY;
  const appSecret = process.env.LONGBRIDGE_APP_SECRET;
  const accessToken = process.env.LONGBRIDGE_ACCESS_TOKEN;
  if (!appKey || !appSecret || !accessToken) {
    throw new Error('MISSING_LONGBRIDGE_CREDENTIALS');
  }
  const config = typeof Config.fromApikey === 'function'
    ? Config.fromApikey(appKey, appSecret, accessToken)
    : new Config({ appKey, appSecret, accessToken });
  let ctx;
  if (typeof QuoteContext.new === 'function') {
    ctx = await QuoteContext.new(config);
  } else if (typeof QuoteContext.create === 'function') {
    ctx = await QuoteContext.create(config);
  } else {
    throw new Error('QuoteContext initialization method not found');
  }
  return { ctx: wrapQuoteContextNoOneSecond(ctx), SubType };
}

function attachPushHandlers(ctx, onTick) {
  if (typeof ctx.setOnTrades === 'function') {
    ctx.setOnTrades((err, event) => {
      if (err) {
        onTick({ disconnect: true, error: err });
        return;
      }
      onTick({ kind: 'push_trades', event });
    });
  }
  if (typeof ctx.setOnQuote === 'function') {
    ctx.setOnQuote((err, event) => {
      if (err) {
        onTick({ disconnect: true, error: err });
        return;
      }
      onTick({ kind: 'heartbeat', event });
    });
  }
}

function eventSymbol(event) {
  return event?.symbol || event?.data?.symbol || '';
}

function ingestPush(agg, persistOpts, push) {
  const { ticksFromPushTrades } = persistOpts.helpers;
  if (push.kind === 'heartbeat' || push.kind === 'push_quote') {
    return;
  }
  if (push.kind !== 'push_trades') return;
  const ticks = ticksFromPushTrades(eventSymbol(push.event), push.event?.data || push.event);
  const bars = [];
  for (const tick of ticks) bars.push(...agg.ingest(tick));
  if (bars.length) persistBars(bars, persistOpts);
}

export async function replayFixture(opts) {
  const fixturePath = path.resolve(ROOT, opts.fixture);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`FIXTURE_MISSING: ${fixturePath}`);
  }
  const ticks = loadFixtureTicks(fixturePath);
  const bars = [];
  const agg = new SecondBarAggregator();
  for (const tick of ticks) bars.push(...agg.ingest(tick));
  bars.push(...agg.flushAll());
  const writer = new DayJsonlWriter({ outRoot: opts.outRoot, repoRoot: ROOT });
  return persistBars(bars, {
    outRoot: opts.outRoot,
    repoRoot: ROOT,
    manifestPath: opts.manifestPath,
    writer,
    source: MANIFEST_SOURCE
  });
}

export async function runLiveSession(opts, deps = {}) {
  const createContext = deps.createContext || createLiveQuoteContext;
  const { ticksFromPushTrades } = await import('./lib/ohlcv_1s.js');
  const agg = new SecondBarAggregator();
  const writer = new DayJsonlWriter({ outRoot: opts.outRoot, repoRoot: ROOT });
  const persistOpts = {
    outRoot: opts.outRoot,
    repoRoot: ROOT,
    manifestPath: opts.manifestPath,
    writer,
    source: MANIFEST_SOURCE,
    helpers: { ticksFromPushTrades }
  };
  const lbSymbols = opts.symbols.map(toLongbridgeSymbol);
  const subTypes = [SUB_TYPE_TRADE, SUB_TYPE_QUOTE];
  assertQuoteTradeSubTypes(subTypes);

  let stop = false;
  const onSignal = () => {
    stop = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    return await runWithReconnect({
      once: opts.once,
      backoffMs: opts.backoffMs,
      maxAttempts: opts.maxAttempts,
      shouldStop: () => stop,
      onError: (err, attempt) => {
        console.error(`[${CHG_ID}] disconnect attempt=${attempt}: ${err.message || err}`);
      },
      connect: async () => {
        const { ctx, SubType } = await createContext();
        const types = SubType
          ? [SubType.Trade, SubType.Quote]
          : subTypes;
        assertQuoteTradeSubTypes(types.map((t) => (typeof t === 'number' ? t : Number(t))));
        let disconnected = null;
        const disconnect = (err) => {
          if (!disconnected) disconnected = err || new Error('quote_disconnect');
        };
        attachPushHandlers(ctx, (push) => {
          if (push.disconnect) {
            disconnect(push.error);
            return;
          }
          ingestPush(agg, persistOpts, push);
        });
        await ctx.subscribe(lbSymbols, types);
        const started = Date.now();
        while (!stop) {
          if (disconnected) throw disconnected;
          if (opts.once && opts.idleMs && Date.now() - started >= opts.idleMs) break;
          if (typeof ctx.subscriptions === 'function') {
            try {
              await ctx.subscriptions();
            } catch (err) {
              throw err;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, opts.heartbeatMs));
        }
        persistBars(agg.flushAll(), persistOpts);
      }
    });
  } finally {
    persistBars(agg.flushAll(), persistOpts);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseCliArgs(argv);
  if (opts.dryRun) {
    const plan = dryRunPlan(opts);
    console.log(JSON.stringify(plan, null, 2));
    return { ok: true, mode: 'dry-run', plan };
  }
  if (opts.fixture) {
    const result = await replayFixture(opts);
    console.log(JSON.stringify({
      ok: true,
      mode: 'fixture',
      chg: CHG_ID,
      bars: result.results.filter((r) => !r.skipped).length,
      manifest: result.manifestRows
    }, null, 2));
    return { ok: true, mode: 'fixture', result };
  }
  if (opts.once && missingLiveCreds()) {
    throw new Error('ONCE_NEEDS_FIXTURE_OR_CREDS: pass --fixture for tests; live needs LONGBRIDGE_*');
  }
  if (missingLiveCreds()) {
    throw new Error('MISSING_LONGBRIDGE_CREDENTIALS: use --dry-run or --once --fixture without live keys');
  }
  const live = await runLiveSession(opts);
  return { ok: true, mode: 'live', live };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invoked) {
  main().catch((err) => {
    console.error(`[${CHG_ID}] ${err.message || err}`);
    process.exit(err.message && /^(MISSING_|ONCE_NEEDS_)/.test(String(err.message)) ? 2 : 1);
  });
}
