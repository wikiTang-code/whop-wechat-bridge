/**
 * REQ-037 Phase 2 — ≥30 synthetic golden boundaries (heuristic_v1).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { segmentMessagesIntoSemanticCu } from '../tools/knowledge/semantic-cu-segment.js';
import { evalBoundaries, predictedStartsFromUnits } from '../tools/knowledge/semantic-cu-eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldPath = path.join(__dirname, '../tools/knowledge/semantic_cu_golden_v0.json');
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));

assert.ok(gold.boundary_starts.length >= 30, `need ≥30 gold starts, got ${gold.boundary_starts.length}`);

const units = segmentMessagesIntoSemanticCu(gold.messages, { gapMs: gold.gap_ms, method: 'heuristic_v1' });
const predicted = predictedStartsFromUnits(units);
const metrics = evalBoundaries(predicted, gold.boundary_starts);

assert.ok(metrics.f1 >= 0.7, `F1 ${metrics.f1} < 0.7 ${JSON.stringify(metrics)}`);
assert.strictEqual(metrics.f1, 1, `synthetic v0 should be exact for heuristic_v1: ${JSON.stringify(metrics)}`);

console.log('test_semantic_cu_golden_v0_req037: PASS', metrics);
