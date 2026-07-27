import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('🧹 清理数据库中旧代码产生的格式错乱与 6 月份历史脏数据');
console.log('====================================================\n');

// 1. 删除标题中带有旧错乱格式 '13:30' 的历史速报
const del1 = db.prepare("DELETE FROM news_summaries WHERE title LIKE '%13:30%' OR title LIKE '%17:30%' OR title LIKE '%09:30%'").run();
console.log(`✅ 1. 成功清除带有旧格式 '13:30' 的旧速报: ${del1.changes} 篇`);

// 2. 删除 2026 年 7 月 1 日以前（6 月份）的历史测试数据
const del2 = db.prepare("DELETE FROM news_summaries WHERE start_time < ?").run(new Date('2026-07-01T00:00:00+08:00').getTime());
console.log(`✅ 2. 成功清除 2026/07/01 以前的旧测试数据: ${del2.changes} 篇`);

// 3. 查询清理后 news_summaries 剩余的干净记录
const remaining = db.prepare(`
  SELECT id, title, datetime(start_time/1000, 'unixepoch', '+8 hours') as start_hkt
  FROM news_summaries
  ORDER BY start_time ASC
`).all();

console.log(`\n📋 剩余的干净速报记录 (${remaining.length} 篇):`);
console.table(remaining.slice(0, 15));
