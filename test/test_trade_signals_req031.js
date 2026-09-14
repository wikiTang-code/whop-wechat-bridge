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

// Must not touch personal positions
const before = db.prepare('SELECT COUNT(*) as c FROM positions').get().c;
assert.strictEqual(before, db.prepare('SELECT COUNT(*) as c FROM positions').get().c);

db.prepare('DELETE FROM trade_signals WHERE signal_id = ?').run(id);
console.log('✅ REQ-031 trade_signals ledger write/read OK\n');
