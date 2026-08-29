import { getDb } from '../database.js';

const db = getDb();

console.log('========================================================================================');
console.log('🔍 Step 1.1: 深度核实 1CTrCEx 与 1CTr7Qoc 的消息时间与内容区别 (防重复计算)');
console.log('========================================================================================\n');

// 1. chat_feed_1CTr7QocNpDZ9FXZ6fvWe4
const qocStats = db.prepare(`
  SELECT COUNT(*) as count, MIN(created_at) as min_t, MAX(created_at) as max_t,
         SUM(CASE WHEN sender_name LIKE '%xiaozhaolucky%' THEN 1 ELSE 0 END) as zhao_cnt
  FROM messages WHERE channel_id = 'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4'
`).get();

// 2. chat_feed_1CTrCEx44dP13jW3RVkYiS
const cexStats = db.prepare(`
  SELECT COUNT(*) as count, MIN(created_at) as min_t, MAX(created_at) as max_t,
         SUM(CASE WHEN sender_name LIKE '%xiaozhaolucky%' THEN 1 ELSE 0 END) as zhao_cnt
  FROM messages WHERE channel_id = 'chat_feed_1CTrCEx44dP13jW3RVkYiS'
`).get();

console.log(`📡 [A] chat_feed_1CTr7QocNpDZ9FXZ6fvWe4:`);
console.log(`    总消息数: ${qocStats.count} 条 | 赵哥发言: ${qocStats.zhao_cnt} 条`);
console.log(`    时间跨度: ${new Date(qocStats.min_t).toISOString().slice(0,10)} ~ ${new Date(qocStats.max_t).toISOString().slice(0,10)}`);
const qocSamples = db.prepare(`SELECT sender_name, content, created_at FROM messages WHERE channel_id = 'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4' ORDER BY created_at ASC LIMIT 3`).all();
console.log(`    起始 3 条消息:`);
qocSamples.forEach((s, i) => console.log(`      (${i+1}) [${new Date(s.created_at).toISOString().slice(0,10)}] ${s.sender_name}: ${s.content.slice(0, 60)}`));

console.log(`\n📡 [B] chat_feed_1CTrCEx44dP13jW3RVkYiS:`);
console.log(`    总消息数: ${cexStats.count} 条 | 赵哥发言: ${cexStats.zhao_cnt} 条`);
console.log(`    时间跨度: ${new Date(cexStats.min_t).toISOString().slice(0,10)} ~ ${new Date(cexStats.max_t).toISOString().slice(0,10)}`);
const cexSamples = db.prepare(`SELECT sender_name, content, created_at FROM messages WHERE channel_id = 'chat_feed_1CTrCEx44dP13jW3RVkYiS' ORDER BY created_at ASC LIMIT 3`).all();
console.log(`    起始 3 条消息:`);
cexSamples.forEach((s, i) => console.log(`      (${i+1}) [${new Date(s.created_at).toISOString().slice(0,10)}] ${s.sender_name}: ${s.content.slice(0, 60)}`));

// 3. 检查两者是否有完全相同内容的消息（排查是否为同一频道的历史迁移 ID）
const dupCheck = db.prepare(`
  SELECT COUNT(*) as dup_count
  FROM messages m1
  JOIN messages m2 ON m1.content = m2.content AND m1.created_at = m2.created_at
  WHERE m1.channel_id = 'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4' 
    AND m2.channel_id = 'chat_feed_1CTrCEx44dP13jW3RVkYiS'
`).get();

console.log(`\n🔍 两频道同内容+同时间戳完全重合消息数: ${dupCheck.dup_count} 条`);
