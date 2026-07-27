import { getDb } from '../database.js';

const db = getDb();
const info = db.prepare(`
  UPDATE task_queue 
  SET status = 'pending', retry_count = 0, run_after = NULL 
  WHERE status IN ('failed', 'retry') 
    AND (error_message LIKE '%ECONNREFUSED%' OR error_message LIKE '%429%')
`).run();

console.log(`✅ 成功重置因通道占用/限流失败的任务数: ${info.changes}`);
