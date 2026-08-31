import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('========================================================================================');
console.log('🔍 实时处理分发流水线状态全景核验');
console.log('========================================================================================\n');

// 1. 最新 10 条消息
const recentMsgs = db.prepare(`
  SELECT id, channel_id, sender_name, created_at, content 
  FROM messages 
  ORDER BY created_at DESC LIMIT 10
`).all();

console.log('📋 数据库最新 10 条消息:');
recentMsgs.forEach((r, i) => {
  const dt = new Date(Number(r.created_at)).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
  console.log(`[${i+1}] [${r.id}] (${r.sender_name}) [${dt}] [${r.channel_id}]:`);
  console.log(`    ${r.content.replace(/\n+/g, ' ')}\n`);
});

// 2. 检查赵哥最新发言
const zhaoRecent = db.prepare(`
  SELECT id, channel_id, sender_name, created_at, content 
  FROM messages 
  WHERE sender_name = 'xiaozhaolucky'
  ORDER BY created_at DESC LIMIT 5
`).all();

console.log('========================================================================================');
console.log('👑 赵哥最新发言记录 (Top 5):');
zhaoRecent.forEach((r, i) => {
  const dt = new Date(Number(r.created_at)).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
  console.log(`[${i+1}] [${r.id}] [${dt}] [${r.channel_id}]:`);
  console.log(`    ${r.content.replace(/\n+/g, ' ')}\n`);
});
console.log('========================================================================================\n');
