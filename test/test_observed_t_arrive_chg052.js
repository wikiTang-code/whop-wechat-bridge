/**
 * CHG-052 — observed t_arrive on live ingest / Intent create.
 * Historical REQ-058 hypothesized path must stay on t_arrive_hat.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ensurePaperTradingTables,
  ensureObservedArrivalColumns,
  saveTradeIntent,
  getTradeIntent,
  saveTradeSignal
} from '../database.js';
import { createTradeIntent } from '../tools/trade/paper_execution_engine.js';
import { convertSignalToTradeIntent, ZHAO_SENDER_ID, ALLOWED_CHANNELS } from '../tools/trade/signal_intent_bridge.js';
import { stampObservedArrival, resolveObservedPxArrive } from '../tools/trade/observed_arrival.js';
import { sweepEvent, ZHAO_SPEAKER_ID } from '../scripts/knowledge/lib/delayed_follow_e_v0.js';

const T0 = Date.UTC(2026, 8, 18, 14, 0, 0);

function makeBars() {
  return [
    { time: T0, open: 100.1, high: 101, low: 99.5, close: 100.4 },
    { time: T0 + 5 * 60 * 1000, open: 100.3, high: 102, low: 100, close: 101 }
  ];
}

describe('CHG-052 observed t_arrive ingest', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    ensurePaperTradingTables(db);
    db.prepare(`
      CREATE TABLE IF NOT EXISTS trade_signals (
        signal_id TEXT PRIMARY KEY,
        message_id TEXT,
        channel_id TEXT,
        speaker_id TEXT,
        speaker_name TEXT,
        ticker TEXT NOT NULL,
        action TEXT NOT NULL,
        price REAL NOT NULL,
        quantity INTEGER,
        stop_loss REAL,
        reason TEXT,
        parse_status TEXT NOT NULL DEFAULT 'ok',
        source TEXT NOT NULL DEFAULT 'ai_extract',
        created_at INTEGER NOT NULL
      )
    `).run();
    ensureObservedArrivalColumns(db);
  });

  it('Intent create stamps t_arrive (observed) and persists the field', () => {
    const before = Date.now();
    const intent = createTradeIntent({
      ticker: 'IREN',
      side: 'BUY',
      quantity: 1,
      price_limit: 42.5,
      source: 'test_chg052'
    }, { dbInstance: db });
    const after = Date.now();
    assert.equal(Object.hasOwn(intent, 't_arrive'), true);
    assert.ok(intent.t_arrive >= before && intent.t_arrive <= after);
    assert.equal(intent.t_arrive_kind, 'observed');
    const saved = getTradeIntent(intent.intent_id, db);
    assert.equal(saved.t_arrive, intent.t_arrive);
    assert.equal(saved.t_arrive_kind, 'observed');
  });

  it('poll-seen t_arrive is kept; not overwritten by now', () => {
    const seen = 1_700_000_000_000;
    const intent = createTradeIntent({
      ticker: 'SOXL',
      side: 'BUY',
      quantity: 1,
      price_limit: 10,
      t_arrive: seen
    }, { dbInstance: db });
    assert.equal(intent.t_arrive, seen);
    assert.equal(getTradeIntent(intent.intent_id, db).t_arrive, seen);
  });

  it('does not copy oral/px_zhao into px_arrive', () => {
    const fromOral = resolveObservedPxArrive({ px_arrive: 42.5, px_arrive_source: 'oral' });
    assert.equal(fromOral.px_arrive, null);
    const fromZhao = resolveObservedPxArrive({ px_arrive: 42.5, px_arrive_source: 'px_zhao' });
    assert.equal(fromZhao.px_arrive, null);
    const missingSrc = resolveObservedPxArrive({ px_arrive: 42.5 });
    assert.equal(missingSrc.px_arrive, null);

    const res = convertSignalToTradeIntent({
      signal_id: 'sig_oral',
      speaker_id: ZHAO_SENDER_ID,
      channel_id: ALLOWED_CHANNELS[0],
      ticker: 'MU',
      action: 'BUY',
      price: 88.8,
      quantity: 1,
      px_arrive: 88.8,
      px_arrive_source: 'oral'
    }, { dbInstance: db });
    assert.equal(res.success, true);
    assert.equal(res.intent.px_zhao, 88.8);
    assert.equal(res.intent.px_arrive, null);
    assert.equal(res.intent.price_limit, 88.8);
    const saved = getTradeIntent(res.intent.intent_id, db);
    assert.equal(saved.px_zhao, 88.8);
    assert.equal(saved.px_arrive, null);
  });

  it('does not fill px_arrive from K-line / bar_open', () => {
    const kline = resolveObservedPxArrive({ px_arrive: 101.2, px_arrive_source: 'kline' });
    assert.equal(kline.px_arrive, null);
    const bar = resolveObservedPxArrive({ px_arrive: 101.2, px_arrive_source: 'bar_open' });
    assert.equal(bar.px_arrive, null);
    const quote = resolveObservedPxArrive({ px_arrive: 101.2, px_arrive_source: 'quote' });
    assert.equal(quote.px_arrive, 101.2);
  });

  it('saveTradeSignal stamps t_arrive and never copies oral price into px_arrive', () => {
    const tMsg = T0;
    const id = saveTradeSignal({
      signal_id: 'sig_clock',
      ticker: 'COHR',
      action: 'BUY',
      price: 55.5,
      created_at: tMsg,
      px_arrive: 55.5,
      px_arrive_source: 'oral'
    }, db);
    const row = db.prepare('SELECT * FROM trade_signals WHERE signal_id = ?').get(id);
    assert.ok(row.t_arrive);
    assert.notEqual(row.t_arrive, tMsg);
    assert.equal(row.price, 55.5);
    assert.equal(row.px_arrive, null);
  });

  it('conflict update keeps first-seen t_arrive', () => {
    const first = 1_600_000_000_000;
    saveTradeSignal({
      signal_id: 'sig_first',
      ticker: 'CRWV',
      action: 'BUY',
      price: 1,
      t_arrive: first
    }, db);
    saveTradeSignal({
      signal_id: 'sig_first',
      ticker: 'CRWV',
      action: 'BUY',
      price: 2,
      t_arrive: first + 99999
    }, db);
    const row = db.prepare('SELECT * FROM trade_signals WHERE signal_id = ?').get('sig_first');
    assert.equal(row.t_arrive, first);
    assert.equal(row.price, 2);
  });

  it('historical hypothesized path is unchanged (no t_arrive on E-layer rows)', () => {
    const rows = sweepEvent(
      {
        event_id: 'hist_1',
        symbol: 'IREN',
        side: 'BUY',
        t_msg: T0,
        t_msg_kind: 'message_clock',
        px_zhao: 100,
        speaker_id: ZHAO_SPEAKER_ID,
        channel_id: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
      },
      makeBars(),
      [0],
      { interval: '5m', barSource: 'fixture' }
    );
    const row = rows[0];
    assert.equal(Object.hasOwn(row, 't_arrive'), false);
    assert.equal(row.arrival_kind, 'hypothesized');
    assert.equal(row.t_msg_kind, 'message_clock');
    assert.equal(row.t_arrive_hat, T0);
    assert.equal(row.px_arrive, 100.1);
    assert.notEqual(row.px_arrive, row.px_zhao);
  });

  it('direct saveTradeIntent without t_arrive still writes observed now (new rows only)', () => {
    const before = Date.now();
    const intent = {
      intent_id: 'intent_manual_chg052',
      source: 'test',
      ticker: 'IREN',
      side: 'BUY',
      quantity: 1,
      price_limit: 10,
      status: 'DRAFT',
      created_at: before
    };
    saveTradeIntent(intent, db);
    const saved = getTradeIntent('intent_manual_chg052', db);
    assert.ok(saved.t_arrive >= before);
    assert.equal(saved.t_arrive_kind, 'observed');
  });

  it('stampObservedArrival never aliases oral as px_arrive', () => {
    const stamped = stampObservedArrival({ px_zhao: 50, px_arrive: 50, px_arrive_source: 'oral' });
    assert.equal(stamped.px_zhao, 50);
    assert.equal(stamped.px_arrive, null);
    assert.equal(stamped.t_arrive_kind, 'observed');
  });
});
