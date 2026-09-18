#!/usr/bin/env node
/**
 * REQ-037 Phase 2 — sample: recent messages → semantic_cu (heuristic_v1).
 *
 *   node tools/knowledge/phase2_semantic_cu_sample.js --limit 200
 *   node tools/knowledge/phase2_semantic_cu_sample.js --limit 100 --dry-run
 *   node tools/knowledge/phase2_semantic_cu_sample.js --channel <id> --gap-min 30
 */
import {
  initDb,
  getDb,
  ensureSemanticCuTables,
  saveSemanticCu,
} from '../../database.js';
import { segmentMessagesIntoSemanticCu } from './semantic-cu-segment.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 200) : 200;
const channelIdx = args.indexOf('--channel');
const channelId = channelIdx >= 0 ? String(args[channelIdx + 1] || '').trim() : '';
const gapIdx = args.indexOf('--gap-min');
const gapMin = gapIdx >= 0 ? Math.max(1, parseInt(args[gapIdx + 1], 10) || 30) : 30;

initDb();
const db = getDb();
ensureSemanticCuTables(db);

const params = [];
let where = '1=1';
if (channelId) {
  where += ' AND channel_id = ?';
  params.push(channelId);
}
// newest window then re-sort ascending for segmenter
const newest = db.prepare(`
  SELECT id, channel_id, created_at, tickers, sender_name
  FROM messages
  WHERE ${where}
  ORDER BY created_at DESC
  LIMIT ?
`).all(...params, limit);
const rows = [...newest].sort((a, b) => a.created_at - b.created_at);

const units = segmentMessagesIntoSemanticCu(rows, { gapMs: gapMin * 60 * 1000 });
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
  messages_loaded: rows.length,
  cu_units: units.length,
  rows_written: dryRun ? 0 : written,
  gap_min: gapMin,
  method: 'heuristic_v1',
  note: 'sample only; embedding drift + golden-set eval still open; Phase4 frozen',
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
