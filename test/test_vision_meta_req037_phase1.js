/**
 * REQ-037 Phase 1: message_vision_meta + stub extractor
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  ensureMessageVisionMetaTable,
  saveMessageVisionMeta,
  getMessageVisionMeta,
  listMessagesNeedingVisionMeta,
} from '../database.js';
import { buildStubVisionMetas } from '../tools/knowledge/vision-meta-stub.js';

const db = new Database(':memory:');
db.prepare(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    content TEXT,
    tickers TEXT,
    attachments TEXT,
    created_at INTEGER,
    sender_name TEXT
  )
`).run();
ensureMessageVisionMetaTable(db);

db.prepare(`
  INSERT INTO messages (id, content, tickers, attachments, created_at, sender_name)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  'msg_v1',
  '看 TSLA 30分钟喇叭口',
  JSON.stringify(['TSLA']),
  JSON.stringify([{ local_path: 'data/media/zhao/2026-09-15/post_x_0.png', mime: 'image/png' }]),
  Date.now(),
  '赵哥',
);

const needing = listMessagesNeedingVisionMeta({ limit: 10, dbInstance: db });
assert.strictEqual(needing.length, 1, 'needs vision meta');

const metas = buildStubVisionMetas(needing[0]);
assert.strictEqual(metas.length, 1);
assert.strictEqual(metas[0].schema.chart_type, 'K_LINE');
assert.strictEqual(metas[0].ticker, 'TSLA');
assert.strictEqual(metas[0].status, 'pending_vl');
assert.strictEqual(metas[0].provider, 'stub');

const id = saveMessageVisionMeta(metas[0], db);
assert.ok(id.includes('msg_v1'));

const { rows, total } = getMessageVisionMeta({ messageId: 'msg_v1', dbInstance: db });
assert.strictEqual(total, 1);
assert.strictEqual(rows[0].chart_type, 'K_LINE');
const schema = JSON.parse(rows[0].schema_json);
assert.strictEqual(schema.ticker, 'TSLA');

const needing2 = listMessagesNeedingVisionMeta({ limit: 10, dbInstance: db });
assert.strictEqual(needing2.length, 0, 'already covered');

console.log('test_vision_meta_req037_phase1: PASS');
