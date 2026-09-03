import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('💥 全量删除 task_queue 中所有 news_% 任务，100% 独占给白皮书');
console.log('====================================================\n');

const res = db.prepare("DELETE FROM task_queue WHERE task_type LIKE 'news_%'").run();
console.log(`✅ 成功彻底销毁干洗了 ${res.changes} 个 news_* 任务！`);

const stats = db.prepare("SELECT status, task_type, priority, COUNT(*) as count FROM task_queue GROUP BY status, task_type, priority").all();
console.log('\n⚙️ 销毁后任务队列最新全景状态 (100% 纯净白皮书):');
console.table(stats);
