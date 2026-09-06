import { getDailyApiCount, incrementDailyApiCount, getDb } from './database.js';
import { isGeminiKeyProtectError } from './ai-router-policy.js';

// 极度保守与珍惜 API 额度配置：Gemini 限制为 4 RPM (平均 15 秒才允许放行 1 次 API 请求，全局极低频调用)
const GEMINI_RPM_LIMIT = 4;
const GENERAL_RPM_LIMIT = 15;
const RPD_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT || '10000', 10);
const requestTimestampsMap = {}; // 按 provider 隔离的时间戳 map

// 全局 Gemini API 串行锁（保障同一时刻只有一个请求发往 Google 服务器，防止并发冲突）
let geminiGlobalLock = Promise.resolve();

// ⚡ 实时看板可视化：内存追踪正在进行的 API 调用 (恪守 R3 监测数据绝不写主库)
let nextApiCallId = 1;
const activeApiCalls = new Map();
const recentApiCalls = []; // 环形缓冲，保留最近 50 条
const MAX_RECENT_API_CALLS = 50;

export function getActiveApiCalls() {
  return Array.from(activeApiCalls.values());
}

export function getRecentApiCalls() {
  return [...recentApiCalls];
}

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
    const waitMs = 60000 - (now - oldestTimestamp) + 1000; // 额外增加 1000ms 强力安全缓冲区
    if (waitMs > 0) {
      console.log(`[Rate Limiter] 🛡️ 极低频保护: 触发 ${provider} 滑动窗口限速 (已满 ${timestamps.length}/${currentLimit})。静止挂起排队 ${waitMs}ms...`);
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

  // 1. 可剥夺抢占避让机制：如果是离线后台任务 (priority < 100)，且有 P0 实时 AI 任务 (priority >= 100) 在排队，强制让路避让
  if (priority < 100) {
    const MAX_YIELD_ROUNDS = 5;
    for (let yieldRound = 0; yieldRound < MAX_YIELD_ROUNDS; yieldRound++) {
      try {
        const db = getDb();
        // 检测是否有可立即执行的 P0 实时 AI 任务 (priority >= 100)
        const now = Date.now();
        const pendingRealtimeTask = db.prepare(`
          SELECT COUNT(*) as count FROM task_queue 
          WHERE status = 'pending' AND priority >= 100 AND (run_after IS NULL OR run_after <= ?)
        `).get(now);

        if (pendingRealtimeTask && pendingRealtimeTask.count > 0) {
          if (yieldRound === 0) {
            console.log(`[Rate Limiter] ⚡ 抢占触发: 检测到有 ${pendingRealtimeTask.count} 个 P0 实时 AI 任务。P${priority} 离线任务让路避让 3s (第 ${yieldRound + 1}/${MAX_YIELD_ROUNDS} 轮)...`);
          }
          await sleep(3000);
        } else {
          break; // 没有实时 AI 任务排队了，恢复处理
        }
      } catch (dbErr) {
        console.warn(`[Rate Limiter] 查询实时任务抢占状态失败:`, dbErr.message);
        break;
      }
    }
  }

  // 2. 满足 RPM 限速（P0 实时 AI 任务 priority >= 100 豁免 RPM 强制等待，毫秒级直通）
  if (priority < 100) {
    await enforceRpmLimit(provider);
  }

  // 3. 全局单任务串行锁：如果请求发往 Gemini，排队等待上一个 API 请求完全接收并关闭后才放行下一个！
  if (provider.includes('gemini')) {
    let unlocker;
    const nextLock = new Promise(resolve => { unlocker = resolve; });
    const currentLock = geminiGlobalLock;
    geminiGlobalLock = nextLock;

    await currentLock; // 排队等待前一个 Gemini 请求完成
    
    // 执行完后释放给下一个
    setTimeout(unlocker, 2000); // 请求完成后再额外拉开 2 秒的绝对静息缝隙
  }
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

    // ⚡ 实时看板可视化：内存追踪 Gemini API 运行状态 (绝不写主库 task_queue)
    const callId = `api_${Date.now()}_${nextApiCallId++}`;
    const startTime = Date.now();
    activeApiCalls.set(callId, {
      id: callId,
      task_type: 'gemini_api_cloud',
      priority: priority || 0,
      status: 'running',
      provider,
      attempt: attempt + 1,
      dailyCount,
      created_at: startTime,
      updated_at: startTime
    });

    try {
      const result = await apiCallFn();
      const entry = activeApiCalls.get(callId);
      if (entry) {
        entry.status = 'done';
        entry.updated_at = Date.now();
        recentApiCalls.unshift(entry);
        if (recentApiCalls.length > MAX_RECENT_API_CALLS) recentApiCalls.pop();
      }
      activeApiCalls.delete(callId);
      return result;
    } catch (err) {
      activeApiCalls.delete(callId);
      const isHardQuotaError = err.message.toLowerCase().includes('quota exceeded') || err.message.includes('RESOURCE_EXHAUSTED');
      
      // 若为配额用尽类错误，重试无用，直接抛出供上层自动降级至本地大模型
      if (isHardQuotaError || isGeminiKeyProtectError(err)) {
        console.warn(`[Rate Limiter] Gemini 429/401/invalid 或配额耗尽 — 不重试、不轮询下一把 Key，交由上层降级本地 14B: ${err.message}`);
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

