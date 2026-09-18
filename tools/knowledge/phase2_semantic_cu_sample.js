#!/usr/bin/env node
/**
 * REQ-037 Phase 2 — sample: recent messages → semantic_cu.
 *
 *   node tools/knowledge/phase2_semantic_cu_sample.js --limit 200
 *   node tools/knowledge/phase2_semantic_cu_sample.js --limit 100 --dry-run
 *   node tools/knowledge/phase2_semantic_cu_sample.js --channel <id> --gap-min 30
 *   node tools/knowledge/phase2_semantic_cu_sample.js --method embed_drift_v1 --limit 100 --dry-run
 */
import {
  initDb,
  getDb,
  ensureSemanticCuTables,
  saveSemanticCu,
} from '../../database.js';
import { segmentMessagesIntoSemanticCu } from './semantic-cu-segment.js';
import { embeddingBufferToFloat32 } from './semantic-cu-eval.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 200) : 200;
const channelIdx = args.indexOf('--channel');
const channelId = channelIdx >= 0 ? String(args[channelIdx + 1] || '').trim() : '';
const gapIdx = args.indexOf('--gap-min');
const gapMin = gapIdx >= 0 ? Math.max(1, parseInt(args[gapIdx + 1], 10) || 30) : 30;
const methodIdx = args.indexOf('--method');
const method = methodIdx >= 0 ? String(args[methodIdx + 1] || 'heuristic_v1') : 'heuristic_v1';

initDb();
const db = getDb();
ensureSemanticCuTables(db);

const params = [];
let where = '1=1';
if (channelId) {
  where += ' AND channel_id = ?';
  params.push(channelId);
}
const newest = db.prepare(`
  SELECT id, channel_id, created_at, tickers, sender_name
  FROM messages
  WHERE ${where}
  ORDER BY created_at DESC
  LIMIT ?
`).all(...params, limit);
const rows = [...newest].sort((a, b) => a.created_at - b.created_at);

let embeddingsById = null;
let embedHits = 0;
if (method === 'embed_drift_v1' && rows.length) {
  embeddingsById = {};
  const placeholders = rows.map(() => '?').join(',');
  const embRows = db.prepare(`
    SELECT id, embedding FROM message_embeddings WHERE id IN (${placeholders})
  `).all(...rows.map((r) => r.id));
  for (const er of embRows) {
    const vec = embeddingBufferToFloat32(er.embedding);
    if (vec) {
      embeddingsById[er.id] = vec;
      embedHits += 1;
    }
  }
}

const units = segmentMessagesIntoSemanticCu(rows, {
  gapMs: gapMin * 60 * 1000,
  method,
  embeddingsById,
});
let written = 0;
if (!dryRun) {
  for (const cu of units) {
    saveSemanticCu(cu, db);
    written += 1;
  }
}

const summary = {
  ok: true,
  dry_run: dryRun,
  channel_id: channelId || null,
  method,
  messages_loaded: rows.length,
  embeddings_loaded: embedHits,
  cu_units: units.length,
  rows_written: dryRun ? 0 : written,
  gap_min: gapMin,
  note: 'P2 sample; Phase4 frozen; human chat gold optional',
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
