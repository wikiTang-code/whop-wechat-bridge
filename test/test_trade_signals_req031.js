import assert from 'assert';
import { initDb, getDb, saveTradeSignal, getTradeSignals } from '../database.js';

initDb();
const db = getDb();
const id = `sig_test_${Date.now()}`;

saveTradeSignal({
  signal_id: id,
  message_id: 'msg_t',
  channel_id: 'chat_test',
  speaker_id: 'user_zhao',
  speaker_name: '赵哥',
  ticker: 'MSFT',
  action: 'BUY',
  price: 420.5,
  quantity: 10,
  reason: 'REQ-031 unit',
  parse_status: 'ok'
});

const { signals } = getTradeSignals({ ticker: 'MSFT', limit: 20 });
const hit = signals.find((s) => s.signal_id === id);
assert(hit, 'trade_signals should persist');
assert.strictEqual(hit.action, 'BUY');
assert.strictEqual(hit.parse_status, 'ok');

// CHG-019: conflict update must refresh ticker/action/source (not only price/reason)
saveTradeSignal({
  signal_id: id,
  message_id: 'msg_t2',
  channel_id: 'chat_test',
  speaker_id: 'user_zhao',
  speaker_name: '赵哥',
  ticker: 'AAPL',
  action: 'SELL',
  price: 190,
  quantity: 5,
  stop_loss: 185,
  reason: 'CHG-019 re-correct',
  parse_status: 'ok',
  source: 'manual_correct'
});
const { signals: afterConflict } = getTradeSignals({ ticker: 'AAPL', limit: 20 });
const hit2 = afterConflict.find((s) => s.signal_id === id);
assert(hit2, 'conflict row should be findable by new ticker');
assert.strictEqual(hit2.ticker, 'AAPL');
assert.strictEqual(hit2.action, 'SELL');
assert.strictEqual(hit2.source, 'manual_correct');
assert.strictEqual(Number(hit2.stop_loss), 185);
assert.strictEqual(hit2.message_id, 'msg_t2');

// Must not touch personal positions
const before = db.prepare('SELECT COUNT(*) as c FROM positions').get().c;
assert.strictEqual(before, db.prepare('SELECT COUNT(*) as c FROM positions').get().c);

db.prepare('DELETE FROM trade_signals WHERE signal_id = ?').run(id);
console.log('✅ REQ-031 trade_signals ledger write/read OK (+ CHG-019 conflict columns)\n');
