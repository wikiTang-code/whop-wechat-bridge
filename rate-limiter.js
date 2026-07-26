import { getDailyApiCount, incrementDailyApiCount, getDb } from './database.js';

// 限速配置：Gemini 免费层官方上限 20 RPM，此处硬性锁死为 10 RPM (平均 6 秒放行 1 次，保留 50% 绝对安全倾斜)
const GEMINI_RPM_LIMIT = 10;
const GENERAL_RPM_LIMIT = 15;
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
 * 强制满足滑动窗口 RPM 限制 (严格安全堵截，绝不越界强制放行)
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

  const currentLimit = provider.includes('gemini') ? GEMINI_RPM_LIMIT : GENERAL_RPM_LIMIT;

  // 只要窗口内满了，就绝对排队等待最早的一条过期，绝不违规放行！
  if (timestamps.length >= currentLimit) {
    const oldestTimestamp = timestamps[0];
    const waitMs = 60000 - (now - oldestTimestamp) + 500; // 额外增加 500ms 强力安全缓冲区
    if (waitMs > 0) {
      console.log(`[Rate Limiter] 🛡️ 触发 ${provider} 滑动窗口限速 (已满 ${timestamps.length}/${currentLimit})。静止挂起排队 ${waitMs}ms...`);
      await sleep(waitMs);
      return enforceRpmLimit(provider); // 递归重新评估，直到有空闲坑位
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
  //    修复: 限制最大避让次数为 3 次 (共 15 秒)，防止大量 P1 任务积压导致 P2+ 任务永远无法执行
  if (priority >= 2) {
    const MAX_YIELD_ROUNDS = 3;
    for (let yieldRound = 0; yieldRound < MAX_YIELD_ROUNDS; yieldRound++) {
      try {
        const db = getDb();
        // 仅检测真正可立即执行的 P1 任务 (status=pending 且 run_after 已到期)
        const now = Date.now();
        const pendingHighPriority = db.prepare(`
          SELECT COUNT(*) as count FROM task_queue 
          WHERE status = 'pending' AND priority = 1 AND (run_after IS NULL OR run_after <= ?)
        `).get(now);

        if (pendingHighPriority && pendingHighPriority.count > 0) {
          if (yieldRound === 0) {
            console.log(`[Rate Limiter] 检测到有 ${pendingHighPriority.count} 个可执行的 P1 跟单任务。P${priority} 任务避让 5s (第 ${yieldRound + 1}/${MAX_YIELD_ROUNDS} 轮)...`);
          }
          await sleep(5000);
        } else {
          break; // 没有高优先级任务了，不再避让
        }
      } catch (dbErr) {
        console.warn(`[Rate Limiter] 查询优先级状态失败:`, dbErr.message);
        break; // 查询失败不阻塞
      }
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

// Periodic cleanup of stale provider timestamp entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [provider, timestamps] of Object.entries(requestTimestampsMap)) {
    // Remove entries older than 60 seconds
    while (timestamps.length > 0 && now - timestamps[0] > 60000) {
      timestamps.shift();
    }
    // If no timestamps remain for this provider, delete the entry entirely
    if (timestamps.length === 0) {
      delete requestTimestampsMap[provider];
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

