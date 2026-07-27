import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('⏱️ 实时打点测算白皮书生成剩余倒计时 (ETA)');
console.log('====================================================\n');

// 1. 查询当前待处理/运行中与已完成的任务数
const stats = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM task_queue 
  WHERE task_type LIKE 'persona_%'
  GROUP BY status
`).all();

const statusMap = {};
stats.forEach(s => statusMap[s.status] = s.count);

const doneCount = statusMap['done'] || 0;
const pendingCount = statusMap['pending'] || 0;
const runningCount = statusMap['running'] || 0;
const remainingCount = pendingCount + runningCount;

// 2. 采样计算过去 3 分钟内的吞吐速率 (Tasks / min)
const threeMinsAgo = Date.now() - 3 * 60 * 1000;
const recentDone = db.prepare(`
  SELECT COUNT(*) as count 
  FROM task_queue 
  WHERE task_type LIKE 'persona_%' AND status = 'done' AND updated_at >= ?
`).get(threeMinsAgo);

const tasksPerMin = (recentDone?.count || 0) / 3;

console.log(`📊 统计数据:`);
console.log(` - 已完成 Map 片段: ${doneCount} 个`);
console.log(` - 剩余待处理片段: ${remainingCount} 个 (Pending: ${pendingCount}, Running: ${runningCount})`);
console.log(` - 过去3分钟处理数: ${recentDone?.count || 0} 个`);
console.log(` - 当前 GPU 爆算速率: ~${tasksPerMin.toFixed(1)} 任务/分钟`);

if (remainingCount === 0) {
  console.log('\n🎉 所有 Map 片段已全部爆算完成！正在触发 Reduce 终极合成...');
} else if (tasksPerMin > 0) {
  const remainingMins = Math.ceil(remainingCount / tasksPerMin);
  console.log(`\n⏳ 预估剩余完成时间 (ETA): 约 ${remainingMins} 分钟`);
} else {
  console.log('\n⏳ GPU 刚启动或正处于队列微调中，预估剩余完成时间: 约 10-15 分钟');
}
