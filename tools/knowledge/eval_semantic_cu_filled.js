#!/usr/bin/env node
/**
 * Evaluate heuristic / embed_drift against a human-filled CU golden worksheet.
 *
 *   node tools/knowledge/eval_semantic_cu_filled.js
 *   node tools/knowledge/eval_semantic_cu_filled.js --path tools/knowledge/semantic_cu_golden_filled.json
 *   node tools/knowledge/eval_semantic_cu_filled.js --require-min 30
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { segmentMessagesIntoSemanticCu } from './semantic-cu-segment.js';
import { evalBoundaries, predictedStartsFromUnits } from './semantic-cu-eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function argVal(flag, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || '').trim() : fallback;
}

const filePath = path.resolve(argVal('--path', path.join(__dirname, 'semantic_cu_golden_filled.json')));
const requireMin = Math.max(0, parseInt(argVal('--require-min', '0'), 10) || 0);
const method = argVal('--method', 'heuristic_v1') || 'heuristic_v1';

if (!fs.existsSync(filePath)) {
  console.error(JSON.stringify({ ok: false, error: 'missing_file', path: filePath }));
  process.exit(2);
}

const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const items = Array.isArray(payload.items) ? payload.items : [];
const gapMs = Number.isFinite(payload.gap_ms_hint) ? payload.gap_ms_hint : 30 * 60 * 1000;

const goldStarts = items
  .filter((it) => it.boundary_start === true || it.boundary_start === 1 || it.boundary_start === 'true')
  .map((it) => String(it.message_id));

const messages = items.map((it) => ({
  id: it.message_id,
  channel_id: it.channel_id,
  created_at: it.created_at,
  tickers: it.tickers,
  sender_name: it.sender_name,
}));

const units = segmentMessagesIntoSemanticCu(messages, { gapMs, method });
const metrics = evalBoundaries(predictedStartsFromUnits(units), goldStarts);

const result = {
  ok: goldStarts.length > 0,
  path: filePath,
  method,
  items: items.length,
  gold_n: goldStarts.length,
  require_min: requireMin,
  metrics,
};

if (requireMin > 0 && goldStarts.length < requireMin) {
  console.error(JSON.stringify({ ...result, error: 'insufficient_labels' }, null, 2));
  process.exit(3);
}

if (goldStarts.length === 0) {
  console.error(JSON.stringify({ ...result, error: 'no_human_labels' }, null, 2));
  process.exit(4);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
