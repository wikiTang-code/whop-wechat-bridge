import assert from 'assert';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  extractTriggerLevels,
  generateRuleSummary,
  extractGoldenPlaybook,
  filterRadarPlaybook,
  isZhaoSender,
  ZHAO_SENDER_ID,
  ATTR_TICKERS
} from '../tools/knowledge/card_attribution.js';


console.log('🧪 [REQ-038-T2/REQ-040] golden playbook unit and contract tests');

// 1. Unit tests: extractTriggerLevels
const lvl1 = extractTriggerLevels({ level: 10, direction: 'bullish' }, null);
assert.deepStrictEqual(lvl1.support, [10]);
assert.deepStrictEqual(lvl1.resistance, []);

const lvl2 = extractTriggerLevels({ level: 15, direction: 'bearish' }, null);
assert.deepStrictEqual(lvl2.support, []);
assert.deepStrictEqual(lvl2.resistance, [15]);

const lvl3 = extractTriggerLevels(
  { level: 10, direction: 'bullish' },
  { support_resistance_json: JSON.stringify({ support: [10, 9.8], resistance: [10.8] }) }
);
assert.deepStrictEqual(lvl3.support, [10, 9.8]);
assert.deepStrictEqual(lvl3.resistance, [10.8]);

// 2. Unit tests: generateRuleSummary
const summary = generateRuleSummary(
  { title: '底部V型反弹', action_text: '触及支撑企稳加仓' },
  { ticker: 'TSLL', direction: 'bullish', hit_3d: true, hit_5d: true, confidence: 0.85 },
  lvl3
);
assert.ok(summary.includes('TSLL'));
assert.ok(summary.includes('看多做多'));
assert.ok(summary.includes('支撑位 $10, $9.8'));
assert.ok(summary.includes('3D达标'));

// 3. Unit tests: extractGoldenPlaybook gate filter
const mockResults = [
  {
    status: 'scored',
    card_id: 'c1',
    ticker: 'TSLL',
    card_type: 'pattern',
    title: 'High Win 5D',
    hit_3d: false,
    hit_5d: true,
    level: 10,
    direction: 'bullish'
  },
  {
    status: 'scored',
    card_id: 'c2',
    ticker: 'TSLL',
    card_type: 'pattern',
    title: 'High Win 3D',
    hit_3d: true,
    hit_5d: false,
    level: 10,
    direction: 'bullish'
  },
  {
    status: 'scored',
    card_id: 'c3',
    ticker: 'TSLL',
    card_type: 'pattern',
    title: 'Low Win Both',
    hit_3d: false,
    hit_5d: false,
    level: 10,
    direction: 'bullish'
  },
  {
    status: 'skipped_no_level',
    card_id: 'c4',
    ticker: 'TSLL',
    card_type: 'pattern',
    title: 'No Level'
  }
];

const purified = extractGoldenPlaybook(mockResults, { minHit5: 0.6, minHit3: 0.7 });
assert.strictEqual(purified.length, 2);
assert.strictEqual(purified[0].card_id, 'c1');
assert.strictEqual(purified[1].card_id, 'c2');
assert.strictEqual(purified[0].hit_rate_5d, 1.0);
assert.strictEqual(purified[1].hit_rate_3d, 1.0);

// 4. Contract test: data/runtime/golden_playbook.json schema and content validation
const playbookPath = path.resolve('data/runtime/golden_playbook.json');
assert.ok(fs.existsSync(playbookPath), `Missing golden_playbook.json at: ${playbookPath}`);

const raw = fs.readFileSync(playbookPath, 'utf8');
const playbook = JSON.parse(raw);
assert.ok(Array.isArray(playbook), 'golden_playbook.json must be a JSON array');
assert.ok(playbook.length >= 50, `Expected at least 50 purified golden cards, got ${playbook.length}`);

const validTypes = new Set(['pattern', 'asset_memory', 'risk_rule', 'level']);
const tickerSet = new Set(ATTR_TICKERS);

