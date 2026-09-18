#!/usr/bin/env node
/**
 * Export recent message windows for human CU boundary labeling (local file, not for commit).
 *
 *   node tools/knowledge/export_semantic_cu_golden_candidates.js --limit 80
 *   node tools/knowledge/export_semantic_cu_golden_candidates.js --limit 120 --channel <id>
 *   node tools/knowledge/export_semantic_cu_golden_candidates.js --limit 120 --sender 赵
 *   → writes tools/knowledge/semantic_cu_golden_filled.json (gitignored)
 *
 * Preserves existing human `boundary_start` labels on --merge (default).
 * Fills `boundary_suggested` via heuristic_v1 for faster human review.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from '../../database.js';
import { segmentMessagesIntoSemanticCu } from './semantic-cu-segment.js';
import { predictedStartsFromUnits } from './semantic-cu-eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'semantic_cu_golden_filled.json');
const args = process.argv.slice(2);

function argVal(flag, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || '').trim() : fallback;
}

const limit = Math.max(20, parseInt(argVal('--limit', '80'), 10) || 80);
const channelId = argVal('--channel');
const senderNeedle = argVal('--sender');
const gapMs = Math.max(60_000, (parseInt(argVal('--gap-min', '30'), 10) || 30) * 60_000);
const merge = !args.includes('--no-merge');

initDb();
const db = getDb();

const params = [];
let where = '1=1';
if (channelId) {
  where += ' AND channel_id = ?';
  params.push(channelId);
}
if (senderNeedle) {
  where += ' AND (sender_name LIKE ? OR sender_id LIKE ?)';
  const like = `%${senderNeedle}%`;
  params.push(like, like);
}
params.push(limit);

const rows = db.prepare(`
  SELECT id, channel_id, channel_name, sender_name, content, tickers, created_at
  FROM messages
  WHERE ${where}
  ORDER BY created_at DESC
  LIMIT ?
`).all(...params).reverse();

const priorLabels = new Map();
if (merge && fs.existsSync(outPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    for (const it of prev.items || []) {
      if (it?.message_id != null && it.boundary_start != null) {
        priorLabels.set(String(it.message_id), it.boundary_start);
      }
    }
  } catch (_) {
    /* keep going with fresh export */
  }
}

const units = segmentMessagesIntoSemanticCu(
  rows.map((r) => ({
    id: r.id,
    channel_id: r.channel_id,
    created_at: r.created_at,
    tickers: r.tickers,
    sender_name: r.sender_name,
  })),
  { gapMs, method: 'heuristic_v1' },
);
const suggested = new Set(predictedStartsFromUnits(units));

const payload = {
  req: 'REQ-037',
  phase: 2,
  exported_at: new Date().toISOString(),
  purpose: 'Local human-label worksheet; do not commit.',
  gap_ms_hint: gapMs,
  filter: { channel_id: channelId || null, sender: senderNeedle || null, limit },
  howto: 'Set boundary_start=true on CU starts (false/null otherwise). boundary_suggested is heuristic only.',
  items: rows.map((r) => {
    const id = String(r.id);
    const prior = priorLabels.has(id) ? priorLabels.get(id) : null;
    return {
      message_id: r.id,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      sender_name: r.sender_name,
      created_at: r.created_at,
      tickers: r.tickers,
      content_preview: String(r.content || '').slice(0, 160),
      boundary_suggested: suggested.has(id),
      boundary_start: prior,
    };
  }),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
const labeled = payload.items.filter((it) => it.boundary_start === true || it.boundary_start === 1).length;
process.stdout.write(`${JSON.stringify({
  ok: true,
  out: outPath,
  items: payload.items.length,
  suggested_starts: suggested.size,
  preserved_human_labels: labeled,
  note: 'Label boundary_start (≥30 starts for P2 human-gold acceptance); keep file local',
}, null, 2)}\n`);
