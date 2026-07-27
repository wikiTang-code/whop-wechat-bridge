import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('🔄 一键重置 SQLite 队列中所有 failed 失败任务为 pending');
console.log('====================================================\n');

const res = db.prepare("UPDATE task_queue SET status = 'pending', retry_count = 0 WHERE status = 'failed'").run();
console.log(`✅ 成功将 ${res.changes} 个失败任务重置为 [pending] 待消费状态！Worker 将携带最新超限升舱能力继续消费！`);

const stats = db.prepare("SELECT status, COUNT(*) as count FROM task_queue GROUP BY status").all();
console.log('\n⚙️ 重置后任务队列最新全景状态:');
console.table(stats);
