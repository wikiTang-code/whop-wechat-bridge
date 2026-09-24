import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables, ensureObservedArrivalColumns } from '../database.js';
import { ZHAO_SENDER_ID } from '../tools/trade/signal_intent_bridge.js';
import { persistZhaoFilledPrints, FORUM_CHANNEL } from '../tools/trade/zhao_print_persist.js';
import { handlePaperWecomAction, pushPaperWecomCard } from '../tools/trade/paper_wecom_card.js';
import { generateHitlToken } from '../follow-hitl.js';
import { startTierPollers, stopTierPollers } from '../tools/ingest/tier_poller.js';
import { deferOffHot } from '../tools/ingest/hot_defer.js';

const OPTION = 'chat_feed_1CTrCEx44dP13jW3RVkYiS';
const NBIS = '226.2加了6分之一常规仓nbis';

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE trade_signals (
      signal_id TEXT PRIMARY KEY, message_id TEXT, channel_id TEXT, speaker_id TEXT,
      speaker_name TEXT, ticker TEXT, action TEXT, price REAL, quantity INTEGER,
      stop_loss REAL, reason TEXT, parse_status TEXT, source TEXT, created_at INTEGER
    );
  `);
  ensurePaperTradingTables(db);
  ensureObservedArrivalColumns(db);
  return db;
}

function msg(id, channel, t) {
  return {
    id, sender_id: ZHAO_SENDER_ID, sender_name: 'xiaozhaolucky',
    channel_id: channel, content: NBIS, created_at: t, poll_seen_at: t + 2800
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CHG-063 WeCom paper card', () => {
  let db;
  beforeEach(() => { db = memoryDb(); });

  it('option-only print has one Intent and one WeCom push', async () => {
    const pushed = [];
    const [row] = persistZhaoFilledPrints(
      [msg('post_opt', OPTION, 1790194404738)],
      { dbInstance: db, onHitlCard: () => null, onWecomPush: async (text) => pushed.push(text) }
    );
    await flush();
    assert.equal(row.intent.status, 'PENDING_HITL');
    assert.equal(pushed.length, 1);
    assert.match(pushed[0], /模拟盘待确认/);
    assert.match(pushed[0], /确认Paper/);
    assert.match(pushed[0], /放弃/);
    assert.doesNotMatch(pushed[0], /已跟单成功|跟单成功/);
  });

  it('same fingerprint on two channels pushes WeCom once', async () => {
    const pushed = [];
    const t = 1790194404738;
    persistZhaoFilledPrints([
      msg('post_opt', OPTION, t),
      msg('post_forum', FORUM_CHANNEL, t + 500)
    ], { dbInstance: db, onHitlCard: () => null, onWecomPush: async (text) => pushed.push(text) });
    await flush();
    assert.equal(pushed.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM trade_intents WHERE status = 'PENDING_HITL'").get().c, 1);
  });

  it('ask beyond 40bp records C and does not submit', async () => {
    const [row] = persistZhaoFilledPrints(
      [msg('post_opt', OPTION, 1790194404738)],
      { dbInstance: db, onHitlCard: () => null, onWecomPush: async () => {} }
    );
    await flush();
    const intent = row.intent;
    const token = generateHitlToken(intent.intent_id, intent.ticker, intent.side, 1790194404738);
    let submitted = 0;
    const wide = await handlePaperWecomAction({
      intentId: intent.intent_id,
      action: 'CONFIRM',
      token,
      createdAt: 1790194404738,
      ask: 230,
      dbInstance: db,
      submit: async () => { submitted += 1; }
    });
    assert.equal(wide.state, 'C');
    assert.equal(wide.submitted, false);
    assert.equal(submitted, 0);
    const tight = await handlePaperWecomAction({
      intentId: intent.intent_id,
      action: 'CONFIRM',
      token,
      createdAt: 1790194404738,
      ask: 226.2,
      dbInstance: db,
      submit: async () => { submitted += 1; return { ok: true }; }
    });
    assert.equal(tight.submitted, true);
    assert.equal(submitted, 1);
  });

  it('posts the paper card to the trade group webhook', async () => {
    let seen = null;
    const result = await pushPaperWecomCard('**模拟盘待确认**\n[确认Paper](http://x)\n[放弃](http://y)', {
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
      fetchImpl: async (url, opts) => {
        seen = { url, body: JSON.parse(opts.body) };
        return { json: async () => ({ errcode: 0 }) };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.via, 'trade_webhook');
    assert.match(seen.url, /webhook\/send\?key=/);
    assert.equal(seen.body.msgtype, 'markdown');
    assert.match(seen.body.markdown.content, /确认Paper/);
  });

  it('HOT releases while WeCom push is still pending', async () => {
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
