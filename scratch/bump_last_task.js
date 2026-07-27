import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('⚡ 将最后的 persona_community 任务设为 P1 pending 促使其秒级收尾');
console.log('====================================================\n');

db.prepare(`UPDATE task_queue SET status = 'pending', priority = 1 WHERE id = 244670`).run();

const lastTasks = db.prepare(`
  SELECT id, task_type, status, priority, retry_count, updated_at
  FROM task_queue
  WHERE json_extract(payload, '$.batchId') = 'persona_batch_1785053882196'
    AND status IN ('pending', 'running', 'retry')
`).all();

console.table(lastTasks);
