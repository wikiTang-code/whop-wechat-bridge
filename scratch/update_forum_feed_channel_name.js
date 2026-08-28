import { getDb } from '../database.js';

const db = getDb();
console.log('====================================================');
console.log('🔄 批量更新 forum_feed_1CTr7SqVMzFfuFiiRJLEHN 为【历史股票期权记录区】');
console.log('====================================================\n');

const res = db.prepare(`
  UPDATE messages
  SET channel_name = '历史股票期权记录区'
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
`).run();

console.log(`✅ 成功将 ${res.changes} 条消息的 channel_name 字段精准固化为【历史股票期权记录区】！`);
