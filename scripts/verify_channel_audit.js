import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('whop_archive.db');
const registry = JSON.parse(fs.readFileSync('config/channel_registry.json', 'utf-8'));

console.log('========================================================================================');
console.log('📊 全库频道 feed_id / channel_name 映射审计与错标统计');
console.log('========================================================================================\n');

// 1. 全库 distinct(channel_id, channel_name)
const dbDistinct = db.prepare(`
  SELECT channel_id, channel_name, count(*) as msg_count,
         min(created_at) as first_ts, max(created_at) as last_ts
  FROM messages
  GROUP BY channel_id, channel_name
  ORDER BY channel_id ASC
`).all();

console.log('📋 [1. 库内现状 distinct(channel_id, channel_name)]:');
dbDistinct.forEach(row => {
  const reg = registry[row.channel_id];
  const isMatch = reg && reg.name === row.channel_name;
  const status = isMatch ? '✅ 正确对齐' : (reg ? `❌ 错标 (登记册应为: "${reg.name}")` : '⚠️ 未登记 feed');
  const firstDate = new Date(Number(row.first_ts)).toISOString().slice(0, 10);
  const lastDate = new Date(Number(row.last_ts)).toISOString().slice(0, 10);
  console.log(`- [${row.channel_id}] "${row.channel_name}": ${row.msg_count} 条 (${firstDate} ~ ${lastDate}) -> ${status}`);
});

// 2. 统计发布区被错标成「期权」或「历史股票期权记录区」的条数
console.log('\n📋 [2. 错标与别名统计]:');
const wrongOptionCount = db.prepare(`
  SELECT count(*) as count FROM messages 
  WHERE channel_id = 'chat_feed_1CTrCEx44dP13jW3RVkYiS' AND channel_name != '不用翻墙期权'
`).get().count;
console.log(`- chat_feed_1CTrCEx44dP13jW3RVkYiS 非标准命名条数: ${wrongOptionCount}`);

const forumFeedStats = db.prepare(`
  SELECT channel_name, count(*) as count FROM messages 
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
  GROUP BY channel_name
`).all();
console.log(`- forum_feed_1CTr7SqVMzFfuFiiRJLEHN 分布:`, forumFeedStats);

const broadcastStats = db.prepare(`
  SELECT channel_name, count(*) as count FROM messages 
  WHERE channel_id = 'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4'
  GROUP BY channel_name
`).all();
console.log(`- chat_feed_1CTr7QocNpDZ9FXZ6fvWe4 (美股发布) 分布:`, broadcastStats);

// 3. 7-29 三条关键消息审计
console.log('\n📋 [3. 7-29 三条关键样本对齐情况]:');
const sampleMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, created_at, content
  FROM messages
  WHERE (content LIKE '%别人认为的量化是机器%' OR content LIKE '%49.9出掉49的dram%' OR content LIKE '%854出掉 774剩下一半 mu%')
  ORDER BY created_at ASC
`).all();

sampleMsgs.forEach(m => {
  const dt = new Date(Number(m.created_at)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const regName = registry[m.channel_id]?.name || '未登记';
  console.log(`- [${m.id}] ${dt} | feed_id: ${m.channel_id} | 库内channel_name: "${m.channel_name}" | 登记册规范名: "${regName}"`);
});
