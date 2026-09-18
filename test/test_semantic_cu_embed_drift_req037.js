/**
 * REQ-037 Phase 2 — embed_drift_v1 breaks when heuristic would not.
 */
import assert from 'assert';
import { segmentMessagesIntoSemanticCu } from '../tools/knowledge/semantic-cu-segment.js';
import { predictedStartsFromUnits, cosineSimilarity } from '../tools/knowledge/semantic-cu-eval.js';

const t0 = 2_000_000_000_000;
const eTopicA = new Float32Array([1, 0, 0, 0]);
const eTopicB = new Float32Array([0, 1, 0, 0]);
assert.ok(cosineSimilarity(eTopicA, eTopicB) < 0.1);

const messages = [
  { id: 'e1', channel_id: 'ch', created_at: t0, tickers: '["TSLA"]', sender_name: '赵哥', embedding: eTopicA },
  { id: 'e2', channel_id: 'ch', created_at: t0 + 60_000, tickers: '["TSLA"]', sender_name: '赵哥', embedding: eTopicA },
  // same ticker + small gap — heuristic keeps one CU; orthogonal embed should split
  { id: 'e3', channel_id: 'ch', created_at: t0 + 120_000, tickers: '["TSLA"]', sender_name: '赵哥', embedding: eTopicB },
  { id: 'e4', channel_id: 'ch', created_at: t0 + 180_000, tickers: '["TSLA"]', sender_name: '赵哥', embedding: eTopicB },
];

const heuristic = segmentMessagesIntoSemanticCu(messages, { method: 'heuristic_v1', gapMs: 30 * 60 * 1000 });
assert.strictEqual(predictedStartsFromUnits(heuristic).length, 1, 'heuristic should stay one CU');

const drifted = segmentMessagesIntoSemanticCu(messages, {
  method: 'embed_drift_v1',
  gapMs: 30 * 60 * 1000,
  embedThreshold: 0.55,
});
const starts = predictedStartsFromUnits(drifted);
assert.deepStrictEqual(starts, ['e1', 'e3']);

console.log('test_semantic_cu_embed_drift_req037: PASS', { starts });
