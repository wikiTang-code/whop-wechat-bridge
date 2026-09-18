#!/usr/bin/env node
/**
 * REQ-037 Phase 3 — sample ontology cards from recent messages.
 *
 *   node tools/knowledge/phase3_ontology_sample.js --limit 30 --mode stub
 *   node tools/knowledge/phase3_ontology_sample.js --limit 5 --mode llm
 *   node tools/knowledge/phase3_ontology_sample.js --limit 5 --mode llm --dry-run
 */
import {
  initDb,
  getDb,
  ensureOntologyCardTable,
  saveOntologyCard,
} from '../../database.js';
import { buildStubOntologyCards } from './ontology-card-stub.js';
import { extractOntologyCardsWithLlm } from './ontology-card-llm.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 20) : 20;
const modeIdx = args.indexOf('--mode');
const mode = modeIdx >= 0 ? String(args[modeIdx + 1] || 'stub') : 'stub';

if (!['stub', 'llm'].includes(mode)) {
  console.error('mode must be stub|llm');
  process.exit(1);
}

initDb();
const db = getDb();
ensureOntologyCardTable(db);

const rawRows = db.prepare(`
  SELECT id, content, tickers, created_at, sender_name
  FROM messages
  WHERE content IS NOT NULL AND TRIM(content) != ''
    AND (
      content LIKE '%止损%' OR content LIKE '%降仓%' OR content LIKE '%缺口%'
      OR content LIKE '%突破%' OR content LIKE '%降息%' OR content LIKE '%加息%'
      OR content LIKE '%股性%' OR content LIKE '%关键位%' OR content LIKE '%关键点%'
      OR content LIKE '%做T%' OR content LIKE '%风控%' OR content LIKE '%回踩%'
      OR content LIKE '%箱体%' OR content LIKE '%喇叭口%'
    )
  ORDER BY created_at DESC
  LIMIT ?
`).all(Math.max(limit * 8, 40));

const minChars = mode === 'llm' ? 24 : 12;
const rows = rawRows
  .filter((r) => Array.from(String(r.content || '')).length >= minChars)
  .slice(0, mode === 'llm' ? Math.min(limit, 8) : limit)
  .reverse();

// fallback: recent raw window if keyword filter empty
const scanRows = rows.length
  ? rows
  : db.prepare(`
      SELECT id, content, tickers, created_at, sender_name
      FROM messages
      WHERE content IS NOT NULL AND TRIM(content) != ''
      ORDER BY created_at DESC
      LIMIT ?
    `).all(mode === 'llm' ? Math.min(limit, 8) : limit).reverse();

let written = 0;
let cardsTotal = 0;
const errors = [];

for (const msg of scanRows) {
  try {
    let cards;
    if (mode === 'llm') {
      cards = await extractOntologyCardsWithLlm(msg);
    } else {
      cards = buildStubOntologyCards(msg);
    }
    cardsTotal += cards.length;
    if (dryRun) continue;
    for (const card of cards) {
      saveOntologyCard(card, db);
      written += 1;
    }
  } catch (e) {
    errors.push({ id: msg.id, error: e.message });
  }
}

const summary = {
  ok: errors.length === 0,
  dry_run: dryRun,
  mode,
  messages_scanned: scanRows.length,
  keyword_filtered: rows.length > 0,
  cards_produced: cardsTotal,
  rows_written: dryRun ? 0 : written,
  errors: errors.slice(0, 5),
  note: 'Phase4 WeCom frozen; llm mode uses deep lane + lms-guard',
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exit(errors.length ? 1 : 0);
