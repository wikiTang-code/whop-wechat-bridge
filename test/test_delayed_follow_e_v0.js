/**
 * REQ-058 delayed-follow E-layer v0 (synthetic bars/events, no network/DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  DELAYED_FOLLOW_POLICY,
  ZHAO_SPEAKER_ID,
  assertNoOralPriceLeakage,
  buyEventFromNormalized,
  decideExecAbc,
  etWallClockToUtcMs,
  extractBuysFromL2aRecord,
  findBarContaining,
  hypothesizedArrivalMs,
  loadBuyEventsFromJsonlLines,
  parseDeltaMins,
  parseSymbols,
  pxArriveFromBar,
  signedSlipBps,
  sqliteBuyQuery,
  summarizeRows,
  sweepEvent
} from '../scripts/knowledge/lib/delayed_follow_e_v0.js';

const FIXTURE_DIR = path.resolve('test/fixtures/delayed_follow_e_v0');
const T0 = Date.parse('2026-07-15T12:00:00.000Z');

function loadBars(symbol) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'bars', `${symbol}.json`), 'utf8'));
}

describe('REQ-058 delayed-follow E v0', () => {
  it('parses Δ sweep bins {0,1,3,5}', () => {
    assert.deepEqual(parseDeltaMins('0,1,3,5'), [0, 1, 3, 5]);
    assert.deepEqual(parseSymbols('iren,SOXL'), ['IREN', 'SOXL']);
    assert.throws(() => parseDeltaMins('-1'), /invalid/);
  });

  it('t_arrive_hat = t_msg + Δ minutes and is not named t_arrive', () => {
    assert.equal(hypothesizedArrivalMs(T0, 0), T0);
    assert.equal(hypothesizedArrivalMs(T0, 5), T0 + 5 * 60 * 1000);
    const bars = loadBars('IREN');
    const ev = {
      event_id: 'e1',
      symbol: 'IREN',
      side: 'BUY',
      t_msg: T0,
      t_msg_kind: 'message_clock',
      px_zhao: 100,
      speaker_id: ZHAO_SPEAKER_ID,
      channel_id: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    };
    const rows = sweepEvent(ev, bars, [0, 1, 3, 5], { interval: '5m', barSource: 'fixture' });
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.arrival_kind, 'hypothesized');
      assert.equal(row.t_arrive_hat, T0 + row.delta_min * 60 * 1000);
      assert.equal(Object.hasOwn(row, 't_arrive'), false);
      assert.equal(Object.hasOwn(row, 't_fill'), false);
      assertNoOralPriceLeakage(row);
    }
  });

  it('px_arrive is bar OPEN containing t_arrive_hat; never oral px_zhao or bar.low', () => {
    const bars = loadBars('IREN');
    const bar = findBarContaining(bars, T0, 5 * 60 * 1000);
    assert.ok(bar);
    assert.equal(bar.datetime, '2026-07-15T12:00:00.000Z');
    assert.equal(pxArriveFromBar(bar), 100.1);
    assert.notEqual(pxArriveFromBar(bar), 100);
    assert.notEqual(pxArriveFromBar(bar), bar.low);

    const ev = {
      event_id: 'e_open',
      symbol: 'IREN',
      side: 'BUY',
      t_msg: T0,
      px_zhao: 100,
      speaker_id: ZHAO_SPEAKER_ID
    };
    const [row0, , , row5] = sweepEvent(ev, bars, [0, 1, 3, 5], { interval: '5m' });
    assert.equal(row0.px_arrive, 100.1);
    assert.equal(row0.exec_policy, 'A');
    assert.equal(row5.t_arrive_hat, T0 + 5 * 60 * 1000);
    assert.equal(row5.px_arrive, 100.3);
    assert.equal(row5.exec_policy, 'B');
    assert.notEqual(row0.px_arrive, row0.px_zhao);
  });

  it('A/B/C stub: reconnect-pull / limited-slip chase / abandon (provisional 20/40bp)', () => {
    assert.equal(DELAYED_FOLLOW_POLICY.A_ADVERSE_SLIP_MAX_BPS, 20);
    assert.equal(DELAYED_FOLLOW_POLICY.B_ADVERSE_SLIP_MAX_BPS, 40);
    assert.equal(decideExecAbc('BUY', 100, 100.10).exec_policy, 'A');
    assert.equal(decideExecAbc('BUY', 100, 99.50).exec_policy, 'A');
    assert.equal(decideExecAbc('BUY', 100, 100.30).exec_policy, 'B');
    assert.equal(decideExecAbc('BUY', 100, 100.60).exec_policy, 'C');
    assert.equal(decideExecAbc('BUY', 100, 100.60).exec_px, null);
    assert.equal(decideExecAbc('BUY', 100, 100.30).exec_px, 100.30);
    assert.equal(signedSlipBps('BUY', 100, 100.20), 20);
  });

  it('loads fixture jsonl with Zhao/channel hard-lock (no LIKE, no Zhou)', () => {
    const lines = fs.readFileSync(path.join(FIXTURE_DIR, 'events.jsonl'), 'utf8').split('\n');
    const events = loadBuyEventsFromJsonlLines(lines, {
      symbols: ['IREN', 'SOXL', 'MU', 'CRWV', 'COHR']
    });
    const ids = events.map((e) => e.event_id).sort();
    assert.ok(!ids.includes('fx_reject_channel'));
    assert.ok(!ids.includes('fx_reject_speaker'));
    assert.ok(ids.includes('fx_iren_a_close'));
    assert.ok(ids.includes('fx_soxl_a_better'));
    assert.ok(events.every((e) => e.speaker_id === ZHAO_SPEAKER_ID));
    assert.equal(
      buyEventFromNormalized(
        { symbol: 'IREN', action: 'BUY', px_zhao: 1, t_msg: T0, speaker_id: 'user_HnSG7BJWMTfDz' },
        ['IREN']
      ),
      null
    );
    const noChannel = loadBuyEventsFromJsonlLines(
      [
        JSON.stringify({
          event_id: 'fx_no_channel',
          symbol: 'IREN',
          side: 'BUY',
          t_msg: T0,
          px_zhao: 100,
          speaker_id: ZHAO_SPEAKER_ID
        })
      ],
      { symbols: ['IREN'] }
    );
    assert.equal(noChannel.length, 0);
    const q = sqliteBuyQuery();
    assert.match(q, /speaker_id = \?/);
    assert.match(q, /channel_id IN \(\?, \?\)/);
    assert.doesNotMatch(q, /LIKE/);
    assert.doesNotMatch(q, /赵/);
  });

  it('L2a ledger uses session_anchor, not invented fill seconds', () => {
    const rec = {
      cu_id: 'cu_x',
      channel: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
      et_date: '2026-07-15',
      et_session: 'regular',
      parsed: { actions: [{ action: 'BUY', ticker: 'IREN', price: 42.7, status: 'filled' }] }
    };
    const [ev] = extractBuysFromL2aRecord(rec, ['IREN']);
    assert.equal(ev.t_msg_kind, 'session_anchor');
    assert.equal(ev.t_msg, etWallClockToUtcMs('2026-07-15', '09:30:00'));
    assert.equal(ev.px_zhao, 42.7);
    const discuss = {
      ...rec,
      channel: 'chat_feed_1CTr5VAdNHtbZAFaTitvoT'
    };
    assert.equal(extractBuysFromL2aRecord(discuss, ['IREN']).length, 0);
  });

  it('ET wall clock DST: 2026-07-15 09:30 ET = 13:30 UTC; winter 2026-01-15 = 14:30 UTC', () => {
    assert.equal(etWallClockToUtcMs('2026-07-15', '09:30:00'), Date.parse('2026-07-15T13:30:00.000Z'));
    assert.equal(etWallClockToUtcMs('2026-01-15', '09:30:00'), Date.parse('2026-01-15T14:30:00.000Z'));
  });

  it('summarize A/C rates; exit/costs stay separate; NO_BAR excluded from C-rate', () => {
    const iren = loadBars('IREN');
    const mu = loadBars('MU');
    const lines = fs.readFileSync(path.join(FIXTURE_DIR, 'events.jsonl'), 'utf8').split('\n');
    const events = loadBuyEventsFromJsonlLines(lines, { symbols: ['IREN', 'MU'] });
    const rows = [];
    for (const ev of events) {
      const bars = ev.symbol === 'MU' ? mu : iren;
      rows.push(...sweepEvent(ev, bars, [0], { interval: '5m' }));
    }
    const stats = summarizeRows(rows);
    const d0 = stats.per_delta['0'];
    assert.ok(d0.n_no_bar >= 1);
    assert.ok(d0.n_C >= 1);
    assert.ok(d0.n_A >= 1);
    assert.equal(d0.C_rate, d0.n_C / d0.n_scored);
    const cRow = rows.find((r) => r.exec_policy === 'C');
    assert.equal(cRow.exit, null);
    assert.equal(cRow.costs, null);
    const aRow = rows.find((r) => r.exec_policy === 'A');
    assert.ok(aRow.exit);
    assert.ok(aRow.costs);
    assert.equal(aRow.exit.kind, 'stub_horizon_bar_close');
    assert.ok('residual_after_costs_bps' in aRow.costs);
  });
});
