/**
 * REQ-037 Phase 2 — tiny golden boundary fixture + heuristic eval harness.
 * Not a substitute for ≥30 set (see semantic_cu_golden_v0.json).
 */
import assert from 'assert';
import { segmentMessagesIntoSemanticCu } from '../tools/knowledge/semantic-cu-segment.js';
import { evalBoundaries, predictedStartsFromUnits } from '../tools/knowledge/semantic-cu-eval.js';

const FIXTURE = {
  gap_ms: 30 * 60 * 1000,
  messages: [
    { id: 'g1', channel_id: 'gold', created_at: 1_000_000, tickers: '["TSLA"]', sender_name: '赵哥' },
    { id: 'g2', channel_id: 'gold', created_at: 1_000_000 + 120_000, tickers: '["TSLA"]', sender_name: '群友' },
    { id: 'g3', channel_id: 'gold', created_at: 1_000_000 + 240_000, tickers: '["TSLA"]', sender_name: '赵哥' },
    { id: 'g4', channel_id: 'gold', created_at: 1_000_000 + 2_000_000, tickers: '["NVDA"]', sender_name: '赵哥' },
    { id: 'g5', channel_id: 'gold', created_at: 1_000_000 + 2_100_000, tickers: '["NVDA"]', sender_name: '赵哥' },
    { id: 'g6', channel_id: 'gold', created_at: 1_000_000 + 2_200_000, tickers: '["CIFR"]', sender_name: '赵哥' },
  ],
  boundary_starts: ['g1', 'g4', 'g6'],
};

const units = segmentMessagesIntoSemanticCu(FIXTURE.messages, { gapMs: FIXTURE.gap_ms });
const metrics = evalBoundaries(predictedStartsFromUnits(units), FIXTURE.boundary_starts);

assert.strictEqual(metrics.f1, 1, `expected perfect smoke F1, got ${JSON.stringify(metrics)}`);
assert.ok(metrics.f1 >= 0.7, 'acceptance floor');

console.log('test_semantic_cu_golden_smoke_req037: PASS', metrics);
