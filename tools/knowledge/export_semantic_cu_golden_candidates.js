#!/usr/bin/env node
/**
 * Export recent message windows for human CU boundary labeling (local file, not for commit).
 *
 *   node tools/knowledge/export_semantic_cu_golden_candidates.js --limit 80
 *   → writes tools/knowledge/semantic_cu_golden_filled.json (gitignored)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from '../../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'semantic_cu_golden_filled.json');
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(20, parseInt(args[limitIdx + 1], 10) || 80) : 80;

initDb();
const db = getDb();
const rows = db.prepare(`
  SELECT id, channel_id, channel_name, sender_name, content, tickers, created_at
  FROM messages
  ORDER BY created_at DESC
  LIMIT ?
`).all(limit).reverse();

const payload = {
  req: 'REQ-037',
  phase: 2,
  exported_at: new Date().toISOString(),
  purpose: 'Local human-label worksheet; do not commit.',
  gap_ms_hint: 1800000,
  items: rows.map((r) => ({
    message_id: r.id,
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    sender_name: r.sender_name,
    created_at: r.created_at,
    tickers: r.tickers,
    content_preview: String(r.content || '').slice(0, 160),
    boundary_start: null,
  })),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: true,
  out: outPath,
  items: payload.items.length,
  note: 'Label boundary_start then keep file local; ≥30 starts for P2 acceptance',
}, null, 2)}\n`);
