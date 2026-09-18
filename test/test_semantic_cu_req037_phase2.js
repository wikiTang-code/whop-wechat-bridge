/**
 * REQ-037 Phase 2: semantic_cu tables + heuristic segmenter
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  ensureSemanticCuTables,
  saveSemanticCu,
  getSemanticCu,
  listSemanticCu,
} from '../database.js';
import { segmentMessagesIntoSemanticCu } from '../tools/knowledge/semantic-cu-segment.js';

const db = new Database(':memory:');
ensureSemanticCuTables(db);

const t0 = Date.UTC(2026, 8, 18, 2, 0, 0);
const msgs = [
  { id: 'm1', channel_id: 'ch1', created_at: t0, tickers: '["TSLA"]', sender_name: '赵哥' },
  { id: 'm2', channel_id: 'ch1', created_at: t0 + 5 * 60 * 1000, tickers: '["TSLA"]', sender_name: '群友A' },
  { id: 'm3', channel_id: 'ch1', created_at: t0 + 10 * 60 * 1000, tickers: '["TSLA"]', sender_name: '赵哥' },
  // gap > 30m → new CU
  { id: 'm4', channel_id: 'ch1', created_at: t0 + 50 * 60 * 1000, tickers: '["NVDA"]', sender_name: '赵哥' },
  { id: 'm5', channel_id: 'ch1', created_at: t0 + 55 * 60 * 1000, tickers: '["NVDA"]', sender_name: '赵哥' },
  // ticker shift without large gap
  { id: 'm6', channel_id: 'ch1', created_at: t0 + 58 * 60 * 1000, tickers: '["CIFR"]', sender_name: '赵哥' },
];

const units = segmentMessagesIntoSemanticCu(msgs, { gapMs: 30 * 60 * 1000 });
assert.strictEqual(units.length, 3, `expected 3 CUs, got ${units.length}`);
assert.strictEqual(units[0].primary_ticker, 'TSLA');
assert.strictEqual(units[0].members.length, 3);
assert.strictEqual(units[1].primary_ticker, 'NVDA');
assert.strictEqual(units[1].members.length, 2);
assert.strictEqual(units[2].primary_ticker, 'CIFR');
assert.strictEqual(units[2].members.length, 1);
assert.strictEqual(units[0].members[1].role, 'question');

const id0 = saveSemanticCu(units[0], db);
const loaded = getSemanticCu(id0, db);
assert.ok(loaded);
assert.strictEqual(loaded.primary_ticker, 'TSLA');
assert.strictEqual(loaded.members.length, 3);
assert.strictEqual(loaded.method, 'heuristic_v1');

saveSemanticCu(units[1], db);
saveSemanticCu(units[2], db);
const { rows, total } = listSemanticCu({ channelId: 'ch1', dbInstance: db });
assert.strictEqual(total, 3);
assert.strictEqual(rows.length, 3);

// idempotent upsert
saveSemanticCu({ ...units[0], summary: 'tsla thread' }, db);
const again = getSemanticCu(id0, db);
assert.strictEqual(again.summary, 'tsla thread');
assert.strictEqual(again.members.length, 3);

console.log('test_semantic_cu_req037_phase2: PASS');
