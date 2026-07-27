import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('🧹 清理历史旧测试批次的残留废弃任务，保障最新大批次直通收尾');
console.log('====================================================\n');

const res = db.prepare(`
  DELETE FROM task_queue 
  WHERE task_type LIKE 'persona_%' 
    AND (json_extract(payload, '$.batchId') IS NULL OR json_extract(payload, '$.batchId') != 'persona_batch_1785053882196')
    AND status IN ('pending', 'failed', 'retry')
`).run();

console.log(`✅ 成功清除干洗了 ${res.changes} 个历史废弃旧批次任务！`);

const activeStats = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM task_queue
  WHERE json_extract(payload, '$.batchId') = 'persona_batch_1785053882196'
  GROUP BY status
`).all();

console.log('\n⚙️ 当前最新大批次 persona_batch_1785053882196 最终全景状态:');
console.table(activeStats);
