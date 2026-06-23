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

  const claimTx = db.transaction(() => {
    const now = Date.now();
    // 查询优先级最高且已到可跑时间的待处理任务 (支持 status 为 pending 或 retry)
    // 依赖约束：persona_reduce 任务只有在同批次的 active 状态的 persona_map 和 persona_community 任务全部 done/failed 后才能被领取
    // 将 sibling.status != 'done' 改为 sibling.status IN ('pending', 'running', 'retry')，防止因某个 Map 任务彻底 failed 导致 Reduce 永远死锁
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
      // 立即将状态更新为 running，对其上锁
      db.prepare(`
        UPDATE task_queue 
        SET status = 'running', updated_at = ? 
        WHERE id = ?
      `).run(now, task.id);
    }
    return task;
  });

  // 使用 immediate() 隔离级别启动事务，防止多进程下发生 SQLITE_BUSY 竞态锁冲突
  return claimTx.immediate();
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

  if (nextRetryCount <= task.max_retries) {
    // 指数退避计算：如 2s, 4s, 8s, 16s... 最大 5 分钟
    const backoffMs = Math.min(2000 * Math.pow(2, nextRetryCount), 300000);
    const runAfter = now + backoffMs;

    db.prepare(`
      UPDATE task_queue 
      SET status = 'retry', retry_count = ?, run_after = ?, error_message = ?, updated_at = ? 
      WHERE id = ?
    `).run(nextRetryCount, runAfter, `${errorMessage} | ${errorDetails}`, now, taskId);
    
    console.log(`[Task Queue] 任务 #${taskId} 执行失败，将在 ${backoffMs / 1000}秒 后重试 (${nextRetryCount}/${task.max_retries})`);
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
  
  try {
    const info = db.prepare(`
      UPDATE task_queue 
      SET status = 'pending', updated_at = ? 
      WHERE status = 'running'
    `).run(now);
    
    if (info.changes > 0) {
      console.log(`[Task Queue System] 启动自愈：成功重置了 ${info.changes} 个因系统异常中断而卡在 running 状态的任务。`);
    }
  } catch (err) {
    console.error('[Task Queue System] 启动自愈失败:', err.message);
  }
}

/**
 * 启动后台队列消费循环
 * @param {Function} workerFn - 任务处理器 async function(task)
 * @param {number} pollIntervalMs - 空闲轮询间隔
 */
export function startQueueWorker(workerFn, pollIntervalMs = 5000) {
  let isWorking = false;

  // 启动时自动执行运行中任务重置
  resetRunningTasks();

  async function checkQueue() {
    if (isWorking) return;
    isWorking = true;

    try {
      while (true) {
        const task = claimNextPendingTask();
        if (!task) {
          // 没有待处理的任务，跳出循环
          break;
        }

        console.log(`[Task Queue] 开始执行任务 #${task.id} (类型: ${task.task_type}, 优先级: ${task.priority})`);
        
        try {
          // 执行具体的任务处理函数
          const result = await workerFn(task);
          completeTask(task.id, result);
          console.log(`[Task Queue] 任务 #${task.id} 执行成功`);
        } catch (taskErr) {
          console.error(`[Task Queue] 任务 #${task.id} 处理异常:`, taskErr);
          failTask(task.id, taskErr.message, taskErr.stack || '');
        }
      }
    } catch (err) {
      console.error('[Task Queue] 队列消费循环异常:', err);
    } finally {
      isWorking = false;
      // 安排下一次轮询
      setTimeout(checkQueue, pollIntervalMs);
    }
  }

  // 立即启动第一次轮询
  checkQueue();
  console.log(`[Task Queue] 后台任务队列消费者已启动 (轮询间隔: ${pollIntervalMs}ms)`);
}
