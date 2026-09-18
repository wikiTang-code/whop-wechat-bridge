/**
 * REQ-037 Phase 3 — ontology LLM JSON normalize (no live LM call)
 */
import assert from 'assert';
import {
  cleanJsonOutput,
  normalizeOntologyLlmResult,
  ONTOLOGY_SYSTEM_PROMPT,
} from '../tools/knowledge/ontology-card-llm.js';

assert.ok(ONTOLOGY_SYSTEM_PROMPT.includes('risk_rule'));

const raw = '```json\n{"cards":[{"card_type":"risk_rule","title":"止损","trigger_text":"跌破低点","action_text":"降仓","theory_text":"风控","tickers":["tsla"]},{"card_type":"bogus","title":"x"}]}\n```';
const parsed = JSON.parse(cleanJsonOutput(raw));
const cards = normalizeOntologyLlmResult(parsed, { id: 'm1' });
assert.strictEqual(cards.length, 1);
assert.strictEqual(cards[0].card_type, 'risk_rule');
assert.strictEqual(cards[0].provider, 'llm_14b');
assert.deepStrictEqual(cards[0].tickers, ['TSLA']);
assert.ok(cards[0].id.includes('m1'));

const empty = normalizeOntologyLlmResult({ cards: [] }, { id: 'm2' });
assert.strictEqual(empty.length, 0);

console.log('test_ontology_card_llm_req037_phase3: PASS');
