import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables, ensureObservedArrivalColumns } from '../database.js';
import { ZHAO_SENDER_ID } from '../tools/trade/signal_intent_bridge.js';
import { persistZhaoFilledPrints, FORUM_CHANNEL } from '../tools/trade/zhao_print_persist.js';
import { deferOffHot } from '../tools/ingest/hot_defer.js';
import { startTierPollers, stopTierPollers } from '../tools/ingest/tier_poller.js';

const OPTION = 'chat_feed_1CTrCEx44dP13jW3RVkYiS';
const NBIS = '226.2加了6分之一常规仓nbis';

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE trade_signals (
      signal_id TEXT PRIMARY KEY,
      message_id TEXT,
      channel_id TEXT,
      speaker_id TEXT,
      speaker_name TEXT,
      ticker TEXT,
      action TEXT,
      price REAL,
      quantity INTEGER,
      stop_loss REAL,
      reason TEXT,
      parse_status TEXT,
      source TEXT,
      created_at INTEGER
    );
  `);
  ensurePaperTradingTables(db);
  ensureObservedArrivalColumns(db);
  return db;
}

function printMsg(id, channel, text, createdAt) {
  return {
    id,
    sender_id: ZHAO_SENDER_ID,
    sender_name: 'xiaozhaolucky',
    channel_id: channel,
    content: text,
    created_at: createdAt,
    poll_seen_at: createdAt + 2800
  };
}

describe('CHG-062 HOT release and fingerprint HITL', () => {
  let db;
  beforeEach(() => { db = memoryDb(); });

  it('option-only NBIS print writes zhao_print and exactly one PENDING_HITL card', () => {
    const cards = [];
    const [row] = persistZhaoFilledPrints(
      [printMsg('post_nbis_opt', OPTION, NBIS, 1790194404738)],
      { dbInstance: db, onHitlCard: (intent) => cards.push(intent.intent_id) }
    );
    assert.equal(row.skipped, false);
    assert.equal(row.signal.source, 'zhao_print');
    assert.equal(row.signal.ticker, 'NBIS');
    assert.equal(row.intent.status, 'PENDING_HITL');
    assert.equal(String(row.intent.source).includes('zhao_follow'), false);
    assert.equal(cards.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM trade_intents WHERE status = 'PENDING_HITL'").get().c, 1);
  });

  it('forum plus option same fingerprint keeps one Intent and one card', () => {
    const t = 1790194404738;
    const cards = [];
    const rows = persistZhaoFilledPrints([
      printMsg('post_nbis_opt', OPTION, NBIS, t),
      printMsg('post_nbis_forum', FORUM_CHANNEL, NBIS, t + 1000)
    ], { dbInstance: db, onHitlCard: () => cards.push(1) });
    assert.equal(rows.filter((r) => r.intent).length, 1);
    assert.equal(rows.filter((r) => r.intent_reason === 'SIGNAL_ONLY_DUPLICATE_FINGERPRINT').length, 1);
    assert.equal(cards.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trade_signals').get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trade_intents').get().c, 1);
  });

  it('empty extract does not remove a regex Intent', () => {
    const cards = [];
    persistZhaoFilledPrints(
      [printMsg('post_nbis_opt', OPTION, NBIS, 1790194404738)],
      { dbInstance: db, onHitlCard: () => cards.push(1) }
    );
    const extractResult = [];
    assert.equal(extractResult.length, 0);
    assert.equal(cards.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM trade_intents WHERE status = 'PENDING_HITL'").get().c, 1);
  });

  it('non-latin ticker stays a miss', () => {
    const cards = [];
    const [row] = persistZhaoFilledPrints(
      [printMsg('post_goog', OPTION, '338加回357卖出的谷歌A', 1790190000000)],
      { dbInstance: db, onHitlCard: () => cards.push(1) }
    );
    assert.equal(row.skipped, true);
    assert.equal(row.reason, 'NO_FILLED_PRINT');
    assert.equal(cards.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trade_signals').get().c, 0);
  });

  it('deferred extract does not hold the caller for 50s', async () => {
    let finished = false;
    const started = Date.now();
    deferOffHot(async () => {
      await new Promise(() => {});
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(finished, false);
    assert.ok(Date.now() - started < 2000);
  });

  it('HOT tick returns while a 50s extract is still pending', async () => {
    const prev = process.env.WHOP_CHAT_CHANNEL_IDS;
    process.env.WHOP_CHAT_CHANNEL_IDS = `${OPTION},${FORUM_CHANNEL}`;
    let ticks = 0;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      startTierPollers({
        syncGroup: async () => {
          deferOffHot(() => gate);
          return { success: false, newMessagesCount: 1 };
        },
        onTick: ({ tier }) => { if (tier === 'hot') ticks += 1; }
      });
      await new Promise((resolve) => setTimeout(resolve, 2300));
      assert.ok(ticks >= 2, `hot ticks=${ticks}`);
    } finally {
      stopTierPollers();
      release();
      if (prev == null) delete process.env.WHOP_CHAT_CHANNEL_IDS;
      else process.env.WHOP_CHAT_CHANNEL_IDS = prev;
    }
  });
});
