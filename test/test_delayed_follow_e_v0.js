/**
 * REQ-058 delayed-follow E-layer v0 (synthetic bars/events, no network/DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  DELAYED_FOLLOW_POLICY,
  MESSAGE_CLOCK_FAIL_ARCHIVE,
  MESSAGE_CLOCK_FAIL_CREATED_AT,
  NEAR_END_BANNER,
  SESSION_ANCHOR_FLAG_REQUIRED,
  SILENT_MESSAGE_CLOCK_FORBIDDEN,
  T_MSG_KIND_MESSAGE_CLOCK,
  T_MSG_KIND_SESSION_ANCHOR,
  ZHAO_SPEAKER_ID,
  assertNoOralPriceLeakage,
  buyEventFromNormalized,
  decideExecAbc,
  etWallClockToUtcMs,
  extractBuysFromL2aRecord,
  findBarContaining,
  hypothesizedArrivalMs,
  isZhaoSpeaker,
  loadBuyEventsFromJsonlLines,
  loadBuyEventsFromSqliteRows,
  parseDeltaMins,
  parseSymbols,
  pxArriveFromBar,
  resolveClockSource,
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
      t_msg_kind: 'message_clock',
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
    assert.match(q, /JOIN messages m/i);
    assert.match(q, /m\.created_at/);
    assert.doesNotMatch(q, /LIKE/);
    assert.doesNotMatch(q, /赵/);
    assert.equal(isZhaoSpeaker({ speaker_name: '赵哥' }), false);
    assert.equal(isZhaoSpeaker({ speaker_name: 'xiaozhaolucky' }), false);
    assert.equal(isZhaoSpeaker({ speaker_id: ZHAO_SPEAKER_ID }), true);
    assert.equal(
      buyEventFromNormalized(
        { symbol: 'IREN', action: 'BUY', px_zhao: 1, t_msg: T0 },
        ['IREN']
      ),
      null
    );
    assert.equal(
      loadBuyEventsFromSqliteRows(
        [{ signal_id: 'x', ticker: 'IREN', action: 'BUY', price: 1, created_at: T0, channel_id: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN' }],
        { symbols: ['IREN'] }
      ).length,
      0
    );
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

  it('fail-closed message_clock: no archive / no messages.created_at; no silent L2a', () => {
    assert.throws(
      () =>
        resolveClockSource({
          tMsgKind: T_MSG_KIND_MESSAGE_CLOCK,
          archiveExists: false,
          hasMessagesCreatedAt: false
        }),
      (err) => String(err.message).includes('MESSAGE_CLOCK_FAIL_CLOSED') && String(err.message).includes(MESSAGE_CLOCK_FAIL_ARCHIVE)
    );
    assert.throws(
      () =>
        resolveClockSource({
          tMsgKind: T_MSG_KIND_MESSAGE_CLOCK,
          archiveExists: true,
          hasMessagesCreatedAt: false
        }),
      (err) => String(err.message).includes(MESSAGE_CLOCK_FAIL_CREATED_AT)
    );
    assert.throws(
      () =>
        resolveClockSource({
          tMsgKind: T_MSG_KIND_SESSION_ANCHOR,
          allowSessionAnchorCounterexample: false
        }),
      (err) => String(err.message).includes(SESSION_ANCHOR_FLAG_REQUIRED)
    );
    const ok = resolveClockSource({
      tMsgKind: T_MSG_KIND_MESSAGE_CLOCK,
      archiveExists: true,
      hasMessagesCreatedAt: true
    });
    assert.equal(ok.source, 'sqlite_messages_created_at');
    assert.equal(ok.t_msg_kind, 'message_clock');
    assert.equal(ok.not_for_strategy, false);
    const cx = resolveClockSource({
      tMsgKind: T_MSG_KIND_SESSION_ANCHOR,
      allowSessionAnchorCounterexample: true
    });
    assert.equal(cx.source, 'l2a_session_anchor_counterexample');
    assert.equal(cx.not_for_strategy, true);
  });

  it('does not silently treat L2a session_anchor as message_clock', () => {
    const l2aLine = JSON.stringify({
      cu_id: 'cu_silent',
      channel: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
      et_date: '2026-07-15',
      et_session: 'regular',
      parsed: { actions: [{ action: 'BUY', ticker: 'IREN', price: 42.7, status: 'filled' }] }
    });
    const asClock = loadBuyEventsFromJsonlLines([l2aLine], {
      symbols: ['IREN'],
      clockKind: T_MSG_KIND_MESSAGE_CLOCK
    });
    assert.equal(asClock.length, 0);
    const asAnchor = loadBuyEventsFromJsonlLines([l2aLine], {
      symbols: ['IREN'],
      clockKind: T_MSG_KIND_SESSION_ANCHOR
    });
    assert.equal(asAnchor.length, 1);
    assert.equal(asAnchor[0].t_msg_kind, T_MSG_KIND_SESSION_ANCHOR);
    assert.equal(asAnchor[0].not_for_strategy, true);
    const bars = loadBars('IREN');
    assert.throws(
      () =>
        sweepEvent(
          {
            event_id: 'no_kind',
            symbol: 'IREN',
            side: 'BUY',
            t_msg: T0,
            px_zhao: 100,
            speaker_id: ZHAO_SPEAKER_ID
          },
          bars,
          [0],
          { interval: '5m' }
        ),
      (err) => String(err.message).includes(SILENT_MESSAGE_CLOCK_FORBIDDEN)
    );
  });

  it('px_arrive never sourced from oral px_zhao', () => {
    assert.throws(
      () =>
        assertNoOralPriceLeakage({
          px_arrive: 99,
          px_zhao: 100,
          px_arrive_source: 'oral',
          arrival_kind: 'hypothesized'
        }),
      /oral price leakage/
    );
    assert.throws(
      () =>
        assertNoOralPriceLeakage({
          px_arrive: 100,
          px_zhao: 100,
          px_arrive_source: 'px_zhao',
          arrival_kind: 'hypothesized'
        }),
      /oral price leakage/
    );
  });

  it('CLI fail-closed: missing archive and missing messages.created_at exit nonzero', () => {
    const script = path.resolve('scripts/knowledge/backtest_delayed_follow_e_v0.js');
    const missing = spawnSync(
      process.execPath,
      [
        script,
        '--t-msg-kind',
        'message_clock',
        '--db',
        path.join(os.tmpdir(), 'no-such-whop_archive.db'),
        '--no-fetch',
        '--symbols',
        'IREN',
        '--lookback-days',
        'all'
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(missing.status, 0);
    const errText = `${missing.stderr || ''}${missing.stdout || ''}`;
    assert.match(errText, /MESSAGE_CLOCK_FAIL_CLOSED/);
    assert.match(errText, /readonly archive missing/);
    assert.doesNotMatch(errText, /falling back to L2A/i);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df058-'));
    const dbPath = path.join(dir, 'whop_archive.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE messages (id TEXT PRIMARY KEY);
      CREATE TABLE trade_signals (
        signal_id TEXT PRIMARY KEY,
        message_id TEXT,
        channel_id TEXT,
        speaker_id TEXT,
        ticker TEXT,
        action TEXT,
        price REAL,
        created_at INTEGER
      );
    `);
    db.close();
    const noCol = spawnSync(
      process.execPath,
      [
        script,
        '--t-msg-kind',
        'message_clock',
        '--db',
        dbPath,
        '--no-fetch',
        '--symbols',
        'IREN',
        '--lookback-days',
        'all'
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(noCol.status, 0);
    const noColText = `${noCol.stderr || ''}${noCol.stdout || ''}`;
    assert.match(noColText, /MESSAGE_CLOCK_FAIL_CLOSED/);
    assert.match(noColText, /messages\.created_at unavailable/);
    assert.doesNotMatch(noColText, /falling back to L2A/i);
  });

  it('CLI session_anchor counterexample writes only summary_session_anchor_counterexample.json', () => {
    const script = path.resolve('scripts/knowledge/backtest_delayed_follow_e_v0.js');
    const denied = spawnSync(
      process.execPath,
      [
        script,
        '--t-msg-kind',
        'session_anchor',
        '--no-fetch',
        '--symbols',
        'IREN',
        '--lookback-days',
        'all',
        '--bars-dir',
        path.join(FIXTURE_DIR, 'bars')
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr || ''}${denied.stdout || ''}`, /allow-session-anchor-counterexample/);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df058-cx-'));
    const allowed = spawnSync(
      process.execPath,
      [
        script,
        '--t-msg-kind',
        'session_anchor',
        '--allow-session-anchor-counterexample',
        '--no-fetch',
        '--symbols',
        'IREN',
        '--lookback-days',
        'all',
        '--bars-dir',
        path.join(FIXTURE_DIR, 'bars'),
        '--out-dir',
        outDir
      ],
      { encoding: 'utf8' }
    );
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(fs.existsSync(path.join(outDir, 'summary_message_clock.json')), false);
    const cxPath = path.join(outDir, 'summary_session_anchor_counterexample.json');
    assert.equal(fs.existsSync(cxPath), true);
    const cx = JSON.parse(fs.readFileSync(cxPath, 'utf8'));
    assert.equal(cx.not_for_strategy, true);
    assert.equal(cx.t_msg_kind, T_MSG_KIND_SESSION_ANCHOR);
    assert.match(cx.banner.near_end, /近端 = 到达字段 \+ 真时钟校准/);
    assert.equal(NEAR_END_BANNER, '近端 = 到达字段 + 真时钟校准');
  });

  it('CLI message_clock with --events writes summary_message_clock.json', () => {
    const script = path.resolve('scripts/knowledge/backtest_delayed_follow_e_v0.js');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df058-mc-'));
    const run = spawnSync(
      process.execPath,
      [
        script,
        '--t-msg-kind',
        'message_clock',
        '--delta-mins',
        '0,1,3,5',
        '--bar',
        '5m',
        '--symbols',
        'IREN,SOXL,MU,CRWV,COHR',
        '--events',
        path.join(FIXTURE_DIR, 'events.jsonl'),
        '--bars-dir',
        path.join(FIXTURE_DIR, 'bars'),
        '--no-fetch',
        '--lookback-days',
        'all',
        '--out-dir',
        outDir
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(outDir, 'summary_message_clock.json')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'summary_session_anchor_counterexample.json')), false);
    const sum = JSON.parse(fs.readFileSync(path.join(outDir, 'summary_message_clock.json'), 'utf8'));
    assert.equal(sum.t_msg_kind, T_MSG_KIND_MESSAGE_CLOCK);
    assert.equal(sum.not_for_strategy, false);
    assert.equal(sum.banner.near_end, NEAR_END_BANNER);
    assert.match(run.stdout, /近端 = 到达字段 \+ 真时钟校准/);
  });
});
