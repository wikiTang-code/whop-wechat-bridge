/**
 * @file cleanup_gemini_api_cloud.js
 * @description 一次性清理历史 task_queue 中堆积的 gemini_api_cloud 脏数据 (P1-6)
 * 
 * 依据 docs/system-hardening-and-monitoring-plan.md §5 I3:
 * task_queue 历史上曾被 rate-limiter 写入约 22,285 行 API 可视化卡片 (占表 79%)。
 * 现已全部改造为内存环形缓冲追踪，运行本脚本可安全清空历史脏数据并恢复队列纯洁性。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.argv[2] || process.env.DB_PATH || path.resolve('whop_archive.db');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 数据库文件不存在: ${dbPath}`);
  process.exit(1);
}

console.log('========================================================================================');
console.log(`🧹 [P1-6 治理] 启动 task_queue 脏数据清理脚本: ${dbPath}`);
console.log('========================================================================================\n');

const db = new Database(dbPath);

try {
  // 1. 统计当前表状态
  const totalBefore = db.prepare('SELECT COUNT(*) as count FROM task_queue').get().count;
  const dirtyCount = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud'`).get().count;
  const dirtyRunning = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud' AND status = 'running'`).get().count;
  const dirtyFailed = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud' AND status = 'failed'`).get().count;
  const dirtyRetry = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud' AND status = 'retry'`).get().count;
  const dirtyPending = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud' AND status = 'pending'`).get().count;

  console.log(`📊 清理前统计:`);
  console.log(`   - 任务表总行数: ${totalBefore}`);
  console.log(`   - gemini_api_cloud 脏记录数: ${dirtyCount} (${totalBefore > 0 ? ((dirtyCount / totalBefore) * 100).toFixed(1) : 0}%)`);
  console.log(`     · running: ${dirtyRunning}, pending: ${dirtyPending}, retry: ${dirtyRetry}, failed: ${dirtyFailed}`);

  if (dirtyCount === 0) {
    console.log('\n✨ 无需清理：task_queue 中无 gemini_api_cloud 脏数据。');
    process.exit(0);
  }

  // 2. 执行安全删除事务
  console.log(`\n⏳ 正在执行清理事务...`);
  const deleteTx = db.transaction(() => {
    const info = db.prepare(`DELETE FROM task_queue WHERE task_type = 'gemini_api_cloud'`).run();
    return info.changes;
  });

  const deleted = deleteTx();
  const totalAfter = db.prepare('SELECT COUNT(*) as count FROM task_queue').get().count;

  console.log(`\n✅ 清理完成:`);
  console.log(`   - 成功删除记录数: ${deleted}`);
  console.log(`   - 任务表剩余有效业务任务数: ${totalAfter}`);
  console.log(`   - 队列状态已彻底纯净化，主库写锁与 worker 异常死锁风险已解除！\n`);

} catch (err) {
  console.error('❌ 清理过程中发生异常:', err.message);
  process.exit(1);
} finally {
  db.close();
}
