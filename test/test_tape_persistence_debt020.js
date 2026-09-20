import assert from 'assert';
import Database from 'better-sqlite3';
import {
  initTapeBlockTable,
  persistTapeBlockEvent,
  queryRecentTapeBlocks
} from '../tools/knowledge/tape_confluence_detector.js';

console.log('🧪 [Test DEBT-020] 微观盘口超级大单持久化归档引擎单测');

// 1. 初始化内存数据库
const db = new Database(':memory:');
initTapeBlockTable(db);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
assert(tables.includes('tape_block_events'), 'tape_block_events 表结构必须存在');
console.log('  ✅ 1. 表结构与索引创建验证通过');

// 2. 写入高频机构扫盘与大宗交易单
const sampleEvent1 = {
  id: 'tape_test_tsla_001',
  ticker: 'TSLA',
  event_time: 1789785000000,
  time_et: '15:45:00',
  price: 240.5,
  size: 5000,
  premium_usd: 1202500,
  sentiment: 'BULLISH_SWEEP',
  pattern: 'INSTITUTIONAL_SWEEP',
  source: 'realtime_longbridge',
  raw_json: JSON.stringify({ note: '跨所连续吃单' })
};

const res1 = persistTapeBlockEvent(db, sampleEvent1);
assert.strictEqual(res1.ok, true, '单据写入必须成功');
assert.strictEqual(res1.changes, 1, '新增记录数应为 1');

const row1 = db.prepare('SELECT * FROM tape_block_events WHERE id = ?').get('tape_test_tsla_001');
assert.strictEqual(row1.ticker, 'TSLA');
assert.strictEqual(row1.premium_usd, 1202500);
assert.strictEqual(row1.pattern, 'INSTITUTIONAL_SWEEP');
assert.strictEqual(row1.sentiment, 'BULLISH_SWEEP');
console.log('  ✅ 2. 机构大单结构化落盘验证通过');

// 3. 幂等去重测试 (重复插入相同 ID)
const resDuplicate = persistTapeBlockEvent(db, sampleEvent1);
assert.strictEqual(resDuplicate.ok, true, '幂等写入必须返回 ok');
assert.strictEqual(resDuplicate.changes, 0, '重复写入 changes 必须为 0');
const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM tape_block_events').get().cnt;
assert.strictEqual(totalCount, 1, '去重后总数依然为 1');
console.log('  ✅ 3. 幂等防重写入校验通过');

// 4. 多标的与时间倒序查询验证
const sampleEvent2 = {
  id: 'tape_test_tsla_002',
  ticker: 'TSLA',
  event_time: 1789785300000,
  time_et: '15:50:00',
  price: 241.2,
  size: 3000,
  premium_usd: 723600,
  sentiment: 'BULL_GAMMA_BURST',
  pattern: 'OTM_GAMMA_BURST'
};

const sampleEvent3 = {
  id: 'tape_test_nvda_001',
  ticker: 'NVDA',
  event_time: 1789785400000,
  price: 118.5,
  premium_usd: 2500000,
  pattern: 'JUMBO_BLOCK_TRADE'
};

persistTapeBlockEvent(db, sampleEvent2);
persistTapeBlockEvent(db, sampleEvent3);

const tslaBlocks = queryRecentTapeBlocks(db, 'TSLA', 10);
assert.strictEqual(tslaBlocks.length, 2, 'TSLA 应包含 2 笔记录');
assert.strictEqual(tslaBlocks[0].id, 'tape_test_tsla_002', '最新时间戳的事件应排在第一位');

const nvdaBlocks = queryRecentTapeBlocks(db, 'NVDA', 10);
assert.strictEqual(nvdaBlocks.length, 1, 'NVDA 应包含 1 笔记录');
assert.strictEqual(nvdaBlocks[0].pattern, 'JUMBO_BLOCK_TRADE');
console.log('  ✅ 4. 多标的与时间倒序检索验证通过');

// 5. 参数容错验证
const invalidRes = persistTapeBlockEvent(db, null);
assert.strictEqual(invalidRes.ok, false, '空参数必须返回错误');
console.log('  ✅ 5. 参数异常容错检查通过');

db.close();
console.log('🎉 [Test DEBT-020] 微观盘口超级大单持久化归档引擎单测全部 PASS！\n');
