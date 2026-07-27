import { getDb } from '../database.js';

try {
  const db = getDb();
  console.log("=== 正在强制清理数据库堆积任务 ===");
  
  // 1. 开启独占事务，强力清空 pending/retry 的 news 任务
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  
  const countBefore = db.prepare("SELECT COUNT(*) as count FROM task_queue").get().count;
  console.log(`当前任务表总条数: ${countBefore}`);
  
  // 直接删除所有的 pending / retry 任务，仅保留已完成的和失败的（用于历史归档）
  // 也可以直接删除
  const deleteResult = db.prepare("DELETE FROM task_queue WHERE status IN ('pending', 'retry')").run();
  console.log(`成功强制清除 (DELETE) 了 ${deleteResult.changes} 个排队/重试中的堆积任务。`);
  
  const countAfter = db.prepare("SELECT COUNT(*) as count FROM task_queue").get().count;
  console.log(`清理后任务表总条数: ${countAfter}`);
  
  // 优化数据库，释放多余的碎片空间（VACUUM）
  console.log("正在执行数据库整理 (VACUUM)... 这可能需要 1~3 秒");
  db.prepare("VACUUM").run();
  console.log("=== 队列彻底清理完毕 ===");
} catch (err) {
  console.error("清理队列失败:", err);
}
