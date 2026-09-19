#!/usr/bin/env node
/**
 * REQ-038-T2 CLI — TSLA/TSLL subset attribution.
 *   node tools/knowledge/card_attribution_cli.js --dry-run
 *   node tools/knowledge/card_attribution_cli.js --limit 80 --out data/runtime/req038-t2-attribution.json
 * Filename avoids gitignore `run_*.js`. Does not touch batch_vision / wecom / trade_signals.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  selectCandidateCards,
  firstSourceMessageId,
  evaluateCard,
  summarize,
  saveAttributionRow,
  fetchYahooDailyBars
} from './card_attribution.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const persist = args.includes('--persist');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 200;
const outIdx = args.indexOf('--out');
const outPath =
  outIdx >= 0
    ? args[outIdx + 1]
    : path.resolve('data/runtime/req038-t2-attribution.json');

const dbPath =
  process.env.SQLITE_PATH ||
  (fs.existsSync(path.resolve('whop_archive.db'))
    ? path.resolve('whop_archive.db')
    : path.resolve('data/whop_bridge.db'));
if (!fs.existsSync(dbPath)) {
  console.error(JSON.stringify({ ok: false, error: `db missing: ${dbPath}` }));
  process.exit(1);
}

const conn = new Database(dbPath, { readonly: !persist, fileMustExist: true, timeout: 8000 });
const cards = conn.prepare(`
  SELECT * FROM ontology_card
  WHERE card_type IN ('pattern','asset_memory','risk_rule')
`).all();
const candidates = selectCandidateCards(cards);
const msgGet = conn.prepare('SELECT created_at, content FROM messages WHERE id = ?');
const SKIP_YAHOO = new Set([
  'skipped_ticker',
  'skipped_type',
  'skipped_no_level',
  'skipped_no_direction',
  'unscored_mixed',
  'skipped_ticker'
]);

const prepped = candidates.map((card) => {
  const mid = firstSourceMessageId(card);
  const msg = mid ? msgGet.get(mid) : null;
  const card2 = { ...card, source_text: msg?.content || '' };
  const preview = evaluateCard(card2, { messageCreatedAt: msg?.created_at ?? null, bars: [] });
  return { card: card2, created: msg?.created_at ?? null, preview };
});
const skipCounts = {};
for (const p of prepped) {
  const s = p.preview.status || 'unknown';
  skipCounts[s] = (skipCounts[s] || 0) + 1;
}
const withLevel = prepped.filter((p) => !SKIP_YAHOO.has(p.preview.status));
const picked = withLevel.slice(0, Number.isFinite(limit) ? limit : 200);

const barCache = {};
async function barsFor(ticker) {
  if (!barCache[ticker]) {
    barCache[ticker] = await fetchYahooDailyBars(ticker);
  }
  return barCache[ticker];
}

const results = [];
for (const { card, created, preview } of picked) {
  let bars = [];
  const ticker = preview.ticker;
  if (ticker) {
    try {
      bars = await barsFor(ticker);
    } catch (e) {
      results.push({ card_id: card.id, status: 'skipped_no_bars', error: e.message, ticker });
      continue;
    }
  }
  const ev = evaluateCard(card, { messageCreatedAt: created, bars });
  const row = { card_id: card.id, card_type: card.card_type, title: card.title, ...ev };
  results.push(row);
  if (persist && !dry) saveAttributionRow(conn, card.id, ev);
}

const report = {
  ok: true,
  dry,
  persist: persist && !dry,
  spec: 'docs/project/req038-t2-attribution-spec.md',
  db: dbPath,
  candidates: candidates.length,
  with_level: withLevel.length,
  skip_counts: skipCounts,
  evaluated: results.length,
  summary: summarize(results),
  results
};

if (outPath && !dry) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  report.out = outPath;
}

console.log(
  JSON.stringify(
    dry
      ? { ...report, results: results.slice(0, 12) }
      : {
          ok: report.ok,
          summary: report.summary,
          out: report.out,
          evaluated: report.evaluated,
          candidates: report.candidates
        },
    null,
    2
  )
);
conn.close();
