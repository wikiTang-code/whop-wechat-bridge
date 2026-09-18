/**
 * REQ-037 Phase 2 — tiny golden boundary fixture + heuristic eval harness.
 * Not a substitute for ≥30 human-labeled boundaries; smoke-checks the metric path.
 */
import assert from 'assert';
import { segmentMessagesIntoSemanticCu } from '../tools/knowledge/semantic-cu-segment.js';

/** Hand labels: message_id that STARTS a new CU (first msg of each unit). */
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
  /** expected CU start message ids */
  boundary_starts: ['g1', 'g4', 'g6'],
};

function evalBoundaries(predictedStarts, goldStarts) {
  const pred = new Set(predictedStarts);
  const gold = new Set(goldStarts);
  let tp = 0;
  for (const id of pred) if (gold.has(id)) tp += 1;
  const precision = pred.size ? tp / pred.size : 0;
  const recall = gold.size ? tp / gold.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, precision, recall, f1, pred_n: pred.size, gold_n: gold.size };
}

const units = segmentMessagesIntoSemanticCu(FIXTURE.messages, { gapMs: FIXTURE.gap_ms });
const predicted = units.map((u) => u.members[0]?.message_id).filter(Boolean);
const metrics = evalBoundaries(predicted, FIXTURE.boundary_starts);

assert.strictEqual(metrics.f1, 1, `expected perfect smoke F1, got ${JSON.stringify(metrics)}`);
assert.ok(metrics.f1 >= 0.7, 'acceptance floor');

console.log('test_semantic_cu_golden_smoke_req037: PASS', metrics);
