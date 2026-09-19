/**
 * REQ-038-T2: TSLA/TSLL subset attribution unit tests (fixture bars, no network)
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  extractExplicitLevel,
  inferDirection,
  evaluateCard,
  scoreCardAgainstBars,
  summarize,
  saveAttributionRow,
  ensureAttributionTable,
  confidenceFromRet
} from '../tools/knowledge/card_attribution.js';
import { ensureOntologyCardTable, saveOntologyCard } from '../database.js';

console.log('🧪 [REQ-038-T2] card attribution');

assert.strictEqual(extractExplicitLevel('回踩 $247.5 支撑再看加仓', 'TSLA'), 247.5);
assert.strictEqual(extractExplicitLevel('30分钟级别喇叭口', 'TSLA'), null);
assert.ok(extractExplicitLevel('TSLL 止损 12.5', 'TSLL') === 12.5);

assert.strictEqual(
  inferDirection({ card_type: 'pattern', trigger_text: '回踩支撑加仓', tickers_json: '["TSLA"]' }),
  'bullish'
);
assert.strictEqual(
  inferDirection({ card_type: 'risk_rule', trigger_text: '跌破无条件止损降仓', tickers_json: '["TSLA"]' }),
  'bearish'
);
assert.strictEqual(
  inferDirection({
    card_type: 'pattern',
    trigger_text: '突破加仓但跌破止损',
    tickers_json: '["TSLA"]'
  }),
  'mixed'
);

const bars = [
  { date: '2026-01-02', high: 101, low: 99, close: 100, adjClose: 100 },
  { date: '2026-01-05', high: 102, low: 100, close: 101, adjClose: 101 },
  { date: '2026-01-06', high: 104, low: 101, close: 103, adjClose: 103 }, // entry (t0=01-05)
  { date: '2026-01-07', high: 106, low: 102, close: 105, adjClose: 105 },
  { date: '2026-01-08', high: 107, low: 103, close: 104, adjClose: 104 },
  { date: '2026-01-09', high: 110, low: 104, close: 109, adjClose: 109 },
  { date: '2026-01-12', high: 111, low: 108, close: 110, adjClose: 110 },
  { date: '2026-01-13', high: 112, low: 109, close: 111, adjClose: 111 }
];

const scored = scoreCardAgainstBars({ direction: 'bullish', t0Date: '2026-01-05', bars });
assert.strictEqual(scored.status, 'scored');
assert.strictEqual(scored.entry_date, '2026-01-06');
assert.ok(scored.close_ret_5d > 0);
assert.strictEqual(scored.hit_5d, true);
assert.ok(scored.confidence >= 0.55);

const eventBars = bars.map((b, i) =>
  i === 2 ? { ...b, close: 130, adjClose: 130, high: 131, low: 120 } : b
);
const excluded = scoreCardAgainstBars({ direction: 'bullish', t0Date: '2026-01-05', bars: eventBars });
assert.strictEqual(excluded.status, 'excluded_event');

const t0 = Date.parse('2026-01-05T18:00:00-05:00');
const card = {
  id: 'ocard_test_1',
  card_type: 'pattern',
  title: 'TSLA 回踩',
  trigger_text: '回踩 $247 支撑再加仓',
  tickers_json: '["TSLA"]',
  schema_json: '{}'
};
const ev = evaluateCard(card, { messageCreatedAt: t0, bars });
assert.strictEqual(ev.status, 'scored');
assert.strictEqual(ev.ticker, 'TSLA');
assert.strictEqual(ev.direction, 'bullish');
assert.strictEqual(ev.level, 247);

const mixed = evaluateCard(
  { ...card, trigger_text: '突破加仓且跌破止损 $247' },
  { messageCreatedAt: t0, bars }
);
assert.strictEqual(mixed.status, 'unscored_mixed');

const noT0 = evaluateCard(card, { bars });
assert.strictEqual(noT0.status, 'skipped_no_t0');

const summary = summarize([ev, { status: 'skipped_no_level' }, { ...ev, hit_5d: false, status: 'scored' }]);
assert.strictEqual(summary.n_scored, 2);
assert.ok(summary.hit_rate_5d > 0 && summary.hit_rate_5d < 1);

const db = new Database(':memory:');
ensureOntologyCardTable(db);
ensureAttributionTable(db);
saveOntologyCard(
  {
    id: 'ocard_test_1',
    card_type: 'pattern',
    title: 'TSLA 回踩',
    trigger_text: '回踩 $247 支撑再加仓',
    tickers: ['TSLA'],
    source_message_ids: ['m1']
  },
  db
);
saveAttributionRow(db, 'ocard_test_1', ev);
const row = db.prepare('SELECT * FROM ontology_card_attribution WHERE card_id = ?').get('ocard_test_1');
assert.strictEqual(row.status, 'scored');
assert.strictEqual(row.ticker, 'TSLA');

assert.ok(confidenceFromRet(true, 0.1) > confidenceFromRet(false, 0.1));

const fromSrc = evaluateCard(
  {
    card_type: 'pattern',
    title: '波段形态卡',
    trigger_text: '回踩关键技术支撑位',
    tickers_json: '["TSLA"]',
    source_text: 'TSLA 回踩 $247 支撑再看加仓'
  },
  { messageCreatedAt: t0, bars }
);
assert.strictEqual(fromSrc.status, 'scored');
assert.strictEqual(fromSrc.level, 247);

const hitch = evaluateCard(
  {
    card_type: 'asset_memory',
    title: 'NVDL 标的机构行为与股性特征画像',
    trigger_text: '回踩支撑加仓',
    tickers_json: '["NVDL","TSLL"]',
    source_text: 'NVDL 机构盘'
  },
  { messageCreatedAt: t0, bars }
);
assert.strictEqual(hitch.status, 'skipped_ticker');

const tsllBars = bars.map((b) => ({
  ...b,
  high: 20,
  low: 17,
  close: 19,
  adjClose: 19
}));
const mismatch = evaluateCard(
  {
    card_type: 'risk_rule',
    title: 'TSLL 止损纪律',
    trigger_text: '止损 96 降仓',
    tickers_json: '["TSLL"]',
    source_text: 'TSLL 止损 96'
  },
  { messageCreatedAt: t0, bars: tsllBars }
);
assert.strictEqual(mismatch.status, 'skipped_level_mismatch');
assert.strictEqual(mismatch.level, 96);

const fromVl = evaluateCard(
  {
    card_type: 'pattern',
    title: 'TSLA 形态卡',
    trigger_text: '回踩关键支撑再加仓',
    tickers_json: '["TSLA"]'
  },
  {
    messageCreatedAt: t0,
    bars,
    visionMeta: { support_resistance_json: JSON.stringify({ support: [247], resistance: [260] }) }
  }
);
assert.strictEqual(fromVl.status, 'scored');
assert.strictEqual(fromVl.level, 247);

console.log('  ✅ level/direction/windows/event-exclude/db isolation/source_text/ticker-gate PASS');
