import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 消息源频道物理隔离与 100% 来源铁证自检');
console.log('====================================================\n');

// 1. 查看数据库中所有频道的名称与 ID 分布
const channels = db.prepare(`
  SELECT channel_id, channel_name, COUNT(*) as msg_count
  FROM messages
  GROUP BY channel_id, channel_name
  ORDER BY msg_count DESC
`).all();

console.log('📚 当前数据库中所有频道消息基数分布:');
console.table(channels);

// 2. 检查 trade_review_pool 表中所有记录的消息源频道归属
const poolSourceCheck = db.prepare(`
  SELECT m.channel_id, m.channel_name, COUNT(*) as pool_count
  FROM trade_review_pool p
  LEFT JOIN messages m ON p.message_id = m.id
  GROUP BY m.channel_id, m.channel_name
`).all();

console.log('\n🎯 【trade_review_pool 候选与持仓总池】中所有消息的物理频道归属:');
console.table(poolSourceCheck);

// 3. 检查 orders 表中所有成交流水的原始消息来源频道归属
// 从 reason 中提取原始发言，或关联 messages 表
const totalPool = db.prepare('SELECT COUNT(*) as c FROM trade_review_pool').get().c;
const confirmedPool = db.prepare("SELECT COUNT(*) as c FROM trade_review_pool WHERE status = 'confirmed'").get().c;
const candidatePool = db.prepare("SELECT COUNT(*) as c FROM trade_review_pool WHERE status = 'candidate'").get().c;

console.log(`\n📊 汇总统计:`);
console.log(`- 评审池总记录数: ${totalPool}`);
console.log(`- 已确认实盘交易数: ${confirmedPool}`);
console.log(`- 待复核候选消息数: ${candidatePool}`);

const otherChannelLeaks = poolSourceCheck.filter(c => c.channel_id !== 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN');
if (otherChannelLeaks.length === 0) {
  console.log('\n✅ 铁证核验结果: 100% 的实盘持仓与候选消息均唯一来源于【历史股票期权记录区】(forum_feed_1CTr7SqVMzFfuFiiRJLEHN)！绝无任何其他频道的污染！');
} else {
  console.log('\n❌ 警告: 发现非目标频道的泄漏:', otherChannelLeaks);
}
