/**
 * @file test/test_dst_timezone.js
 * @description P1-11 / T9 单元测试：验证美东夏令时 (EDT) 与冬令时 (EST) 自动时区换算与独立性
 */

import { getEasternTimeParts, isOffMarketHours, isWeekendOrHoliday } from '../monitoring/market-calendar.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T9 测试: test_dst_timezone ---');

  // 1. 夏令时 (EDT: UTC-4) 固定时刻校验
  console.log('1. 验证 2026 年夏季典型夏令时 EDT (UTC-4)...');
  // UTC 16:00:00 -> EDT 12:00:00 (中午12点)
  const summerDate = new Date('2026-07-01T16:00:00.000Z');
  const summerParts = getEasternTimeParts(summerDate);

  assert(summerParts.etDateStr === '2026-07-01', 'summer date should be 2026-07-01');
  assert(summerParts.hour === 12, `EDT hour should be 12, got ${summerParts.hour}`);
  assert(summerParts.minute === 0, `EDT minute should be 0, got ${summerParts.minute}`);
  assert(summerParts.weekday === 'Wed', 'weekday should be Wed');
  console.log(`   ✅ 夏令时 EDT 验证成功: UTC 16:00 -> ET ${summerParts.hour}:${String(summerParts.minute).padStart(2, '0')}`);

  // 2. 冬令时 (EST: UTC-5) 固定时刻校验
  console.log('2. 验证 2026 年冬季典型冬令时 EST (UTC-5)...');
  // UTC 17:00:00 -> EST 12:00:00 (中午12点)
  const winterDate = new Date('2026-01-15T17:00:00.000Z');
  const winterParts = getEasternTimeParts(winterDate);

  assert(winterParts.etDateStr === '2026-01-15', 'winter date should be 2026-01-15');
  assert(winterParts.hour === 12, `EST hour should be 12, got ${winterParts.hour}`);
  assert(winterParts.minute === 0, `EST minute should be 0, got ${winterParts.minute}`);
  assert(winterParts.weekday === 'Thu', 'weekday should be Thu');
  console.log(`   ✅ 冬令时 EST 验证成功: UTC 17:00 -> ET ${winterParts.hour}:${String(winterParts.minute).padStart(2, '0')}`);

  // 3. 交易时段边界 (09:30 ~ 16:00 ET) 判定验证
  console.log('3. 验证夏冬令时下的常规盘交易区间判定...');
  // 夏令时盘中 (UTC 14:00 -> EDT 10:00): 应处于交易盘中 (isOffMarketHours = false)
  const tradingSummer = new Date('2026-07-01T14:00:00.000Z');
  assert(isOffMarketHours(tradingSummer) === false, 'summer 10:00 ET should be trading hours');

  // 冬令时盘中 (UTC 15:00 -> EST 10:00): 应处于交易盘中 (isOffMarketHours = false)
  const tradingWinter = new Date('2026-01-15T15:00:00.000Z');
  assert(isOffMarketHours(tradingWinter) === false, 'winter 10:00 ET should be trading hours');

  console.log('   ✅ 常规盘时段判定在夏令时与冬令时下均精准命中！');

  console.log('\n🎉 ALL T9 TESTS PASSED: test_dst_timezone\n');
}

run().catch(err => {
  console.error('❌ T9 测试失败:', err);
  process.exit(1);
});
