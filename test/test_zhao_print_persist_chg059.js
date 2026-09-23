import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables, ensureObservedArrivalColumns } from '../database.js';
import { ZHAO_SENDER_ID, ALLOWED_CHANNELS } from '../tools/trade/signal_intent_bridge.js';
import { AUTO_SUBMIT_ENABLED } from '../tools/trade/paper_execution_engine.js';
import {
  parseZhaoFilledPrint,
  persistZhaoFilledPrints,
  PRINT_SOURCE,
  FORUM_CHANNEL
} from '../tools/trade/zhao_print_persist.js';

const CHAT = ALLOWED_CHANNELS[1];

const TODAY = [
  { text: '46.5加了6分之一常规仓iren', ticker: 'IREN', action: 'BUY', price: 46.5 },
  { text: '82.5加了6分之一常规仓crwv', ticker: 'CRWV', action: 'BUY', price: 82.5 },
  { text: '222.5加了6分之一常规仓nbis', ticker: 'NBIS', action: 'BUY', price: 222.5 },
  { text: '34.58出掉34.58的spyu', ticker: 'SPYU', action: 'SELL', price: 34.58 },
  { text: '61.4出掉59.5的dram', ticker: 'DRAM', action: 'SELL', price: 61.4 },
  { text: '453出掉一半453的wdc', ticker: 'WDC', action: 'SELL', price: 453 }
];

describe('CHG-060 Zhao filled-print persist', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        content TEXT,
        created_at INTEGER,
        poll_seen_at INTEGER
      );
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
  });

  it('AUTO_SUBMIT stays false', () => {
    assert.equal(AUTO_SUBMIT_ENABLED, false);
  });

  it('parses today RTH filled prints', () => {
    for (const row of TODAY) {
      const p = parseZhaoFilledPrint(row.text);
      assert.ok(p, row.text);
      assert.equal(p.ticker, row.ticker);
      assert.equal(p.action, row.action);
      assert.equal(p.price, row.price);
    }
    assert.equal(parseZhaoFilledPrint('看看iren'), null);
    assert.equal(parseZhaoFilledPrint('TSLA 250917C00420000 买了'), null);
  });

  it('hard-lock: non-zhao and off-channel skipped', () => {
    const poll = 1789997983731;
    const rows = persistZhaoFilledPrints([
      {
        id: 'm_stranger',
        sender_id: 'user_someone_else',
        channel_id: FORUM_CHANNEL,
        content: '46.5加了6分之一常规仓iren',
        created_at: poll,
        poll_seen_at: poll
      },
      {
        id: 'm_chatty',
        sender_id: ZHAO_SENDER_ID,
        channel_id: 'chat_feed_random',
        content: '46.5加了6分之一常规仓iren',
        created_at: poll,
        poll_seen_at: poll
      }
    ], { dbInstance: db });
    assert.equal(rows.every((r) => r.skipped), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trade_signals').get().c, 0);
  });

  it('writes signal with poll_seen t_arrive and empty px_arrive; Intent is not zhao_follow and not submitted', () => {
    const tMsg = 1789997950971;
    const tArrive = 1789997983731;
    const [row] = persistZhaoFilledPrints([{
      id: 'post_iren_forum',
      sender_id: ZHAO_SENDER_ID,
      sender_name: 'xiaozhaolucky',
      channel_id: FORUM_CHANNEL,
      content: '46.5加了6分之一常规仓iren',
      created_at: tMsg,
      poll_seen_at: tArrive
    }], { dbInstance: db });

    assert.equal(row.skipped, false);
    assert.equal(row.signal.source, PRINT_SOURCE);
    assert.equal(row.signal.speaker_id, ZHAO_SENDER_ID);
    assert.equal(Number(row.signal.t_arrive), tArrive);
    assert.equal(row.signal.px_arrive, null);
    assert.notEqual(Number(row.signal.price), Number(row.signal.px_arrive));
    assert.ok(row.intent);
    assert.equal(row.intent.status, 'PENDING_HITL');
    assert.equal(row.intent.source.startsWith('zhao_follow'), false);
    assert.equal(row.intent.px_zhao, 46.5);
    assert.equal(row.intent.px_arrive, null);
    assert.equal(Number(row.intent.t_arrive), tArrive);
    assert.ok(!row.intent.broker_order_id);
  });

  it('chat duplicate writes signal only; forum writes Intent; idempotent on re-run', () => {
    const tArrive = 1789997983731;
    const msgs = [
      {
        id: 'post_forum',
        sender_id: ZHAO_SENDER_ID,
        channel_id: FORUM_CHANNEL,
        content: '46.5加了6分之一常规仓iren',
        created_at: tArrive,
        poll_seen_at: tArrive
      },
      {
        id: 'post_chat',
        sender_id: ZHAO_SENDER_ID,
        channel_id: CHAT,
        content: '46.5加了6分之一常规仓iren',
        created_at: tArrive,
        poll_seen_at: tArrive
      }
    ];
    const first = persistZhaoFilledPrints(msgs, { dbInstance: db });
    assert.equal(first.filter((r) => !r.skipped).length, 2);
    assert.ok(first.find((r) => r.message_id === 'post_forum').intent);
    assert.equal(first.find((r) => r.message_id === 'post_chat').intent, null);

    const second = persistZhaoFilledPrints(msgs, { dbInstance: db });
    assert.equal(second.every((r) => r.reason === 'ALREADY_PERSISTED'), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trade_signals').get().c, 2);
  });

  it('SELL without inventory still writes signal; no submitted Intent', () => {
    const [row] = persistZhaoFilledPrints([{
      id: 'post_spyu',
      sender_id: ZHAO_SENDER_ID,
      channel_id: FORUM_CHANNEL,
      content: '34.58出掉34.58的spyu',
      created_at: 1,
      poll_seen_at: 2
    }], { dbInstance: db });
    assert.equal(row.signal.action, 'SELL');
    assert.equal(row.signal.ticker, 'SPYU');
    assert.equal(row.intent, null);
    assert.match(String(row.intent_reason || ''), /NO_UNDERLYING_POSITION|REJECTED_NO/);
  });
});
