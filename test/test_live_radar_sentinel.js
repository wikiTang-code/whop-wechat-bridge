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
assert.strictEqual(rthSession.isPowerHour, false, '10:30 不是尾盘强平时段');
console.log(`  ✅ RTH 盘中时段校验通过: ${rthSession.description}`);

// 2. 验证尾盘黄金强平时段 (夏令时 7月周三 15:35 ET)
console.log('\n--- 2. 验证尾盘黄金强平窗口 (15:30 - 16:00 ET) ---');
const powerHourDate = new Date('2026-07-15T19:35:00Z'); // 19:35 UTC = 15:35 EDT
const powerSession = getUsMarketSession(powerHourDate);
assert.strictEqual(powerSession.isOpen, true, '尾盘应判定为开市');
assert.strictEqual(powerSession.isPowerHour, true, '15:35 必须判定为 isPowerHour');
console.log(`  ✅ 尾盘强平窗口校验通过: ${powerSession.description}`);

// 3. 验证周末休市判定 (周日 12:00 ET)
console.log('\n--- 3. 验证周末休市时段 ---');
const weekendDate = new Date('2026-07-19T16:00:00Z'); // 周日
const weekendSession = getUsMarketSession(weekendDate);
assert.strictEqual(weekendSession.isOpen, false, '周末应判定为休市');
assert.strictEqual(weekendSession.session, 'CLOSED_WEEKEND');
console.log(`  ✅ 周末休市校验通过: ${weekendSession.description}`);

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
