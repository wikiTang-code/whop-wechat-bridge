import { getDb } from './database.js';

/**
 * 向队列中新增一个任务
 * @param {Object} param0 - { taskType, priority, payload, maxRetries }
 */
export function addTask({ taskType, priority = 1, payload, maxRetries = 5 }) {
  const db = getDb();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO task_queue (task_type, priority, payload, status, retry_count, max_retries, run_after, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
  `);

  const info = stmt.run(taskType, priority, payloadStr, maxRetries, now, now, now);
  return info.lastInsertRowid;
}

/**
 * 原子事务锁定并获取下一个待执行任务 (防止并发竞争)
 */
export function claimNextPendingTask() {
  const db = getDb();

  try {
    const claimTx = db.transaction(() => {
      const now = Date.now();
      const task = db.prepare(`
        SELECT * FROM task_queue 
        WHERE status IN ('pending', 'retry') AND (run_after IS NULL OR run_after <= ?)
          AND (
            task_type != 'persona_reduce'
            OR NOT EXISTS (
              SELECT 1 FROM task_queue sibling
              WHERE sibling.task_type IN ('persona_map', 'persona_community')
                AND sibling.status IN ('pending', 'running', 'retry')
                AND json_extract(sibling.payload, '$.batchId') = json_extract(task_queue.payload, '$.batchId')
            )
          )
        ORDER BY priority DESC, created_at ASC 
        LIMIT 1
      `).get(now);

      if (task) {
        db.prepare(`
          UPDATE task_queue 
          SET status = 'running', updated_at = ? 
          WHERE id = ?
        `).run(now, task.id);
      }
      return task;
    });

    return claimTx.immediate();
  } catch (err) {
    if (err.code === 'SQLITE_BUSY' || err.message.includes('locked')) {
      return null; // 多并发争抢时平滑避让，等待下一个 tick 轮询
    }
    throw err;
  }
}

/**
 * 标记任务执行成功
 */
export function completeTask(taskId, result) {
  const db = getDb();
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  const now = Date.now();

  db.prepare(`
    UPDATE task_queue 
    SET status = 'done', result = ?, updated_at = ? 
    WHERE id = ?
  `).run(resultStr, now, taskId);
}

/**
 * 标记任务失败，依据重试策略判定是否重新入列
 */
export function failTask(taskId, errorMessage, errorDetails = '') {
  const db = getDb();
  const now = Date.now();

  // 1. 获取任务当前的重试计数
  const task = db.prepare('SELECT retry_count, max_retries FROM task_queue WHERE id = ?').get(taskId);
  if (!task) return;

  const nextRetryCount = task.retry_count + 1;

  // 核心优化：若遇到 API 配额限制（429）、或者是本地大模型连接拒绝（ECONNREFUSED）等配额/通道硬伤错误，
  // 没必要进行无谓的指数退避重试（这会死锁前台进度条并阻塞队列），直接熔断判定为彻底失败 failed！
  const isFatalQuotaOrConnError = 
    errorMessage.includes('429') || 
    errorMessage.includes('RESOURCE_EXHAUSTED') || 
    errorMessage.includes('ECONNREFUSED') ||
    errorDetails.includes('429') || 
    errorDetails.includes('RESOURCE_EXHAUSTED') || 
    errorDetails.includes('ECONNREFUSED');

  if (nextRetryCount <= task.max_retries && !isFatalQuotaOrConnError) {
    // 指数退避计算，引入随机抖动 (Jitter) 防止突发性的大量任务同步重试，保护数据库
    const backoffBase = 5000 * Math.pow(2, nextRetryCount); // 基础退避时间：10s, 20s, 40s...
    const jitter = Math.random() * 3000; // 0~3 秒随机抖动
    const backoffMs = Math.min(backoffBase + jitter, 300000); // 最大 5 分钟
    const runAfter = now + backoffMs;

    db.prepare(`
      UPDATE task_queue 
      SET status = 'retry', retry_count = ?, run_after = ?, error_message = ?, updated_at = ? 
      WHERE id = ?
    `).run(nextRetryCount, runAfter, `${errorMessage} | ${errorDetails}`, now, taskId);
    
    console.log(`[Task Queue] 任务 #${taskId} 执行失败，将在 ${Math.round(backoffMs / 1000)}秒 后重试 (${nextRetryCount}/${task.max_retries})`);
  } else {
    // 达到最大重试上限，彻底失败
    db.prepare(`
      UPDATE task_queue 
      SET status = 'failed', error_message = ?, updated_at = ? 
      WHERE id = ?
    `).run(`[Failed after max retries] ${errorMessage} | ${errorDetails}`, now, taskId);
    
    console.error(`[Task Queue] 任务 #${taskId} 彻底执行失败 (已达重试上限)`);
  }
}

