/**
 * test/test_live_radar_sentinel.js
 * 单元测试：美股交易时段感知与在线雷达哨兵守护测试
 */

import assert from 'assert';
import { getUsMarketSession, getEasternTimeParts } from '../tools/knowledge/market_session.js';
import { getDb, ensureRadarEventsTable } from '../database.js';

console.log('===========================================================');
console.log('🧪 [Test Market Session] 美股时段感知与在线雷达哨兵测试');
console.log('===========================================================\n');

// 1. 验证常规工作日盘中时段判定 (夏令时 7月周三 10:30 ET)
console.log('--- 1. 验证工作日 RTH 常规盘中时段 ---');
const rthDate = new Date('2026-07-15T14:30:00Z'); // 14:30 UTC = 10:30 EDT
const rthSession = getUsMarketSession(rthDate);
assert.strictEqual(rthSession.isOpen, true, '盘中应判定为开市');
assert.strictEqual(rthSession.isRth, true, '应判定为常规交易时段 RTH');
console.log(`  ✅ RTH 盘中时段校验通过: ${rthSession.description}`);

// 1b. 验证开盘首小时回踩捡漏黄金时段 (夏令时 7月周三 09:45 ET)
console.log('\n--- 1b. 验证早盘回踩捡漏黄金窗口 (09:30 - 10:30 ET) ---');
const openingDate = new Date('2026-07-15T13:45:00Z'); // 13:45 UTC = 09:45 EDT
const openingSession = getUsMarketSession(openingDate);
assert.strictEqual(openingSession.isOpen, true, '早盘回踩应判定为开市');
assert.strictEqual(openingSession.session, 'REGULAR_OPENING_HOUR');
assert.strictEqual(openingSession.isOpeningHour, true, '09:45 必须判定为 isOpeningHour');
console.log(`  ✅ 早盘回踩黄金窗口校验通过: ${openingSession.description}`);

// 2. 验证尾盘强平扫单时段 (夏令时 7月周三 15:15 ET，属于盘中最后一个小时 15:00 - 16:00 ET)
console.log('\n--- 2. 验证盘中最后一个小时尾盘强平窗口 (15:00 - 16:00 ET) ---');
const powerHourDate = new Date('2026-07-15T19:15:00Z'); // 19:15 UTC = 15:15 EDT
const powerSession = getUsMarketSession(powerHourDate);
assert.strictEqual(powerSession.isOpen, true, '尾盘应判定为开市');
assert.strictEqual(powerSession.session, 'REGULAR_POWER_HOUR');
assert.strictEqual(powerSession.isPowerHour, true, '15:15 必须判定为 isPowerHour (三点到四点)');
console.log(`  ✅ 尾盘强平窗口校验通过: ${powerSession.description}`);

// 3. 验证周末休市判定 (周日 12:00 ET)
console.log('\n--- 3. 验证周末休市时段 ---');
const weekendDate = new Date('2026-07-19T16:00:00Z'); // 周日 12:00 EDT
const weekendSession = getUsMarketSession(weekendDate);
assert.strictEqual(weekendSession.isOpen, false, '周末白天应判定为休市');
assert.strictEqual(weekendSession.session, 'CLOSED_WEEKEND');
console.log(`  ✅ 周末休市校验通过: ${weekendSession.description}`);

// 3b. 验证美股工作日全时段覆盖: 盘前、盘后、工作日夜盘与周日夜盘
console.log('\n--- 3b. 验证美股全时段覆盖 (盘前/盘后/夜盘/周日夜盘) ---');
// 盘前 07:30 EDT (11:30 UTC)
const preDate = new Date('2026-07-15T11:30:00Z');
const preSession = getUsMarketSession(preDate);
assert.strictEqual(preSession.isOpen, true, '盘前应判定为开市持续监测');
assert.strictEqual(preSession.session, 'PRE_MARKET');
assert.strictEqual(preSession.isPreMarket, true);
console.log(`  ✅ 盘前交易时段校验通过: ${preSession.description}`);

