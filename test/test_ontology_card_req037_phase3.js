/**
 * REQ-037 Phase 3: ontology_card table + stub extractor
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  ensureOntologyCardTable,
  saveOntologyCard,
  listOntologyCards,
} from '../database.js';
import { buildStubOntologyCards } from '../tools/knowledge/ontology-card-stub.js';

const db = new Database(':memory:');
ensureOntologyCardTable(db);

const msg = {
  id: 'm_risk_1',
  content: '弱势反弹跌破周五低点无条件止损，降仓至三四成',
  tickers: '["TSLA"]',
};
const cards = buildStubOntologyCards(msg);
assert.ok(cards.length >= 1);
assert.strictEqual(cards[0].card_type, 'risk_rule');
assert.strictEqual(cards[0].provider, 'stub');
assert.strictEqual(cards[0].status, 'pending_llm');

const id = saveOntologyCard(cards[0], db);
assert.ok(id.includes('risk_rule'));

const { rows, total } = listOntologyCards({ cardType: 'risk_rule', dbInstance: db });
assert.strictEqual(total, 1);
assert.strictEqual(rows[0].title, '止损/降仓纪律');
const schema = JSON.parse(rows[0].schema_json);
assert.strictEqual(schema.stub, true);

const none = buildStubOntologyCards({ id: 'm0', content: '早上好' });
assert.strictEqual(none.length, 0);

console.log('test_ontology_card_req037_phase3: PASS');