let db = null;
const dbPath = path.resolve('whop_archive.db');
if (fs.existsSync(dbPath)) {
  db = new Database(dbPath, { readonly: true });
}
const cardGet = db ? db.prepare('SELECT source_message_ids_json FROM ontology_card WHERE id = ?') : null;
const msgGet = db ? db.prepare('SELECT sender_id FROM messages WHERE id = ?') : null;

for (const card of playbook) {
  // Required fields validation
  assert.ok(typeof card.card_id === 'string' && card.card_id.length > 0, `Invalid card_id in ${JSON.stringify(card)}`);
  assert.ok(typeof card.ticker === 'string' && tickerSet.has(card.ticker), `Unknown ticker: ${card.ticker}`);
  assert.ok(validTypes.has(card.card_type), `Invalid card_type: ${card.card_type}`);
  assert.ok(typeof card.title === 'string' && card.title.length > 0, 'title must be non-empty string');
  assert.ok(card.tier === 'golden_level' || card.tier === 'golden_direction', `Invalid tier: ${card.tier}`);

  // trigger_levels validation

  assert.ok(typeof card.trigger_levels === 'object' && card.trigger_levels !== null, 'trigger_levels must be object');
  assert.ok(Array.isArray(card.trigger_levels.support), 'trigger_levels.support must be array');
  assert.ok(Array.isArray(card.trigger_levels.resistance), 'trigger_levels.resistance must be array');
  assert.ok(
    card.trigger_levels.support.length > 0 || card.trigger_levels.resistance.length > 0,
    `Card ${card.card_id} must have at least one support or resistance level`
  );

  // win rates and sample count
  assert.ok(typeof card.hit_rate_3d === 'number' && card.hit_rate_3d >= 0 && card.hit_rate_3d <= 1, 'hit_rate_3d must be 0~1');
  assert.ok(typeof card.hit_rate_5d === 'number' && card.hit_rate_5d >= 0 && card.hit_rate_5d <= 1, 'hit_rate_5d must be 0~1');
  assert.ok(typeof card.sample_count === 'number' && card.sample_count >= 1, 'sample_count must be >= 1');
  assert.ok(typeof card.rule_summary === 'string' && card.rule_summary.length > 0, 'rule_summary must be non-empty string');

  // Quality gate: hit_rate_5d >= 0.60 OR hit_rate_3d >= 0.70
  assert.ok(
    card.hit_rate_5d >= 0.6 || card.hit_rate_3d >= 0.7,
    `Card ${card.card_id} does not pass win rate gate: 5d=${card.hit_rate_5d}, 3d=${card.hit_rate_3d}`
  );

  // Big V identity absolute lock check (AGENTS §6.9)
  if (cardGet && msgGet) {
    const crow = cardGet.get(card.card_id);
    let mid = null;
    if (crow && crow.source_message_ids_json) {
      try {
        const arr = JSON.parse(crow.source_message_ids_json);
        if (Array.isArray(arr) && arr.length > 0) mid = arr[0];
      } catch {}
    }
    if (mid) {
      const row = msgGet.get(mid);
      if (row) {
        assert.strictEqual(
          row.sender_id,
          ZHAO_SENDER_ID,
          `Non-Zhao card leaked into golden playbook: ${card.card_id} sender_id=${row.sender_id}`
        );
      }
    }
  }
}

const radarPlaybook = filterRadarPlaybook(playbook);
assert.ok(radarPlaybook.length > 0 && radarPlaybook.length < playbook.length, 'Radar filter should isolate strict level subset');
assert.ok(radarPlaybook.every((c) => c.tier === 'golden_level'), 'All radar cards must be golden_level');
console.log(`  ✅ Radar filter contract PASS: ${radarPlaybook.length} golden_level cards isolated for radar weighting`);

if (db) db.close();

console.log(`  ✅ Golden Playbook contract PASS (${playbook.length} cards verified, non_zhao=0, fields intact)`);

