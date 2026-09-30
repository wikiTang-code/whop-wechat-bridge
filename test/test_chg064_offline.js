import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensurePaperTradingTables, ensureObservedArrivalColumns } from '../database.js';
import { ZHAO_SENDER_ID } from '../tools/trade/signal_intent_bridge.js';
import { parseZhaoFilledPrint, persistZhaoFilledPrints } from '../tools/trade/zhao_print_persist.js';
import { parseAliasPrint } from '../tools/trade/ticker_alias.js';
import { maybeSendFillReceipt } from '../tools/trade/fill_receipt.js';

const OPTION = 'chat_feed_1CTrCEx44dP13jW3RVkYiS';

function db() {
  const conn = new Database(':memory:');
  conn.exec(`CREATE TABLE trade_signals (
    signal_id TEXT PRIMARY KEY, message_id TEXT, channel_id TEXT, speaker_id TEXT,
    speaker_name TEXT, ticker TEXT, action TEXT, price REAL, quantity INTEGER,
    stop_loss REAL, reason TEXT, parse_status TEXT, source TEXT, created_at INTEGER
  );`);
  ensurePaperTradingTables(conn);
  ensureObservedArrivalColumns(conn);
  return conn;
}

function msg(id, text) {
  return {
    id, sender_id: ZHAO_SENDER_ID, sender_name: 'xiaozhaolucky',
    channel_id: OPTION, content: text, created_at: 1790190000000, poll_seen_at: 1790190002800
  };
}

describe('CHG-064 offline, not deployed', () => {
  it('regex is unchanged and 谷歌A is only the alias table', () => {
    assert.equal(parseZhaoFilledPrint('338加回357卖出的谷歌A'), null);
    assert.equal(parseZhaoFilledPrint('226.2加了6分之一常规仓nbis').ticker, 'NBIS');
    const alias = parseAliasPrint('338加回357卖出的谷歌A');
    assert.equal(alias.ticker, 'GOOGL');
    assert.equal(alias.price, 338);
    assert.equal(alias.action, 'BUY');
    assert.equal(parseAliasPrint('226.2加了6分之一常规仓nbis'), null);
  });

  it('regex hit does not call 1.5B; a miss queues it off the caller', async () => {
    const calls = [];
    let finished = false;
    const gate = new Promise(() => {});
    persistZhaoFilledPrints([
      msg('hit', '226.2加了6分之一常规仓nbis'),
      msg('miss', '242.5出剩下一半222.5的nbis')
    ], {
      dbInstance: db(),
      onHitlCard: () => null,
      onWecomPush: async () => {},
      onSlmInfer: async (row) => {
        calls.push(row.id);
        await gate;
        finished = true;
        return null;
      }
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(calls, ['miss']);
    assert.equal(finished, false);
  });

  it('fill receipt stays off and only zhao_follow plus FILLED may send', async () => {
    const sent = [];
    const send = async (text) => sent.push(text);
    const off = await maybeSendFillReceipt(
      { source: 'zhao_follow', status: 'FILLED', ticker: 'NBIS', side: 'BUY', quantity: 1, fill_price: 226 },
      { send, env: {} }
    );
    assert.equal(off.sent, false);
    assert.equal(off.reason, 'DISABLED');
    const smoke = await maybeSendFillReceipt(
      { source: 'counter_smoke', status: 'FILLED', ticker: 'IREN' },
      { send, env: { FILL_RECEIPT_ENABLED: 'true' } }
    );
    assert.equal(smoke.reason, 'GATE');
    const print = await maybeSendFillReceipt(
      { source: 'zhao_print', status: 'FILLED', ticker: 'NBIS' },
      { send, env: { FILL_RECEIPT_ENABLED: 'true' } }
    );
    assert.equal(print.reason, 'GATE');
    const ok = await maybeSendFillReceipt(
      { source: 'zhao_follow', status: 'FILLED', ticker: 'NBIS', side: 'BUY', quantity: 1, fill_price: 226.4 },
      { send, env: { FILL_RECEIPT_ENABLED: 'true' } }
    );
    assert.equal(ok.sent, true);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0], /已跟单成功/);
  });
});