/**
 * 系统启动自愈：重置所有被卡在 running 状态的任务回 pending 状态
 */
export function resetRunningTasks() {
  const db = getDb();
  const now = Date.now();
  const timeoutMs = 12 * 60 * 60 * 1000; // 12 小时时效阈值
  
  try {
    // 1. 先将超过 12 小时未完结的挂起冷任务一律标记为 failed 自动废弃，杜绝历史积压任务在重启后重新跑画像导致算力浪费
    const expiredInfo = db.prepare(`
      UPDATE task_queue 
      SET status = 'failed', error_message = '系统重启自愈：该历史任务已超过 12 小时时效阈值，自动取消废弃。', updated_at = ?
      WHERE status = 'running' AND (? - created_at > ?)
    `).run(now, now, timeoutMs);
    
    if (expiredInfo.changes > 0) {
      console.log(`[Task Queue System] 启动自愈：自动清理废弃了 ${expiredInfo.changes} 个超时冗余挂起任务。`);
    }

    // 2. 将 12 小时内的新近热任务重置为 pending，以支持正常闪断情况下的断点续传
    const info = db.prepare(`
      UPDATE task_queue 
      SET status = 'pending', updated_at = ? 
      WHERE status = 'running'
    `).run(now);
    
    if (info.changes > 0) {
      console.log(`[Task Queue System] 启动自愈：成功重置了 ${info.changes} 个近期的运行中任务为 pending (断点续传已恢复)。`);
    }
  } catch (err) {
    console.error('[Task Queue System] 启动自愈失败:', err.message);
  }
}

/**
 * 启动后台队列消费循环 (支持多线程并发)
 * @param {Function} workerFn - 任务处理器 async function(task)
 * @param {number} concurrency - 并行消费任务数 (默认 4)
 * @param {number} pollIntervalMs - 空闲轮询间隔 (默认 800ms)
 */
export function startQueueWorker(workerFn, concurrency = 4, pollIntervalMs = 800) {
  let activeWorkers = 0;

  // 启动时自动执行运行中任务重置
  resetRunningTasks();

  function spawnWorkers() {
    while (activeWorkers < concurrency) {
      const task = claimNextPendingTask();
      if (!task) break;

      activeWorkers++;
      (async () => {
        try {
          console.log(`[Task Queue] [Parallel Worker ${activeWorkers}/${concurrency}] 开始执行任务 #${task.id} (类型: ${task.task_type}, 优先级: ${task.priority})`);
          const result = await workerFn(task);
          completeTask(task.id, result);
          console.log(`[Task Queue] 任务 #${task.id} 执行成功`);
        } catch (taskErr) {
          console.error(`[Task Queue] 任务 #${task.id} 处理异常:`, taskErr);
          failTask(task.id, taskErr.message, taskErr.stack || '');
          
          if (taskErr.message.includes('限制已超标') || taskErr.message.includes('限额') || taskErr.message.includes('配额') || taskErr.message.includes('429')) {
            console.warn(`[Task Queue System] 大模型接口配额受限或网络临时受阻 (${taskErr.message})，该任务已记录状态...`);
          }
        } finally {
          activeWorkers--;
          // 当前 worker 结束，立即补充新任务
          spawnWorkers();
        }
      })();
    }
  }

  function scheduleLoop() {
    spawnWorkers();
    setTimeout(scheduleLoop, pollIntervalMs);
  }

  scheduleLoop();
  console.log(`[Task Queue] 后台任务队列多并发消费者已启动 (并行度: ${concurrency}, 轮询: ${pollIntervalMs}ms)`);
}