// 盘后 17:30 EDT (21:30 UTC)
const postDate = new Date('2026-07-15T21:30:00Z');
const postSession = getUsMarketSession(postDate);
assert.strictEqual(postSession.isOpen, true, '盘后应判定为开市持续监测');
assert.strictEqual(postSession.session, 'POST_MARKET');
assert.strictEqual(postSession.isPostMarket, true);
console.log(`  ✅ 盘后交易时段校验通过: ${postSession.description}`);

// 工作日夜盘 22:30 EDT (次日 02:30 UTC)
const overnightDate = new Date('2026-07-16T02:30:00Z');
const overnightSession = getUsMarketSession(overnightDate);
assert.strictEqual(overnightSession.isOpen, true, '工作日夜盘应判定为开市持续监测');
assert.strictEqual(overnightSession.session, 'OVERNIGHT_TRADING');
assert.strictEqual(overnightSession.isOvernight, true);
console.log(`  ✅ 工作日夜盘交易时段校验通过: ${overnightSession.description}`);

// 周日夜盘 21:30 EDT (周一 01:30 UTC)
const sundayOvernightDate = new Date('2026-07-20T01:30:00Z');
const sundayOvernightSession = getUsMarketSession(sundayOvernightDate);
assert.strictEqual(sundayOvernightSession.isOpen, true, '周日夜盘应开启持续监测');
assert.strictEqual(sundayOvernightSession.session, 'OVERNIGHT_TRADING');
console.log(`  ✅ 周日夜盘开启校验通过: ${sundayOvernightSession.description}`);

// 3c. 验证动态轮询间隔 (盘中首尾两小时均为 15 秒高频)
import { getRecommendedPollIntervalMs } from '../tools/knowledge/market_session.js';
assert.strictEqual(getRecommendedPollIntervalMs(openingSession), 15000, '盘中第一个小时 (09:30-10:30) 应为 15 秒极速高频');
assert.strictEqual(getRecommendedPollIntervalMs(powerSession), 15000, '盘中最后一个小时 (15:00-16:00) 应为 15 秒极速高频');
assert.strictEqual(getRecommendedPollIntervalMs(rthSession), 30000, '盘中常规时段 (10:30-15:00) 应为 30 秒');
assert.strictEqual(getRecommendedPollIntervalMs(preSession), 45000, '盘前应为 45 秒');
assert.strictEqual(getRecommendedPollIntervalMs(postSession), 45000, '盘后应为 45 秒');
assert.strictEqual(getRecommendedPollIntervalMs(overnightSession), 60000, '夜盘应为 60 秒');
assert.strictEqual(getRecommendedPollIntervalMs(weekendSession), 15 * 60 * 1000, '周末休市应为 15 分钟');
console.log('  ✅ 动态时段巡检调频算法全部校验通过');

// 4. 验证雷达事件表结构
console.log('\n--- 4. 验证 confluence_radar_events 表创建与读写 ---');
const db = getDb();
ensureRadarEventsTable(db);

const testEventId = `radar_test_${Date.now()}`;
db.prepare(`
  INSERT INTO confluence_radar_events (
    id, ticker, current_price, confluence_score, confluence_level,
    dimensions_json, observations_json, leveraged_etf_json, created_at
  ) VALUES (
    ?, 'TSLA', 365.0, 85, 'WANGZHA_CONFLUENCE',
    '{}', '["测试四维共振"]', '{"etf":"TSLL"}', ?
  )
`).run(testEventId, Date.now());

const readBack = db.prepare('SELECT * FROM confluence_radar_events WHERE id = ?').get(testEventId);
assert.strictEqual(readBack.ticker, 'TSLA');
assert.strictEqual(readBack.confluence_score, 85);
assert.strictEqual(readBack.confluence_level, 'WANGZHA_CONFLUENCE');
console.log('  ✅ 雷达事件落库与读取验证通过');

// 清理测试脏数据
db.prepare('DELETE FROM confluence_radar_events WHERE id = ?').run(testEventId);

console.log('\n===========================================================');
console.log('🎉 美股时段感知与在线雷达哨兵测试全部 PASS！');
console.log('===========================================================');
