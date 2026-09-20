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
  fetchYahooDailyBars,
  listT2VisionGaps,
  listT2OntologyLevelGaps,
  extractGoldenPlaybook
} from './card_attribution.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const persist = args.includes('--persist');
const gapsOnly = args.includes('--gaps');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 500;
const outIdx = args.indexOf('--out');
const outPath =
  outIdx >= 0
    ? args[outIdx + 1]
    : path.resolve('data/runtime/req038-t2-attribution.json');
const goldenIdx = args.indexOf('--golden');
const goldenPath =
  goldenIdx >= 0
    ? args[goldenIdx + 1]
    : path.resolve('data/runtime/golden_playbook.json');

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
const msgGet = conn.prepare(
  'SELECT created_at, content, sender_id, sender_name FROM messages WHERE id = ?'
);

if (gapsOnly) {
  let visionRows = [];
  try {
    visionRows = conn
      .prepare(
        `SELECT id, message_id, ticker, status, support_resistance_json, hand_drawn_annotation
         FROM message_vision_meta`
      )
      .all();
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
  const levelCards = conn
    .prepare(
      `SELECT * FROM ontology_card WHERE card_type='level' AND (provider='multimodal_vl' OR id LIKE 'card_mm_%')`
    )
    .all();
  const report = {
    ok: true,
    mode: 'gaps',
    db: dbPath,
    ...listT2VisionGaps(visionRows),
    ontology: listT2OntologyLevelGaps(levelCards, {
      resolveSender: (mid) => msgGet.get(mid) || null
    })
  };
  const gapsOut =
    outIdx >= 0 ? outPath : path.resolve('data/runtime/req038-t2-vl-gaps.json');
  fs.mkdirSync(path.dirname(gapsOut), { recursive: true });
  fs.writeFileSync(gapsOut, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, out: gapsOut }, null, 2));
  conn.close();
  process.exit(0);
}

const cards = conn.prepare(`
  SELECT * FROM ontology_card
  WHERE card_type IN ('pattern','asset_memory','risk_rule','level')
`).all();

let visGet = null;
try {
  visGet = conn.prepare(
    'SELECT support_resistance_json, ticker FROM message_vision_meta WHERE message_id = ? ORDER BY attach_index ASC LIMIT 1'
  );
} catch {
  visGet = null;
}

const enrichedCards = cards.map((card) => {
  const mid = firstSourceMessageId(card);
  const msg = mid ? msgGet.get(mid) : null;
  return {
    ...card,
    source_text: msg?.content || '',
    _msg: msg
  };
});

const candidates = selectCandidateCards(enrichedCards);

const SKIP_YAHOO = new Set([
  'skipped_ticker',
  'skipped_type',
  'skipped_no_level',
  'skipped_no_direction',
  'unscored_mixed',
  'skipped_non_zhao'
]);

const prepped = candidates.map((card) => {
  const msg = card._msg;
  const mid = firstSourceMessageId(card);
  const visionMeta = mid && visGet ? visGet.get(mid) : null;
  const sourceSender = msg
    ? { sender_id: msg.sender_id, sender_name: msg.sender_name }
    : null;
  // CHG-044: enable direction-only mode to capture cards without explicit price level
  const preview = evaluateCard(card, {
    messageCreatedAt: msg?.created_at ?? null,
    bars: [],
    visionMeta,
    sourceSender,
    allowDirectionOnly: true
  });
  return { card, created: msg?.created_at ?? null, preview, visionMeta, sourceSender };
});
const skipCounts = {};
for (const p of prepped) {
  const s = p.preview.status || 'unknown';
  skipCounts[s] = (skipCounts[s] || 0) + 1;
}
// CHG-044: include direction_only cards in eligible set
const yahooEligible = prepped.filter((p) => !SKIP_YAHOO.has(p.preview.status));
const picked = yahooEligible.slice(0, Number.isFinite(limit) ? limit : 500);

const barCache = {};
async function barsFor(ticker) {
  if (!barCache[ticker]) {
    barCache[ticker] = await fetchYahooDailyBars(ticker);
  }
  return barCache[ticker];
}

const results = [];
for (const { card, created, preview, visionMeta, sourceSender } of picked) {
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
  const ev = evaluateCard(card, {
    messageCreatedAt: created,
    bars,
    visionMeta,
    sourceSender,
    allowDirectionOnly: true
  });
  const row = {
    card_id: card.id,
    card_type: card.card_type,
    title: card.title,
    action_text: card.action_text,
    trigger_text: card.trigger_text,
    theory_text: card.theory_text,
    visionMeta,
    ...ev
  };
  results.push(row);
  if (persist && !dry) saveAttributionRow(conn, card.id, ev);
}

const goldenPlaybook = extractGoldenPlaybook(results);

const report = {
  ok: true,
  dry,
  persist: persist && !dry,
  spec: 'docs/project/req038-t2-attribution-spec.md',
  db: dbPath,
  candidates: candidates.length,
  with_explicit_level: yahooEligible.filter((p) => p.preview.level != null && p.preview.level_source !== 'direction_only').length,
  with_direction_only: yahooEligible.filter((p) => p.preview.level_source === 'direction_only').length,
  yahoo_eligible: yahooEligible.length,
  skip_counts: skipCounts,
  evaluated: results.length,
  summary: summarize(results),
  golden_playbook_count: goldenPlaybook.length,
  results
};

if (outPath && !dry) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  report.out = outPath;
}

if (goldenPath && !dry) {
  fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
  fs.writeFileSync(goldenPath, JSON.stringify(goldenPlaybook, null, 2), 'utf8');
  report.golden_out = goldenPath;
}

console.log(
  JSON.stringify(
    dry
      ? {
          ...report,
          golden_sample: goldenPlaybook.slice(0, 3),
          results: results.slice(0, 12)
        }
      : {
          ok: report.ok,
          summary: report.summary,
          out: report.out,
          golden_out: report.golden_out,
          golden_playbook_count: report.golden_playbook_count,
          evaluated: report.evaluated,
          candidates: report.candidates
        },
    null,
    2
  )
);
conn.close();
