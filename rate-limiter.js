import { getDailyApiCount, incrementDailyApiCount, getDb } from './database.js';

// 限速配置
const RPM_LIMIT = 15;
const RPD_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT || '10000', 10);
const requestTimestampsMap = {}; // 按 provider 隔离的时间戳 map

/**
 * 导出当前 API 调用限额统计，供前台监控面板使用
 */
export function getRateLimiterStats() {
  return {
    limit: RPD_LIMIT,
    current: getDailyApiCount()
  };
}

// 辅助等待函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 强制满足滑动窗口 RPM 限制
 */
async function enforceRpmLimit(provider = 'general') {
  const now = Date.now();
  if (!requestTimestampsMap[provider]) {
    requestTimestampsMap[provider] = [];
  }
  const timestamps = requestTimestampsMap[provider];
  
  // 清理 60 秒之前的过期记录
  while (timestamps.length > 0 && now - timestamps[0] > 60000) {
    timestamps.shift();
  }

  if (timestamps.length >= RPM_LIMIT) {
    const oldestTimestamp = timestamps[0];
    const waitMs = 60000 - (now - oldestTimestamp) + 200; // 额外增加 200ms 安全缓冲区
    if (waitMs > 0) {
      console.log(`[Rate Limiter] ${provider} RPM 限速触发。等待 ${waitMs}ms 后继续...`);
      await sleep(waitMs);
      return enforceRpmLimit(provider); // 递归重新评估
    }
  }

  timestamps.push(Date.now());
}

/**
 * 带有滑动窗口 RPM、每日上限 RPD 以及退避重试的 API 调用执行器
 * @param {Function} apiCallFn - 返回 Promise 的 API 执行函数
 * @param {Object} options - { priority: number, maxRetries: number, provider: string }
 */
export async function runWithRateLimit(apiCallFn, options = {}) {
  const priority = options.priority !== undefined ? options.priority : 1;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 5;
  const provider = options.provider || 'general';

  // 1. 优先级避让机制：如果是中低优先级任务 (priority >= 2)，且有高优先级交易跟单任务 (priority = 1) 在排队，主动避让
  if (priority >= 2) {
    try {
      const db = getDb();
      const pendingHighPriority = db.prepare(`
        SELECT COUNT(*) as count FROM task_queue 
        WHERE status = 'pending' AND priority = 1
      `).get();

      if (pendingHighPriority && pendingHighPriority.count > 0) {
        console.log(`[Rate Limiter] 检测到有 ${pendingHighPriority.count} 个高优先级跟单任务正在排队。P${priority} 任务避让并休眠 5s...`);
        await sleep(5000);
        return runWithRateLimit(apiCallFn, options); // 重新排队
      }
    } catch (dbErr) {
      console.warn(`[Rate Limiter] 查询优先级状态失败:`, dbErr.message);
    }
  }

  // 2. 满足 RPM 限速（高优先级跟单任务 priority = 1 豁免 RPM 强制等待，实现即时跟单）
  if (priority > 1) {
    await enforceRpmLimit(provider);
  }

  // 3. 执行 API 调用，内置指数退避重试 (捕获 429)
  let attempt = 0;
  while (true) {
    // 检查每日调用上限 (RPD) - 先查后增，防止超限时计数器无限膨胀
    const currentCount = getDailyApiCount();
    if (currentCount >= RPD_LIMIT) {
      throw new Error(`[Rate Limiter] 每日 API 限制已超标 (${RPD_LIMIT} RPD)。当前计数: ${currentCount}`);
    }

    // 警戒线：若 Gemini 每日调用已达警戒线（预留 300 次给高优先级跟单交易），且当前任务不是最高优先级跟单任务 (priority > 1)，则提前拦截
    if (currentCount >= (RPD_LIMIT - 300) && priority > 1) {
      throw new Error(`[Rate Limiter] Gemini 每日配额即将耗尽 (已使用: ${currentCount}/${RPD_LIMIT})。非跟单交易任务 P${priority} 禁止调用 Gemini API，预留配额给高优先级实盘跟单。`);
    }

    const dailyCount = incrementDailyApiCount();

    try {
      return await apiCallFn();
    } catch (err) {
      const isHardQuotaError = err.message.toLowerCase().includes('quota exceeded') || err.message.includes('RESOURCE_EXHAUSTED');
      
      // 若为配额用尽类错误，重试无用，直接抛出供上层自动降级至本地大模型
      if (isHardQuotaError) {
        console.warn(`[Rate Limiter] 检测到云端 API 配额已被用尽 (${err.message})，立即放弃等待重试，触发秒级自动降级至本地大模型...`);
        throw err;
      }

      const isRetryableError = 
        err.message.includes('429') || 
        err.message.includes('503') || 
        err.message.toLowerCase().includes('rate limit') || 
        err.message.toLowerCase().includes('too many requests') || 
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
        await enforceRpmLimit(provider);
      } else {
        throw err;
      }
    }
  }
}
