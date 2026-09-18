/**
 * REQ-037 — filled-worksheet eval harness (no DB / no GPU).
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'tools/knowledge/eval_semantic_cu_filled.js');

const tmp = path.join(os.tmpdir(), `cu_filled_eval_${Date.now()}.json`);
const fixture = {
  req: 'REQ-037',
  gap_ms_hint: 30 * 60 * 1000,
  items: [
    { message_id: 'a1', channel_id: 'c', created_at: 1_000_000, tickers: '["TSLA"]', boundary_start: true },
    { message_id: 'a2', channel_id: 'c', created_at: 1_000_000 + 60_000, tickers: '["TSLA"]', boundary_start: null },
    { message_id: 'a3', channel_id: 'c', created_at: 1_000_000 + 2_000_000, tickers: '["NVDA"]', boundary_start: true },
    { message_id: 'a4', channel_id: 'c', created_at: 1_000_000 + 2_100_000, tickers: '["NVDA"]', boundary_start: false },
  ],
};
fs.writeFileSync(tmp, JSON.stringify(fixture), 'utf8');

const run = spawnSync(process.execPath, [script, '--path', tmp], { encoding: 'utf8' });
assert.strictEqual(run.status, 0, run.stderr || run.stdout);
const out = JSON.parse(run.stdout);
assert.strictEqual(out.gold_n, 2);
assert.strictEqual(out.metrics.f1, 1);

const empty = path.join(os.tmpdir(), `cu_filled_empty_${Date.now()}.json`);
fs.writeFileSync(empty, JSON.stringify({ items: [{ message_id: 'x', channel_id: 'c', created_at: 1, boundary_start: null }] }), 'utf8');
const runEmpty = spawnSync(process.execPath, [script, '--path', empty], { encoding: 'utf8' });
assert.strictEqual(runEmpty.status, 4);

fs.unlinkSync(tmp);
fs.unlinkSync(empty);
console.log('test_semantic_cu_filled_eval_req037: PASS', out.metrics);
