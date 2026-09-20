/**
 * test/test_tape_confluence_detector_req041.js
 * 验证 REQ-041 盘口微观大单与四维共振检测引擎
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  detectTapeConfluence,
  getSector,
  TAPE_DISCLAIMER,
  SECTOR_MAP,
} from '../tools/knowledge/tape_confluence_detector.js';

console.log('===========================================================');
console.log('🧪 [Test REQ-041] 盘口大单与四维共振引擎单测套件');
console.log('===========================================================');

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ontology_card (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      trigger_text TEXT,
      action_text TEXT,
      schema_json TEXT,
      support_resistance_json TEXT,
      tickers_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trade_signals (
      signal_id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      channel_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

// 1. 板块映射检查
console.log('--- 1. 验证板块归属 ---');
assert.strictEqual(getSector('CRWV'), 'CLOUD');
assert.strictEqual(getSector('LITE'), 'OPTICS');
assert.strictEqual(getSector('MU'), 'MEMORY');
assert.strictEqual(getSector('TSLA'), 'FLAGSHIP');
assert.strictEqual(getSector('TSLL'), 'FLAGSHIP');
console.log('  ✅ 板块分类检查通过');

// 2. 纯只读与安全红线检查
console.log('\n--- 2. 验证安全审计与纯只读红线 ---');
const db = setupTestDb();
const res = detectTapeConfluence({
  ticker: 'TSLA',
  currentPrice: 220,
  dbInstance: db,
});
assert.strictEqual(res.safety_audit.has_buy_sell_orders, false);
assert.strictEqual(res.safety_audit.is_l2a_eligible, false);
assert.ok(res.disclaimer.includes('绝非投资建议'));
console.log('  ✅ 纯只读安全红线检查通过');

// 3. 维度共振逻辑与打分判定
console.log('\n--- 3. 验证多维共振打分 ---');
db.prepare(`
  INSERT INTO ontology_card (id, title, schema_json, tickers_json, created_at)
  VALUES ('card_test_tsla', 'TSLA 强支撑', '{"support_resistance":{"support":[220],"resistance":[235]}}', '["TSLA"]', 1789400000000)
`).run();

db.prepare(`
  INSERT INTO trade_signals (signal_id, ticker, action, price, quantity, channel_id, created_at)
  VALUES ('sig_test_1', 'TSLA', 'BUY', 220.0, 100, 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN', 1789400000000)
`).run();

const mockGex = {
  zero_dte: {
    TSLA: { king: { strike: 220 }, floor: { strike: 235 } },
    SPY: { king: { strike: 760 } },
  },
};

const mockTape = {
  block_buy_usd: 3500000,
  is_sweep: true,
  retail_panic: true,
  time_et: '15:40',
};

const fullRes = detectTapeConfluence({
  ticker: 'TSLA',
  currentPrice: 220,
  tapeEvent: mockTape,
  gexSnapshot: mockGex,
  dbInstance: db,
});

console.log('  - TSLA 共振总分:', fullRes.total_confluence_score);
assert.ok(fullRes.total_confluence_score >= 80, '四维高度吻合时应达到 80+');
assert.strictEqual(fullRes.confluence_level, 'WANGZHA_CONFLUENCE');
assert.strictEqual(fullRes.dimensions.d1_gex_structure.score, 25);
assert.strictEqual(fullRes.dimensions.d2_zhao_outlook.score, 25);
assert.strictEqual(fullRes.dimensions.d3_trade_signals_proof.score, 25);
assert.strictEqual(fullRes.dimensions.d4_tape_block_flow.score, 25);
console.log('  ✅ 四维王炸共振打分与判定检查完全通过');

// 4. 验证正股折算 2x 做多杠杆 ETF (TSLA -> TSLL, LITE -> LITX, etc.)
console.log('\n--- 4. 验证正股折算 2倍做多杠杆 ETF 点位 ---');
assert.ok(fullRes.leveraged_etf_projection, 'TSLA 应自动挂载 TSLL 杠杆折算投影');
assert.strictEqual(fullRes.leveraged_etf_projection.etf, 'TSLL');
assert.strictEqual(fullRes.leveraged_etf_projection.leverage, 2);

import { projectLeveragedEtfLevels } from '../tools/knowledge/tape_confluence_detector.js';
// 正股 TSLA 现价 200，支撑 190 (-5%)，阻力 220 (+10%)
// TSLL 现价 10.0，折算 2x 后: 支撑应为 10 * (1 - 10%) = 9.0，阻力应为 10 * (1 + 20%) = 12.0
const projected = projectLeveragedEtfLevels('TSLA', { support: [190], resistance: [220] }, 200, 10.0);
assert.strictEqual(projected.etf, 'TSLL');
assert.strictEqual(projected.projected_support[0], 9.0);
// 5. 验证高胜率黄金战法 (Golden Playbook) 优先加权
console.log('\n--- 5. 验证高胜率黄金战法 (Golden Playbook) 优先加权 ---');
// golden_playbook.json 中有 TSLL 18.39 支撑位
const goldenRes = detectTapeConfluence({
  ticker: 'TSLL',
  currentPrice: 18.39,
  dbInstance: db,
});
assert.strictEqual(goldenRes.dimensions.d2_zhao_outlook.score, 25, '命中黄金战法应顶格满分');
assert.strictEqual(goldenRes.dimensions.d2_zhao_outlook.is_golden_playbook, true, '应标记 is_golden_playbook=true');
assert.ok(goldenRes.dimensions.d2_zhao_outlook.golden_stats, '应附带黄金战法胜率统计');
assert.ok(goldenRes.dimensions.d2_zhao_outlook.details.includes('高胜率黄金战法认证'), '详情应包含认证字样');
console.log('  ✅ 高胜率黄金战法优先加权单测完全通过');
