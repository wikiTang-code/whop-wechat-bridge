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
  projectLeveragedEtfLevels,
  TAPE_BLOCK_PATTERNS,
  evaluateTapeBlockFlow
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
assert.strictEqual(goldenRes.dimensions.d2_zhao_outlook.tier, 'golden_level');

// 5.1 验证空间偏差超出 ±3% 门禁时绝对阻断 25 分顶格加权
const oobRes = detectTapeConfluence({
  ticker: 'TSLL',
  currentPrice: 50.0, // TSLL 最高点位未及 50.0，偏差巨大 (>50%)
  dbInstance: db,
});
assert.notStrictEqual(oobRes.dimensions.d2_zhao_outlook.score, 25, '偏差超出 3% 空间门禁不应触发 25 分顶格加权');
assert.strictEqual(!!oobRes.dimensions.d2_zhao_outlook.is_golden_playbook, false, '偏差超出 3% 不应标记黄金战法');

// 5.2 验证 golden_direction 命中时严格封顶 15 分，严禁多条叠加或突破 15 分
const dirRes = detectTapeConfluence({
  ticker: 'MU',
  currentPrice: 949.13, // 命中 MU golden_direction 战法
  dbInstance: db,
});
assert.strictEqual(dirRes.dimensions.d2_zhao_outlook.score, 15, 'golden_direction 维度严格封顶 15 分，禁止顶格 25 分');
assert.strictEqual(dirRes.dimensions.d2_zhao_outlook.tier, 'golden_direction');
assert.ok(dirRes.dimensions.d2_zhao_outlook.details.includes('golden_direction'));
console.log('  ✅ 高胜率黄金战法优先加权、≤3%空间门禁与direction封顶单测完全通过');

// 6. 验证扩充后的期权大单 Block Trade / 扫盘特征库
console.log('\n--- 6. 验证期权大单 Block Trade / 扫盘特征库 (Dimension 4 Pattern Registry) ---');
assert.ok(TAPE_BLOCK_PATTERNS.INSTITUTIONAL_SWEEP, '必须存在 INSTITUTIONAL_SWEEP 模式定义');
assert.ok(TAPE_BLOCK_PATTERNS.JUMBO_BLOCK_TRADE, '必须存在 JUMBO_BLOCK_TRADE 模式定义');
assert.ok(TAPE_BLOCK_PATTERNS.POWER_HOUR_SQUEEZE, '必须存在 POWER_HOUR_SQUEEZE 模式定义');
assert.ok(TAPE_BLOCK_PATTERNS.OTM_GAMMA_BURST, '必须存在 OTM_GAMMA_BURST 模式定义');

// 6.1 测试机构激进跨所扫盘 + 价外暴量异动
const sweepEvent = {
  is_sweep: true,
  premium_usd: 850000,
  is_otm: true,
  aggressor: 'BUY',
  imbalance_ratio: 2.3,
  time_et: '15:35'
};
const evRes = evaluateTapeBlockFlow(sweepEvent);
assert.strictEqual(evRes.score, 25, '强特征叠加应满分25分');
assert.strictEqual(evRes.flow_sentiment, 'BULLISH');
assert.ok(evRes.matched_patterns.some((p) => p.id === 'INSTITUTIONAL_SWEEP'), '应识别机构扫盘');
assert.ok(evRes.matched_patterns.some((p) => p.id === 'OTM_GAMMA_BURST'), '应识别价外Gamma异动');
assert.ok(evRes.matched_patterns.some((p) => p.id === 'POWER_HOUR_SQUEEZE'), '应识别尾盘强平时空窗口');
assert.ok(evRes.matched_patterns.some((p) => p.id === 'DEPTH_LIQUIDITY_IMBALANCE'), '应识别买盘深度倾斜');

// 6.2 测试空头卖出扫盘识别
const bearSweep = {
  is_sweep: true,
  premium_usd: 1200000,
  aggressor: 'SELL',
  time_et: '10:15'
};
const bearRes = evaluateTapeBlockFlow(bearSweep);
assert.strictEqual(bearRes.flow_sentiment, 'BEARISH');
assert.ok(bearRes.matched_patterns.some((p) => p.id === 'INSTITUTIONAL_SWEEP'));
assert.ok(bearRes.matched_patterns.some((p) => p.id === 'JUMBO_BLOCK_TRADE'));

console.log('  ✅ 期权大单 Block Trade / 扫盘特征库识别精度单测完全通过');
