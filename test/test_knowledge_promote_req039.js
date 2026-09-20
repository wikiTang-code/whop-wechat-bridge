/**
 * REQ-039: knowledge promote allowlist only; never touch messages.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  dumpAllowlist,
  applyDump,
  planPromote,
  planGoldenPlaybook,
  promoteGoldenPlaybook
} from '../tools/knowledge/knowledge_promote.js';
import { loadSpec } from '../tools/knowledge/env_inventory.js';
import {
  ensureOntologyCardTable,
  ensureDistillScannedTable,
  ensureMessageVisionMetaTable
} from '../database.js';

console.log('🧪 [REQ-039] knowledge promote');

const spec = loadSpec();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req039-'));
const srcPath = path.join(dir, 'src.db');
const destPath = path.join(dir, 'dest.db');
const dumpPath = path.join(dir, 'dump.sqlite');

function seedMessages(db, n, prefix) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trade_signals (
      id INTEGER PRIMARY KEY,
      ticker TEXT
    );
  `);
  const ins = db.prepare(
    'INSERT INTO messages (id, channel_id, sender_id, sender_name, content, created_at) VALUES (?,?,?,?,?,?)'
  );
  for (let i = 0; i < n; i++) ins.run(`${prefix}${i}`, 'c', 's', 'n', 'x', i);
}

const src = new Database(srcPath);
seedMessages(src, 3, 'src-');
src.prepare('INSERT INTO trade_signals (id, ticker) VALUES (1, \'TSLA\')').run();
ensureOntologyCardTable(src);
ensureDistillScannedTable(src);
ensureMessageVisionMetaTable(src);
src.prepare(
  `INSERT INTO ontology_card (id, card_type, title, trigger_text, action_text, theory_text, tickers_json,
    source_cu_id, source_message_ids_json, provider, status, schema_json, created_at, updated_at)
   VALUES ('c1','pattern','TSLA','t','a','th','["TSLA"]',null,'[]','stub','draft','{}',1,1)`
).run();
src.prepare('INSERT INTO ontology_distill_scanned (message_id, cards_count, scanned_at) VALUES (\'m1\', 1, 1)').run();
src.prepare(
  `INSERT INTO message_vision_meta (id, message_id, attach_index, ticker, support_resistance_json, schema_json, provider, status, created_at, updated_at)
   VALUES ('v_fix','m_fix',0,null,'{"support":[100.5],"resistance":[120]}','{}','stub','ok',1,1)`
).run();
src.prepare(
  `INSERT INTO message_vision_meta (id, message_id, attach_index, ticker, support_resistance_json, schema_json, provider, status, created_at, updated_at)
   VALUES ('v_spy','m_spy',0,'SPY','{"support":[675.98],"resistance":[682.44]}','{}','cloud_vl','ok',1,1)`
).run();
src.close();

const dest = new Database(destPath);
seedMessages(dest, 8, 'prod-');
dest.prepare('INSERT INTO trade_signals (id, ticker) VALUES (9, \'KEEP\')').run();
ensureOntologyCardTable(dest);
dest.close();

const plan = planPromote({ srcPath, spec });
assert.strictEqual(plan.srcCounts.ontology_card, 1);
assert.strictEqual(plan.srcCounts.messages, 3);

let refused = false;
try {
  applyDump({ dumpPath: srcPath, destPath, spec, allowProdWrite: false });
} catch (e) {
  refused = /REFUSED/.test(e.message);
}
assert.ok(refused, 'must refuse without HITL flag');

const dumped = dumpAllowlist({ srcPath, dumpPath, spec });
assert.strictEqual(dumped.dumped.ontology_card, 1);
assert.strictEqual(dumped.dumped.message_vision_meta, 1);
const dumpDb = new Database(dumpPath, { readonly: true });
const dumpTables = dumpDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
assert.strictEqual(dumpDb.prepare('SELECT COUNT(*) AS c FROM message_vision_meta').get().c, 1);
assert.strictEqual(dumpDb.prepare('SELECT ticker FROM message_vision_meta').get().ticker, 'SPY');
dumpDb.close();
assert.ok(!dumpTables.includes('messages'));
assert.ok(!dumpTables.includes('trade_signals'));

const applied = applyDump({ dumpPath, destPath, spec, allowProdWrite: true });
assert.strictEqual(applied.messages, 8);
assert.strictEqual(applied.destCounts.ontology_card, 1);
assert.strictEqual(applied.applied.ontology_card, 1);

const dest2 = new Database(destPath, { readonly: true });
assert.strictEqual(dest2.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 8);
assert.strictEqual(dest2.prepare('SELECT ticker FROM trade_signals WHERE id=9').get().ticker, 'KEEP');
assert.strictEqual(dest2.prepare('SELECT title FROM ontology_card WHERE id=\'c1\'').get().title, 'TSLA');
dest2.close();

// Test planGoldenPlaybook and safety refusal
const mockPlaybookFile = path.join(dir, 'golden_playbook.json');
fs.writeFileSync(mockPlaybookFile, JSON.stringify([{ card_id: 'c1', ticker: 'TSLL' }]));
const gpPlan = planGoldenPlaybook({ localPath: mockPlaybookFile });
assert.strictEqual(gpPlan.ok, true);
assert.strictEqual(gpPlan.count, 1);
assert.ok(gpPlan.sizeBytes > 0);

let gpRefused = false;
try {
  promoteGoldenPlaybook({ allowProdWrite: false, localFile: mockPlaybookFile });
} catch (e) {
  gpRefused = /REFUSED/.test(e.message);
}
assert.ok(gpRefused, 'must refuse promoteGoldenPlaybook without allowProdWrite');

console.log('✅ [REQ-039] knowledge promote PASS');
