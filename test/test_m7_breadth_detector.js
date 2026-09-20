/**
 * test/test_m7_breadth_detector.js
 * 单元测试：美股科技七姐妹 (M7) 开盘广度与赵哥单边下跌战法模式测试
 */

import assert from 'assert';
import { evaluateM7Breadth, MAGNIFICENT_SEVEN, ZHAO_M7_PLAYBOOK_EVIDENCE } from '../tools/knowledge/m7_breadth_detector.js';

console.log('===========================================================');
console.log('🧪 [Test M7 Breadth] 七姐妹盘口广度与单边下跌战法模式测试');
console.log('===========================================================\n');

// 1. 验证开盘首小时七姐妹普跌触发单边下跌模式 (赵哥经典战法)
console.log('--- 1. 验证开盘首小时 M7 普跌触发单边下跌形态 ---');
const sampleDownQuotes = [
  { ticker: 'NVDA', last_price: 118.0, prev_close: 120.0, change_pct: -1.67 },
  { ticker: 'TSLA', last_price: 240.0, prev_close: 245.0, change_pct: -2.04 },
  { ticker: 'AAPL', last_price: 225.0, prev_close: 228.0, change_pct: -1.32 },
  { ticker: 'MSFT', last_price: 430.0, prev_close: 435.0, change_pct: -1.15 },
  { ticker: 'GOOGL', last_price: 160.0, prev_close: 162.0, change_pct: -1.23 },
  { ticker: 'AMZN', last_price: 185.0, prev_close: 183.0, change_pct: 1.09 }, // 仅 AMZN 红
  { ticker: 'META', last_price: 520.0, prev_close: 525.0, change_pct: -0.95 },
];

const resOpeningDown = evaluateM7Breadth(sampleDownQuotes, {
  marketSession: { isOpeningHour: true, isPowerHour: false },
});

assert.strictEqual(resOpeningDown.is_unilateral_downtrend, true, '6 支下跌应判定为单边下跌');
assert.strictEqual(resOpeningDown.down_count, 6);
assert.strictEqual(resOpeningDown.regime, 'UNILATERAL_DOWNTREND');
assert(resOpeningDown.playbook_advice.includes('早盘严禁接飞刀'), '应包含赵哥早盘禁抄底战法警告');
assert.strictEqual(ZHAO_M7_PLAYBOOK_EVIDENCE.post_id, 'post_1CVX4DWL2PiXoXG51a4vES');
console.log(`  ✅ 单边下跌战法触发成功: 跌幅 ${resOpeningDown.down_count}/7 | 建议: ${resOpeningDown.playbook_advice}`);

// 2. 验证单边下跌至尾盘三点到四点 (15:00-16:00 ET) 触发低吸买点
console.log('\n--- 2. 验证尾盘三点强平时段触发收盘买入捡漏指引 ---');
const resPowerHourBuy = evaluateM7Breadth(sampleDownQuotes, {
  marketSession: { isOpeningHour: false, isPowerHour: true },
});
assert.strictEqual(resPowerHourBuy.is_unilateral_downtrend, true);
assert(resPowerHourBuy.playbook_advice.includes('尾盘黄金买点触发'), '应包含尾盘买入捡漏指引');
assert(resPowerHourBuy.playbook_advice.includes('夜盘量化反弹出'), '应包含赵哥夜盘反弹出战法');
console.log(`  ✅ 尾盘低吸买点触发成功: ${resPowerHourBuy.playbook_advice}`);

// 3. 验证七姐妹多数上涨时的多头格局 (TECH_RALLY)
console.log('\n--- 3. 验证七姐妹多数上涨 (TECH_RALLY) ---');
const sampleUpQuotes = [
  { ticker: 'NVDA', last_price: 122.0, prev_close: 120.0, change_pct: 1.67 },
  { ticker: 'TSLA', last_price: 250.0, prev_close: 245.0, change_pct: 2.04 },
  { ticker: 'AAPL', last_price: 230.0, prev_close: 228.0, change_pct: 0.88 },
  { ticker: 'MSFT', last_price: 440.0, prev_close: 435.0, change_pct: 1.15 },
  { ticker: 'GOOGL', last_price: 165.0, prev_close: 162.0, change_pct: 1.85 },
  { ticker: 'AMZN', last_price: 185.0, prev_close: 183.0, change_pct: 1.09 },
  { ticker: 'META', last_price: 520.0, prev_close: 525.0, change_pct: -0.95 },
];
const resTechRally = evaluateM7Breadth(sampleUpQuotes);
assert.strictEqual(resTechRally.is_unilateral_downtrend, false);
assert.strictEqual(resTechRally.regime, 'TECH_RALLY');
console.log(`  ✅ 科技巨头多头格局校验通过: 涨 ${resTechRally.up_count}/7 (平均: ${resTechRally.avg_change_pct}%)`);

console.log('\n===========================================================');
console.log('🎉 七姐妹盘口广度与单边下跌战法模式单测全部 PASS！');
console.log('===========================================================');
