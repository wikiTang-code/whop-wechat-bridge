import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('🧹 物理干洗 Gemini API 废卡并重置所有失败任务');
console.log('====================================================\n');

// 1. 物理干洗废卡
const delRes = db.prepare(`DELETE FROM task_queue WHERE task_type = 'gemini_api_cloud'`).run();
console.log(`🧹 成功干洗物理清除 ${delRes.changes} 条临时 Gemini API 广播卡片！`);

// 2. 将挂起/重试/失败的任务全部打回 pending
const resetRes = db.prepare(`
  UPDATE task_queue 
  SET status = 'pending', retry_count = 0, run_after = NULL, updated_at = ?
  WHERE status IN ('failed', 'retry')
`).run(Date.now());

console.log(`🔄 成功将 ${resetRes.changes} 个失败/重试任务一键打回 pending 重启执行！`);
