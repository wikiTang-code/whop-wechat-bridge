/**
 * test/test_resonance_radar_req038_t3.js
 * REQ-038-T3: 三点共振只读雷达算法与安全门禁单测
 */

import assert from 'node:assert';
import {
  computeResonanceRadar,
  calculateDecayWeight,
  calculateProximityScore,
  extractCardLevels,
  RADAR_DISCLAIMER,
} from '../tools/knowledge/resonance_radar_engine.js';

console.log('===========================================================');
console.log('🧪 启动 REQ-038-T3 三点共振只读雷达核心算法与门禁单测');
console.log('===========================================================');

const nowMs = 1726750000000; // 模拟当前时刻 (2026-09-19)

// --- 测试 1: 阻力位共振与溯源契约 ---
console.log('\n--- 1. 验证 Call Wall 与大V阻力位共振 ---');
const mockCards = [
  {
    id: 'card_tsla_res_1',
    ticker: 'TSLA',
    created_at: nowMs - 2 * 86400 * 1000, // 2天前发表
    trigger_text: '上方重要阻力位在230附近，压力较大',
    support_resistance_json: JSON.stringify({
      support: [215],
      resistance: [230.5],
    }),
  },
  {
    id: 'card_tsla_sup_1',
    ticker: 'TSLA',
    created_at: nowMs - 5 * 86400 * 1000, // 5天前发表
    trigger_text: '回踩210是强支撑，企稳观察',
    support_resistance_json: JSON.stringify({
      support: [210.0],
      resistance: [225.0],
    }),
  },
];

const mockGex = {
  regime: 'positive_gamma',
  call_wall: 230.0,
  put_wall: 210.0,
  zero_gamma: 220.0,
};

const radarRes = computeResonanceRadar({
  ticker: 'TSLA',
  currentPrice: 224.5,
  gexSummary: mockGex,
  cards: mockCards,
  options: { nowMs },
});

assert.strictEqual(radarRes.ticker, 'TSLA');
assert.strictEqual(radarRes.gex_available, true);
assert.strictEqual(radarRes.cards_available, true);
assert.ok(radarRes.resonance_zones.length >= 2, 'Should detect at least 2 resonance zones');

// 验证阻力共振
const resZone = radarRes.resonance_zones.find((z) => z.zone_type === 'resistance_confluence');
assert.ok(resZone, 'Must find resistance_confluence');
assert.strictEqual(resZone.price_center, 230.0);
assert.strictEqual(resZone.sources.ontology_cards[0].card_id, 'card_tsla_res_1');
assert.ok(resZone.resonance_score >= 0.7, 'Recent card near wall should have high score');
console.log(`  ✅ 阻力位共振通过: Score=${resZone.resonance_score}, CardID=${resZone.sources.ontology_cards[0].card_id}`);

// 验证支撑共振
const supZone = radarRes.resonance_zones.find((z) => z.zone_type === 'support_confluence');
assert.ok(supZone, 'Must find support_confluence');
assert.strictEqual(supZone.price_center, 210.0);
assert.strictEqual(supZone.sources.ontology_cards[0].card_id, 'card_tsla_sup_1');
console.log(`  ✅ 支撑位共振通过: Score=${supZone.resonance_score}, CardID=${supZone.sources.ontology_cards[0].card_id}`);

// --- 测试 2: 半衰期时间衰减 ---
console.log('\n--- 2. 验证观点时效半衰衰减特性 ---');
const freshWeight = calculateDecayWeight(nowMs, nowMs, 30);
const oldWeight = calculateDecayWeight(nowMs - 60 * 86400 * 1000, nowMs, 30); // 60天前 (2个半衰期)
assert.strictEqual(freshWeight, 1.0, 'Fresh card weight should be 1.0');
assert.ok(Math.abs(oldWeight - 0.25) < 0.01, `Old card weight should be ~0.25, got ${oldWeight}`);
console.log(`  ✅ 半衰衰减通过: 0天权重=${freshWeight}, 60天权重=${oldWeight.toFixed(3)}`);

// --- 测试 3: 降级防御 (缺失 GEX 或盘口价时不捏造共振) ---
console.log('\n--- 3. 验证无盘口/无 GEX 优雅降级 ---');
const noGexRes = computeResonanceRadar({
  ticker: 'TSLA',
  currentPrice: 224.5,
  gexSummary: null,
  cards: mockCards,
  options: { nowMs },
});
assert.strictEqual(noGexRes.gex_available, false);
assert.strictEqual(noGexRes.resonance_zones.length, 0);

const noPriceRes = computeResonanceRadar({
  ticker: 'TSLA',
  currentPrice: null,
  gexSummary: mockGex,
  cards: mockCards,
  options: { nowMs },
});
assert.strictEqual(noPriceRes.current_price, null);
assert.strictEqual(noPriceRes.resonance_zones.length, 0);
console.log('  ✅ 降级防御通过: 数据不全时不捏造虚假共振');

// --- 测试 4: 安全红线与强制免责声明审计 ---
console.log('\n--- 4. 验证只读安全红线与强制免责声明 ---');
assert.strictEqual(radarRes.disclaimer, RADAR_DISCLAIMER);
assert.strictEqual(radarRes.safety_audit.has_buy_sell_signals, false);
assert.strictEqual(radarRes.safety_audit.is_l2a_eligible, false);
assert.strictEqual(radarRes.safety_audit.inspection_passed, true);

// 序列化后全文严查 BUY/SELL
const rawJson = JSON.stringify(radarRes);
assert.ok(!/\b(BUY|STRONG_BUY|SELL|STRONG_SELL)\b/i.test(rawJson), 'Output must not contain trading directives');
console.log('  ✅ 安全红线通过: 零交易信号、严禁L2a、强制合规免责声明');

console.log('\n===========================================================');
console.log('🎉 REQ-038-T3 三点共振只读雷达引擎所有测试通过！');
console.log('===========================================================');
