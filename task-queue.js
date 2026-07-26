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
 * 修复 #12: 使用事务包裹读写操作防止竞态
 */
export function failTask(taskId, errorMessage, errorDetails = '') {
  const db = getDb();
  const now = Date.now();

  try {
    db.transaction(() => {
      // 1. 获取任务当前的重试计数
      const task = db.prepare('SELECT retry_count, max_retries FROM task_queue WHERE id = ?').get(taskId);
      if (!task) return;

      const nextRetryCount = task.retry_count + 1;

      // 修复 #5: ECONNREFUSED 从致命错误移除 → 改为可重试（隧道闪断是暂时性问题）
      // 修复 #6: ECONNRESET/socket hang up 等网络闪断使用更短的退避基底
      const isFatalQuotaError = 
        errorMessage.includes('RESOURCE_EXHAUSTED') || 
        errorDetails.includes('RESOURCE_EXHAUSTED');

      // 网络瞬时错误：ECONNREFUSED / ECONNRESET / socket hang up / ETIMEDOUT
      const isNetworkTransientError =
        errorMessage.includes('ECONNREFUSED') || errorDetails.includes('ECONNREFUSED') ||
        errorMessage.includes('ECONNRESET') || errorDetails.includes('ECONNRESET') ||
        errorMessage.includes('socket hang up') || errorDetails.includes('socket hang up') ||
        errorMessage.includes('ETIMEDOUT') || errorDetails.includes('ETIMEDOUT');

      if (isFatalQuotaError) {
        // 配额耗尽型硬伤错误，直接熔断
        db.prepare(`
          UPDATE task_queue 
          SET status = 'failed', error_message = ?, updated_at = ? 
          WHERE id = ?
        `).run(`[熔断:配额耗尽] ${errorMessage} | ${errorDetails}`, now, taskId);
        console.error(`[Task Queue] 任务 #${taskId} 配额耗尽熔断，彻底失败。`);
        return;
      }

      if (nextRetryCount <= task.max_retries) {
        // 修复 #6: 网络闪断错误使用更短的退避基底 (3s 起步)，普通错误保持 10s 起步
        const baseMs = isNetworkTransientError ? 3000 : 5000;
        const backoffBase = baseMs * Math.pow(2, nextRetryCount - 1);
        const jitter = Math.random() * 3000;
        const backoffMs = Math.min(backoffBase + jitter, 300000);
        const runAfter = now + backoffMs;

        db.prepare(`
          UPDATE task_queue 
          SET status = 'retry', retry_count = ?, run_after = ?, error_message = ?, updated_at = ? 
          WHERE id = ?
        `).run(nextRetryCount, runAfter, `${errorMessage} | ${errorDetails}`, now, taskId);
        
        console.log(`[Task Queue] 任务 #${taskId} 执行失败，将在 ${Math.round(backoffMs / 1000)}秒 后重试 (${nextRetryCount}/${task.max_retries})${isNetworkTransientError ? ' [网络闪断快速重试]' : ''}`);
      } else {
        // 达到最大重试上限，彻底失败
        db.prepare(`
          UPDATE task_queue 
          SET status = 'failed', error_message = ?, updated_at = ? 
          WHERE id = ?
        `).run(`[Failed after max retries] ${errorMessage} | ${errorDetails}`, now, taskId);
        
        console.error(`[Task Queue] 任务 #${taskId} 彻底执行失败 (已达重试上限)`);
      }
    })();
  } catch (dbErr) {
    console.error(`[Task Queue] failTask 数据库操作失败 (task #${taskId}):`, dbErr.message);
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
  const WORKER_TIMEOUT_MS = 10 * 60 * 1000; // 修复 #4: 单任务最大执行时间 10 分钟

  // 启动时自动执行运行中任务重置
  resetRunningTasks();

  // 修复 #4: 每 5 分钟定期检查并回收超时的 running 任务（运行时自愈，而非仅启动时）
  setInterval(() => {
    try {
      const db = getDb();
      const now = Date.now();
      const staleThreshold = now - WORKER_TIMEOUT_MS;
      const staleInfo = db.prepare(`
        UPDATE task_queue 
        SET status = 'retry', error_message = '运行时自愈：任务执行超过 10 分钟超时回收', updated_at = ?, run_after = ?
        WHERE status = 'running' AND updated_at < ?
      `).run(now, now, staleThreshold);
      if (staleInfo.changes > 0) {
        console.warn(`[Task Queue] 运行时自愈：回收了 ${staleInfo.changes} 个超时挂起任务。`);
      }
    } catch (err) {
      // 自愈失败不应影响主循环
    }
  }, 5 * 60 * 1000);

  function spawnWorkers() {
    while (activeWorkers < concurrency) {
      const task = claimNextPendingTask();
      if (!task) break;

      activeWorkers++;
      (async () => {
        try {
          console.log(`[Task Queue] [Worker ${activeWorkers}/${concurrency}] 开始执行任务 #${task.id} (类型: ${task.task_type}, 优先级: ${task.priority})`);
          
          // 修复 #4: 为 workerFn 添加超时保护，防止无限挂起耗尽并发池
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`任务执行超时 (超过 ${WORKER_TIMEOUT_MS / 60000} 分钟上限)`)), WORKER_TIMEOUT_MS)
          );
          const result = await Promise.race([workerFn(task), timeoutPromise]);

          // 修复 #7: completeTask 异常不应触发 failTask 造成重复执行
          try {
            completeTask(task.id, result);
            console.log(`[Task Queue] 任务 #${task.id} 执行成功`);
          } catch (dbErr) {
            console.error(`[Task Queue] 任务 #${task.id} 执行成功但写库失败 (不重试):`, dbErr.message);
          }
        } catch (taskErr) {
          console.error(`[Task Queue] 任务 #${task.id} 处理异常:`, taskErr.message);
          try {
            failTask(task.id, taskErr.message, taskErr.stack || '');
          } catch (failDbErr) {
            console.error(`[Task Queue] failTask 写库也失败了 (task #${task.id}):`, failDbErr.message);
          }
        } finally {
          activeWorkers--;
          // 修复 #9: 使用 setImmediate 异步派发，交还事件循环控制权，防止 Event Loop 饿死
          setImmediate(spawnWorkers);
        }
      })();
    }
  }

  // 修复 #1: scheduleLoop 加 try-catch 保护，确保 setTimeout 必被执行
  function scheduleLoop() {
    try {
      spawnWorkers();
    } catch (err) {
      console.error('[Task Queue] scheduleLoop 异常，队列保持运行:', err.message);
    }
    setTimeout(scheduleLoop, pollIntervalMs);
  }

  scheduleLoop();
  console.log(`[Task Queue] 后台任务队列多并发消费者已启动 (并行度: ${concurrency}, 轮询: ${pollIntervalMs}ms, 单任务超时: ${WORKER_TIMEOUT_MS / 60000}分钟)`);
}

