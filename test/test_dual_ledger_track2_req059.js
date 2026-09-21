/**
 * REQ-059 Track 2 dual ledger (synthetic fixtures, no network/DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  ARCHIVE_MISSING,
  BANNED_STYLE_WINDOW_MIN,
  CREATED_AT_MISSING,
  FROZEN_RULES,
  MERGED_PF_FORBIDDEN,
  ORAL_ENTRY_FORBIDDEN,
  STATUS_BANNER,
  STYLE_WINDOWS_MIN,
  TOP5_TICKERS,
  WINDOW_2H_BANNED,
  ZHAO_SPEAKER_ID,
  assertLedgersNotMerged,
  assertOralNeverEntry,
  assertStyleWindowAllowed,
  assertVolumeInEveryRule,
  barIntervalMs,
  buildExpectancyRows,
  causalBarsBefore,
  detectRuleTriggers,
  emptySummaryShell,
  frozenRuleIds,
  isCausalBar,
  isZhaoSpeaker,
  loadZhaoEventsFromJsonlLines,
  resolveTrack2Source,
  runDualLedger,
  sqliteZhaoQuery,
  tradeEventFromNormalized
} from '../scripts/knowledge/lib/dual_ledger_track2.js';

const FIXTURE_DIR = path.resolve('test/fixtures/dual_ledger_track2');
const SCRIPT = path.resolve('scripts/knowledge/backtest_dual_ledger_track2.js');

function loadBars(symbol) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'bars', `${symbol}.json`), 'utf8'));
}

describe('REQ-059 Track 2 dual ledger', () => {
  it('freezes 4 OHLCV rules with volume inside the if', () => {
    assert.equal(frozenRuleIds().length, 4);
    assert.ok(frozenRuleIds().includes('T2R-VOL_EXPANSION_UP'));
    assert.equal(assertVolumeInEveryRule(), true);
    for (const rule of FROZEN_RULES) {
      assert.match(rule.note, /volume/i);
      assert.match(rule.predicateSrc, /volume/i);
      assert.ok(rule.volMult > 0);
    }
  });

  it('hard-locks Zhao speaker_id; drops Zhou and wrong channel', () => {
    const lines = fs.readFileSync(path.join(FIXTURE_DIR, 'events.jsonl'), 'utf8').split('\n');
    const events = loadZhaoEventsFromJsonlLines(lines, { symbols: TOP5_TICKERS });
    const ids = events.map((e) => e.event_id);
    assert.ok(ids.includes('fx_iren_tp_buy'));
    assert.ok(ids.includes('fx_iren_tp_sell'));
    assert.ok(!ids.includes('fx_reject_zhou'));
    assert.ok(!ids.includes('fx_reject_channel'));
    assert.ok(events.every((e) => e.speaker_id === ZHAO_SPEAKER_ID));
    assert.equal(isZhaoSpeaker({ speaker_name: '赵哥' }), false);
    assert.equal(isZhaoSpeaker({ speaker_id: ZHAO_SPEAKER_ID }), true);
    assert.equal(
      tradeEventFromNormalized(
        {
          symbol: 'IREN',
          action: 'BUY',
          t_msg: Date.now(),
          speaker_id: 'user_HnSG7BJWMTfDz',
          channel_id: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
        },
        ['IREN']
      ),
      null
    );
    const q = sqliteZhaoQuery();
    assert.match(q, /speaker_id = \?/);
    assert.doesNotMatch(q, /LIKE/);
    assert.doesNotMatch(q, /赵/);
  });

  it('oral price never becomes entry', () => {
    assert.throws(
      () =>
        assertOralNeverEntry({
          entry_px: 100,
          px_zhao: 100,
          entry_px_source: 'next_bar_open_plus_half_cost'
        }),
      (err) => String(err.message).includes(ORAL_ENTRY_FORBIDDEN)
    );
    assert.throws(
      () => assertOralNeverEntry({ entry_px: 99, entry_px_source: 'oral' }),
      /oral price leakage/
    );
    const bars = loadBars('IREN');
    const triggers = detectRuleTriggers(bars);
    const rRows = buildExpectancyRows(bars, triggers, { symbol: 'IREN' });
    assert.ok(rRows.length > 0);
    for (const row of rRows) {
      assert.equal(row.px_zhao, null);
      assert.equal(row.entry_px_source, 'next_bar_open_plus_half_cost');
      assertOralNeverEntry(row);
      const entryBar = bars[row.entry_time ? triggers.find((t) => t.trigger_ms === row.trigger_ms)?.entryBarIdx : -1];
      if (entryBar) {
        assert.notEqual(row.entry_px, 999.99);
        assert.ok(Math.abs(row.entry_px - entryBar.open) < 1);
      }
    }
  });

  it('causal bar cutoff: bar that has not closed by t_msg is excluded', () => {
    const bars = loadBars('IREN');
    const intervalMs = barIntervalMs('5m');
    const mid = bars[80];
    const tMsg = mid.time + intervalMs / 2;
    assert.equal(isCausalBar(mid, tMsg, intervalMs), false);
    assert.equal(isCausalBar(bars[79], tMsg, intervalMs), true);
    const causal = causalBarsBefore(bars, tMsg, intervalMs);
    assert.ok(causal.every((b) => b.time + intervalMs <= tMsg));
    assert.ok(!causal.some((b) => b.time === mid.time));
    const full = detectRuleTriggers(bars);
    const cut = detectRuleTriggers(bars, { tMsgCutoff: tMsg });
    assert.ok(cut.every((t) => t.trigger_ms <= tMsg));
    assert.ok(full.length >= cut.length);
  });

  it('two ledgers are not merged into one PF headline', () => {
    const bars = loadBars('IREN');
    const lines = fs.readFileSync(path.join(FIXTURE_DIR, 'events.jsonl'), 'utf8').split('\n');
    const zhao = loadZhaoEventsFromJsonlLines(lines, { symbols: ['IREN'] });
    const result = runDualLedger({ symbol: 'IREN', bars, zhaoEvents: zhao });
    assert.ok(result.ledger_S);
    assert.ok(result.ledger_R);
    assert.equal(result.ledger_R.ignore_zhao, true);
    assert.ok(result.ledger_R.exit_a_all);
    assert.ok(result.ledger_R.exit_b_all);
    assert.notEqual(result.ledger_S.note, result.ledger_R.note);
    const shell = emptySummaryShell();
    shell.ledger_S = result.ledger_S;
    shell.ledger_R = result.ledger_R;
    assert.equal(assertLedgersNotMerged(shell), true);
    assert.throws(() => assertLedgersNotMerged({ profitFactor: 2.1 }), (e) => String(e.message).includes(MERGED_PF_FORBIDDEN));
    assert.throws(
      () => assertLedgersNotMerged({ ledger_S: { profitFactor: 1.2 }, ledger_R: {} }),
      /merge/
    );
  });

  it('bans ±2h style window; 5/15/30 are pre-registered', () => {
    assert.deepEqual(STYLE_WINDOWS_MIN, [5, 15, 30]);
    assert.equal(BANNED_STYLE_WINDOW_MIN, 120);
    assert.equal(assertStyleWindowAllowed(15), 15);
    assert.throws(() => assertStyleWindowAllowed(120), (e) => String(e.message).includes(WINDOW_2H_BANNED));
    assert.throws(() => assertStyleWindowAllowed(2), /not pre-registered/);
  });

  it('style ledger records TP/FP/FN without using oral as fill', () => {
    const bars = loadBars('IREN');
    const lines = fs.readFileSync(path.join(FIXTURE_DIR, 'events.jsonl'), 'utf8').split('\n');
    const zhao = loadZhaoEventsFromJsonlLines(lines, { symbols: ['IREN'] });
    const result = runDualLedger({ symbol: 'IREN', bars, zhaoEvents: zhao });
    assert.ok(result.ledger_S.tp30 >= 1);
    assert.ok(result.ledger_S.fn30 >= 1);
    const tp = result.style_rows.find((r) => r.class_30m === 'TP');
    assert.ok(tp);
    assert.equal(tp.entry_px, null);
    assert.equal(tp.entry_px_source, 'style_ledger_no_entry');
    const fn = result.style_rows.find((r) => r.class_30m === 'FN');
    assert.ok(fn);
    assert.equal(fn.zhao_event_id, 'fx_iren_fn_buy');
  });

  it('R-precursor ignores whether Zhao spoke and splits ExitA vs ExitB', () => {
    const bars = loadBars('IREN');
    const result = runDualLedger({ symbol: 'IREN', bars, zhaoEvents: [] });
    assert.equal(result.ledger_R.ignore_zhao, true);
    assert.ok(result.r_rows.length >= 1);
    assert.ok(result.r_rows.every((r) => r.zhao_spoken === 'IGNORED'));
    assert.ok(result.r_rows.every((r) => r.exit_a && r.exit_b));
    assert.equal(result.split.mode, 'calendar_40_20');
    assert.equal(result.split.isDaysActual, 40);
    assert.equal(result.split.oosDaysActual, 20);
  });

  it('banner is REFERENCE_ONLY / hint_only / CHG-050 negative control', () => {
    assert.equal(STATUS_BANNER.status, 'REFERENCE_ONLY');
    assert.equal(STATUS_BANNER.hint_only, true);
    assert.equal(STATUS_BANNER.not_copytrade, true);
    assert.equal(STATUS_BANNER.not_done_strat, true);
    assert.equal(STATUS_BANNER.chg050_sibling, 'negative_control');
    assert.equal(STATUS_BANNER.place_order, false);
  });

  it('fail-closed when archive missing unless --events', () => {
    assert.throws(
      () => resolveTrack2Source({ archiveExists: false, hasMessagesCreatedAt: false }),
      (e) => String(e.message).includes(ARCHIVE_MISSING)
    );
    assert.throws(
      () => resolveTrack2Source({ archiveExists: true, hasMessagesCreatedAt: false }),
      (e) => String(e.message).includes(CREATED_AT_MISSING)
    );
    const ok = resolveTrack2Source({ eventsPath: 'x.jsonl' });
    assert.equal(ok.source, 'jsonl_fixtures');
  });

  it('CLI fixtures --no-fetch writes two jsonl ledgers', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2dl-'));
    const run = spawnSync(
      process.execPath,
      [
        SCRIPT,
        '--events',
        path.join(FIXTURE_DIR, 'events.jsonl'),
        '--bars-dir',
        path.join(FIXTURE_DIR, 'bars'),
        '--no-fetch',
        '--lookback-days',
        'all',
        '--symbols',
        'IREN,SOXL,MU,CRWV,COHR',
        '--out-dir',
        outDir
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /REFERENCE_ONLY/);
    assert.match(run.stdout, /hint_only/);
    assert.equal(fs.existsSync(path.join(outDir, 'style_ledger_s.jsonl')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'expectancy_ledger_r.jsonl')), true);
    const sum = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    assert.equal(sum.banner.status, 'REFERENCE_ONLY');
    assert.equal(sum.banner.chg050_sibling, 'negative_control');
    assert.ok(sum.ledger_S);
    assert.ok(sum.ledger_R);
    assert.equal(Object.hasOwn(sum, 'profitFactor'), false);
    assertLedgersNotMerged(sum);
  });

  it('CLI missing archive without --events exits nonzero', () => {
    const missing = spawnSync(
      process.execPath,
      [
        SCRIPT,
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
    assert.match(`${missing.stderr || ''}${missing.stdout || ''}`, /TRACK2_FAIL_CLOSED/);
  });

  it('CLI missing messages.created_at exits nonzero', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2dl-db-'));
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
        price REAL
      );
    `);
    db.close();
    const run = spawnSync(
      process.execPath,
      [SCRIPT, '--db', dbPath, '--no-fetch', '--symbols', 'IREN', '--lookback-days', 'all'],
      { encoding: 'utf8' }
    );
    assert.notEqual(run.status, 0);
    assert.match(`${run.stderr || ''}${run.stdout || ''}`, /messages\.created_at unavailable/);
  });
});
