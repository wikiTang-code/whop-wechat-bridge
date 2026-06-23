import { getDailyApiCount, incrementDailyApiCount, getDb } from './database.js';

// 限速配置
const RPM_LIMIT = 15;
const RPD_LIMIT = 1500;
const requestTimestamps = []; // 内存中滑动窗口时间戳

// 辅助等待函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 强制满足滑动窗口 RPM 限制
 */
async function enforceRpmLimit() {
  const now = Date.now();
  
  // 清理 60 秒之前的过期记录
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= RPM_LIMIT) {
    const oldestTimestamp = requestTimestamps[0];
    const waitMs = 60000 - (now - oldestTimestamp) + 200; // 额外增加 200ms 安全缓冲区
    if (waitMs > 0) {
      console.log(`[Rate Limiter] RPM 限速触发。等待 ${waitMs}ms 后继续...`);
      await sleep(waitMs);
      return enforceRpmLimit(); // 递归重新评估
    }
  }

  requestTimestamps.push(Date.now());
}

/**
 * 带有滑动窗口 RPM、每日上限 RPD 以及退避重试的 API 调用执行器
 * @param {Function} apiCallFn - 返回 Promise 的 API 执行函数
 * @param {Object} options - { priority: number, maxRetries: number }
 */
export async function runWithRateLimit(apiCallFn, options = {}) {
  const priority = options.priority !== undefined ? options.priority : 1;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 5;

  // 1. 优先级避让机制：若有高优先级（P10）任务排队，P0 任务主动避让
  if (priority < 9) {
    try {
      const db = getDb();
      const pendingHighPriority = db.prepare(`
        SELECT COUNT(*) as count FROM task_queue 
        WHERE status = 'pending' AND priority >= 9
      `).get();

      if (pendingHighPriority && pendingHighPriority.count > 0) {
        console.log(`[Rate Limiter] 检测到有 ${pendingHighPriority.count} 个高优先级任务正在排队。P${priority} 任务避让并休眠 5s...`);
        await sleep(5000);
        return runWithRateLimit(apiCallFn, options); // 重新排队，不在此处递增 RPD 计数器
      }
    } catch (dbErr) {
      console.warn(`[Rate Limiter] 查询优先级状态失败:`, dbErr.message);
    }
  }

  // 2. 满足 RPM 限速
  await enforceRpmLimit();

  // 3. 执行 API 调用，内置指数退避重试 (捕获 429)
  let attempt = 0;
  while (true) {
    // 检查每日调用上限 (RPD) - 先查后增，防止超限时计数器无限膨胀
    const currentCount = getDailyApiCount();
    if (currentCount >= RPD_LIMIT) {
      throw new Error(`[Rate Limiter] 每日 API 限制已超标 (${RPD_LIMIT} RPD)。当前计数: ${currentCount}`);
    }

    // 警戒线：若 Gemini 每日调用已达 1200 次（剩余 300 次），且不是高优先级交易任务（P < 9），则提前拦截
    if (currentCount >= (RPD_LIMIT - 300) && priority < 9) {
      throw new Error(`[Rate Limiter] Gemini 每日配额即将耗尽 (已使用: ${currentCount}/${RPD_LIMIT})。低优先级任务 P${priority} 禁止调用 Gemini API，预留配额给高优先级实盘交易。`);
    }

    const dailyCount = incrementDailyApiCount();

    try {
      return await apiCallFn();
    } catch (err) {
      const isRetryableError = 
        err.message.includes('429') || 
        err.message.includes('503') || 
        err.message.toLowerCase().includes('rate limit') || 
        err.message.toLowerCase().includes('too many requests') || 
        err.message.toLowerCase().includes('quota exceeded') ||
        err.message.toLowerCase().includes('unavailable') ||
        err.message.toLowerCase().includes('experiencing high demand') ||
        err.message.toLowerCase().includes('temporary');
        
      if (isRetryableError && attempt < maxRetries) {
        attempt++;
        // 指数退避加随机抖动 (Jitter)
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 60000);
        console.warn(`[Rate Limiter] 遇到 API 临时错误 (429/503)。尝试第 ${attempt}/${maxRetries} 次重试，将在 ${Math.round(delay)}ms 后执行。错误: ${err.message}`);
        await sleep(delay);
        
        // 重试前重新执行限速判定
        await enforceRpmLimit();
      } else {
        throw err;
      }
    }
  }
}
