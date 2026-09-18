/**
 * test/test_batch_distill_req037.js
 * 单元测试：大批次策略本体卡片知识蒸馏流水线 (REQ-037 Phase 3)
 */

import Database from 'better-sqlite3';
import { runBatchDistill } from '../tools/knowledge/batch_distill_pipeline.js';
import { ensureOntologyCardTable } from '../database.js';

console.log('===========================================================');
console.log('🧪 启动 REQ-037 Phase 3 大批次策略本体知识蒸馏单测');
console.log('===========================================================\n');

// 创建内存测试数据库
const testDb = new Database(':memory:');
ensureOntologyCardTable(testDb);

// 准备测试 messages 表
testDb.prepare(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    content TEXT,
    tickers TEXT,
    created_at INTEGER,
    sender_name TEXT,
    channel_id TEXT
  )
`).run();

// 插入模拟策略消息
const sampleMessages = [
  {
    id: 'msg_001',
    content: 'NVDA 跌破118无条件止损砍仓，底仓不盲动！',
    tickers: 'NVDA',
    created_at: 1000,
    sender_name: 'zhao',
    channel_id: 'ch_trade'
  },
  {
    id: 'msg_002',
    content: 'QQQ 突破箱体缺口回踩不破加仓做T，看30分钟结构。',
    tickers: 'QQQ',
    created_at: 2000,
    sender_name: 'zhao',
    channel_id: 'ch_trade'
  },
  {
    id: 'msg_003',
    content: '美联储鲍威尔讲话暗示降息节奏放缓，美元流动性总闸门收紧。',
    tickers: 'SPY,QQQ',
    created_at: 3000,
    sender_name: 'zhao',
    channel_id: 'ch_macro'
  },
  {
    id: 'msg_004',
    content: 'TSLA 股性非常妖，主力机构洗盘幅度大，关注关键点位180支撑。',
    tickers: 'TSLA',
    created_at: 4000,
    sender_name: 'zhao',
    channel_id: 'ch_trade'
  }
];

const insertStmt = testDb.prepare(`
  INSERT INTO messages (id, content, tickers, created_at, sender_name, channel_id)
  VALUES (@id, @content, @tickers, @created_at, @sender_name, @channel_id)
`);
for (const m of sampleMessages) {
  insertStmt.run(m);
}

// 1. 测试 dry-run 模式 (不入库)
console.log('[测试 1] 验证 dry-run 模式下的提炼统计与零数据库变更...');
const dryRes = await runBatchDistill({
  limit: 10,
  dryRun: true,
  dbInstance: testDb
});

if (!dryRes.success || dryRes.scanned !== 4 || dryRes.cardsProduced < 4) {
  console.error('❌ Dry-run 蒸馏提炼失败:', dryRes);
  process.exit(1);
}

const countAfterDry = testDb.prepare('SELECT count(*) as c FROM ontology_card').get().c;
if (countAfterDry !== 0) {
  console.error(`❌ Dry-run 模式违规写入了 ${countAfterDry} 条记录！`);
  process.exit(1);
}
console.log('  ✅ Dry-run 模式统计精确且未向数据库写入任何卡片');

// 2. 测试正式蒸馏入库
console.log('\n[测试 2] 验证正式执行大批次蒸馏入库与四大卡片分布...');
const liveRes = await runBatchDistill({
  limit: 10,
  dryRun: false,
  dbInstance: testDb
});

if (!liveRes.success || liveRes.cardsProduced < 4) {
  console.error('❌ 正式蒸馏失败:', liveRes);
  process.exit(1);
}

const countAfterLive = testDb.prepare('SELECT count(*) as c FROM ontology_card').get().c;
if (countAfterLive !== liveRes.cardsProduced) {
  console.error(`❌ 数据库入库记录数 (${countAfterLive}) 与报告产出数 (${liveRes.cardsProduced}) 不一致！`);
  process.exit(1);
}

// 校验四大类型分布
const types = testDb.prepare('SELECT card_type, count(*) as c FROM ontology_card GROUP BY card_type').all();
const typeMap = Object.fromEntries(types.map(t => [t.card_type, t.c]));
console.log('  入库卡片类型分布:', typeMap);

if (!typeMap.risk_rule || !typeMap.pattern || !typeMap.macro || !typeMap.asset_memory) {
  console.error('❌ 四大策略卡片类型未全部覆盖:', typeMap);
  process.exit(1);
}
console.log('  ✅ 四大策略本体卡片 (risk_rule, pattern, macro, asset_memory) 全部成功产出并入库！');

// 3. 测试断点续传与幂等防重 (第二次执行应为 0 待处理)
console.log('\n[测试 3] 验证断点续传与幂等排重 (不重复处理已入库消息)...');
const resumeRes = await runBatchDistill({
  limit: 10,
  dryRun: false,
  force: false,
  dbInstance: testDb
});

if (resumeRes.scanned !== 0 || resumeRes.cardsProduced !== 0) {
  console.error('❌ 断点续传幂等排重失效，重复处理了消息:', resumeRes);
  process.exit(1);
}
console.log('  ✅ 断点续传成功拦截已处理消息，增量为 0，具备强幂等性');

console.log('\n===========================================================');
console.log('🎉 REQ-037 Phase 3 大批次策略本体知识蒸馏单测全部 PASS！');
console.log('===========================================================');
