#!/usr/bin/env node
/**
 * REQ-037 Phase 1 — sample scan: messages with attachments → message_vision_meta (stub).
 *
 *   node tools/knowledge/phase1_vision_meta_sample.js --limit 50
 *   node tools/knowledge/phase1_vision_meta_sample.js --limit 20 --dry-run
 */
import { initDb, getDb, listMessagesNeedingVisionMeta, saveMessageVisionMeta } from '../../database.js';
import { buildStubVisionMetas } from './vision-meta-stub.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 50) : 50;

initDb();
const db = getDb();
const rows = listMessagesNeedingVisionMeta({ limit, dbInstance: db });

let written = 0;
let slots = 0;
for (const msg of rows) {
  const metas = buildStubVisionMetas(msg);
  slots += metas.length;
  if (dryRun) continue;
  for (const meta of metas) {
    saveMessageVisionMeta(meta, db);
    written += 1;
  }
}

const summary = {
  ok: true,
  dry_run: dryRun,
  messages_scanned: rows.length,
  meta_slots: slots,
  rows_written: dryRun ? 0 : written,
  note: 'provider=stub; VL extraction gated by Q-006; Phase 4 WeCom push still frozen',
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
