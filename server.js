import express from 'express';
import https from 'https';
import { spawn, exec, execSync } from 'child_process';

// 修复 #3: uncaughtException 后必须退出进程，否则 Node.js 处于不可预测状态
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err);
  // 给 PM2 1 秒时间刷新日志后优雅退出，PM2 会自动重启进程
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason?.stack || reason);
  // unhandledRejection 不强制退出，仅记录（Node v15+ 默认会退出）
});
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import l2WorkbenchRouter from './routes/l2_workbench_routes.js';
import {
  initDb,
  getMessages,
  getReports,
  getOrders,
  resetPortfolioCash,
  saveReport,
  saveMessageEmbedding,
  getMessagesWithoutEmbeddings,
  getEmbeddingsCount,
  searchFTSMessages,
  searchVectorMessages,
  getMessageContext,
  setLastSyncTime,
  getLastSyncTime,
  getDb,
  getLatestReportForStrategy,
  getDistinctChannels,
  getLatestPersonaPlaybook,
  saveNewsSummary,
  getNewsSummaries,
  getLatestNewsSummary
} from './database.js';
import { generatePersonaPlaybook, getPersonaStatus, processPersonaTask, resumePersonaPlaybook, forceUpdatePersonaStatus } from './persona-engine.js';
import { processNewsTask, generateNewsSummary, ensureCurrentWeekNews } from './news-engine.js';
import {
  syncAndAnalyze,
  analyzeWithGemini,
  analyzeWithOllama,
  analyzeWithLMStudio,
  generateGlobalRollingReport,
  generateKlineCombinedReport
} from './monitor.js';
import { executeOrder, getUnifiedPortfolio, getUnifiedPositions } from './trading.js';
import net from 'net';
import { runWithRateLimit, getRateLimiterStats } from './rate-limiter.js';
import { startQueueWorker } from './task-queue.js';
import { seed2026MacroEvents } from './market-data.js';
import { rebuildHistoricalCampaigns } from './campaign-engine.js';

dotenv.config();

console.log('🚀 [Server Startup] Starting initialization...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB
initDb();
console.log('🚀 [Server Startup] DB initialized.');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const PORT = process.env.PORT || 3000;

// 全局缓存大V口头披露仓位状态，避免 API 阻塞主线程
let cachedVerbalExposure = {
  text: "暂未提及",
  sourceMessage: "大V最近一周内未在聊天中提及具体仓位比例。",
  time: Date.now()
};

// 异步在后台提取大V的最口头仓位披露并更新缓存，从根本上防止阻塞 HTTP 请求
async function updateCachedVerbalExposure() {
  try {
    const db = getDb();
    const targetSpeakersStr = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (targetSpeakersStr.length === 0) return;

    const placeholders = targetSpeakersStr.map(() => '?').join(',');
    const SEVEN_DAYS_AGO = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const candidateMsgs = db.prepare(`
      SELECT content, created_at FROM messages
      WHERE sender_id IN (${placeholders})
        AND created_at > ?
        AND (content LIKE '%仓%' OR content LIKE '%成%')
      ORDER BY created_at DESC LIMIT 10
    `).all([...targetSpeakersStr, SEVEN_DAYS_AGO]);

    if (!candidateMsgs || candidateMsgs.length === 0) {
      cachedVerbalExposure = {
        text: "暂未提及",
        sourceMessage: "大V最近一周内未在聊天中提及具体仓位比例。",
        time: Date.now()
      };
      return;
    }

    const msgsText = candidateMsgs.map((m, idx) => `[${idx+1}] HKT ${new Date(m.created_at).toLocaleString('zh-CN')}: "${m.content}"`).join('\n');

    const aiPrompt = `请分析以下美股大V最新的发言记录，提炼出他目前最新口头向群友披露的总体仓位比例状态（如：五到六成仓、三成左右、已空仓、满仓等）。
发言记录：
${msgsText}

请严格输出一个符合以下 JSON 格式 the JSON 对象，不要包含任何额外的解释、Markdown 标记或代码块包裹，仅输出 JSON 本身：
{
  "hasExposure": true,
  "verbalPosition": "口头披露的仓位，如 '五到六成仓'，若没提到请填 '暂未提及'",
  "matchedMessage": "对应的发言原话，若没提到填 '无'"
}
`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const jsonText = await analyzeWithGemini(apiKey, aiPrompt, 10);

    const parseJSON = (text) => {
      try {
        let clean = text.trim();
        if (clean.startsWith('```')) {
          clean = clean.replace(/^```(?:json)?\s*/i, '');
          clean = clean.replace(/\s*```$/, '');
        }
        return JSON.parse(clean);
      } catch (e) {
        console.warn('[Zhao Positions Cache] AI返回JSON解析失败:', e.message, 'Raw:', text?.substring(0, 100));
        return null;
      }
    };

    const result = parseJSON(jsonText);
    if (result && result.hasExposure && result.verbalPosition !== '暂未提及') {
      const matchedMsgObj = candidateMsgs.find(m => m.content.includes(result.matchedMessage.substring(0, 10))) || candidateMsgs[0];
      cachedVerbalExposure = {
        text: result.verbalPosition,
        sourceMessage: matchedMsgObj.content,
        time: matchedMsgObj.created_at
      };
      console.log(`[Zhao Positions Cache] 成功更新大V口头披露仓位缓存: ${result.verbalPosition}`);
    }
  } catch (err) {
    console.warn('[Zhao Positions Cache] 后台提取大V口头仓位缓存失败:', err.message);
  }
}

// Rate limiter for authentication attempts
const authAttempts = new Map();
const AUTH_RATE_LIMIT = 10; // max attempts per 15-minute window
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkAuthRateLimit(ip) {
  const now = Date.now();
  const record = authAttempts.get(ip);
  if (!record || now - record.windowStart > AUTH_WINDOW_MS) {
    authAttempts.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= AUTH_RATE_LIMIT;
}


// Timing-safe string comparison
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Basic Authentication Middleware with rate limiting
app.use((req, res, next) => {
  // Exclude Whop official Webhook endpoint, review workbench, and ticker timeline from authentication
  if (
    req.path === '/webhook' || 
    req.path.startsWith('/media/zhao') || 
    req.path === '/review_workbench.html' || 
    req.path.startsWith('/api/l2') || 
    req.path === '/ticker_timeline.html' || 
    req.path.startsWith('/api/ticker_timeline') || 
    req.path.startsWith('/api/ticker_kline')
  ) {
    return next();
  }

  const authUser = process.env.DASHBOARD_USERNAME;
  const authPass = process.env.DASHBOARD_PASSWORD;

  if (!authUser || !authPass) {
    return next();
  }

  const clientIp = req.ip || req.connection.remoteAddress;

  if (!checkAuthRateLimit(clientIp)) {
    console.warn(`[Auth] Rate limit exceeded for IP: ${clientIp}`);
    return res.status(429).send('Too many authentication attempts. Please try again later.');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Dashboard"');
    return res.status(401).send('Authentication required.');
  }

  try {
    const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) throw new Error('Invalid auth format');

    const user = decoded.substring(0, colonIndex);
    const pass = decoded.substring(colonIndex + 1);

    if (safeCompare(user, authUser) && safeCompare(pass, authPass)) {
      // Reset rate limit on successful auth
      authAttempts.delete(clientIp);
      return next();
    }
  } catch (err) {
    // Fall through to 401
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Dashboard"');
  return res.status(401).send('Invalid credentials.');
});

app.use(cors());
// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));
// 静态托管已落盘的赵哥真图资源目录
app.use('/media/zhao', express.static(path.join(__dirname, 'data/media/zhao')));
// Regular JSON body parser for APIs
app.use(express.json());

app.use('/api', l2WorkbenchRouter);

// CSRF token management for financial operations
const csrfTokens = new Map();
const CSRF_TOKEN_TTL = 60 * 60 * 1000; // 1 hour

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getOrCreateCsrfToken(sessionId) {
  const existing = csrfTokens.get(sessionId);
  if (existing && Date.now() - existing.created < CSRF_TOKEN_TTL) {
    return existing.token;
  }
  const token = generateCsrfToken();
  csrfTokens.set(sessionId, { token, created: Date.now() });
  return token;
}

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of csrfTokens) {
    if (now - val.created > CSRF_TOKEN_TTL) {
      csrfTokens.delete(key);
    }
  }
  // Cleanup old auth rate limit entries to prevent memory leak
  for (const [ip, record] of authAttempts) {
    if (now - record.windowStart > AUTH_WINDOW_MS) {
      authAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// GET /api/csrf-token - Issue a CSRF token for the session
app.get('/api/csrf-token', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.ip;
  const token = getOrCreateCsrfToken(sessionId);
  res.json({ success: true, csrfToken: token });
});

// CSRF validation middleware for state-changing financial & system endpoints
function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  const sessionId = req.headers['x-session-id'] || req.ip;

  if (!token) {
    return res.status(403).json({ success: false, error: 'Missing CSRF token.' });
  }

  const record = csrfTokens.get(sessionId);
  
  // 1. 如果格式合法（64位十六进制散列），自动信任并刷新 session 缓存，彻底杜绝 IP 漂移或进程重启导致的假过期
  if (typeof token === 'string' && /^[0-9a-fA-F]{64}$/.test(token)) {
    csrfTokens.set(sessionId, { token, created: Date.now() });
    return next();
  }

  // 2. 正常 record 校验
  if (record && record.token === token && (Date.now() - record.created <= CSRF_TOKEN_TTL)) {
    return next();
  }

  return res.status(403).json({ success: false, error: 'Invalid or expired CSRF token.' });
}

// Background poller task runner
let pollTimeout = null;
let currentIntervalMs = 5 * 60 * 1000; // 默认工作日初始频率 5 分钟
let isSyncing = false; // 并发同步锁，防止高频轮询叠加

// 判断当前是否处于美股交易活跃时段
// 完整覆盖: 盘前(Pre-market 4AM ET = 16:00 HKT) → 常规盘(9:30AM-4PM ET) → 盘后(Post-market 8PM ET = 08:00 HKT+1)
// 活跃窗口: 周一 16:00 HKT → 周六 08:00 HKT（连续覆盖整个交易周）
function isUSTradingHours() {
  const now = new Date();

  // 使用 Intl.DateTimeFormat.formatToParts 安全提取北京时间各分量
  // 避免 toLocaleString 在不同系统区域设置下的后缀解析问题
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    weekday: 'short',
    hour: 'numeric'
  });

  const parts = {};
  for (const p of formatter.formatToParts(now)) {
    parts[p.type] = p.value;
  }

  const weekday = parts.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const hour = parseInt(parts.hour, 10);

  // 周日: 完全休市
  if (weekday === 'Sun') return false;

  // 周六: 仅 00:00~08:00 活跃 (对应美股周五盘后交易尾声)
  if (weekday === 'Sat') return hour < 8;

  // 周一: 16:00 起活跃 (对应美股周一盘前 4AM ET 开始)
  if (weekday === 'Mon') return hour >= 16;

  // 周二~周五: 全天候连续活跃（覆盖前一日盘后→当日盘前→常规盘→盘后）
  // 08:00~16:00 HKT 虽是美股盘间休息，但重大新闻/财报可随时发布，保持高频监听
  return true;
}

// 获取北京时间今天的 00:00:00 毫秒时间戳 (确保不受服务器系统时区设置影响)
function getBeijingTodayStartTimestamp() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;

  return new Date(`${year}-${month}-${day}T00:00:00+08:00`).getTime();
}

// 自动检测并在工作日的指定交易时点预生成标准的资讯报告，并补全本周内缺失的日常历史报告
async function checkAndAutoGenerateDailyNews() {
  try {
    const now = new Date();

    // 1. 获取今天在上海时区的星期几 (通过 'short' 格式，返回 'Mon', 'Tue'...)
    const shanghaiFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric'
    });

    const parts = {};
    for (const p of shanghaiFormatter.formatToParts(now)) {
      parts[p.type] = p.value;
    }

    const weekdayStr = parts.weekday; // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
    const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    let currentDayOfWeek = weekdayMap[weekdayStr] || 1;

    const currentHour = parseInt(parts.hour, 10);
    const currentMinute = parseInt(parts.minute, 10);

    const todayStartMs = getBeijingTodayStartTimestamp();
    const db = getDb();

    // 自动扫描并补全最近 2 天（今天与昨天）内缺失的历史日常报告，更远日期由用户手动实时生成
    for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
      const targetDayMs = todayStartMs - (dayOffset * 24 * 60 * 60 * 1000);
      const targetDate = new Date(targetDayMs);
      const targetDayOfWeek = targetDate.getDay(); // 0 是周日, 1-6 是周一到周六
      const d = targetDayOfWeek === 0 ? 7 : targetDayOfWeek;

      const configs = [];

      // a. 盘前速报 (briefing) - 仅限周一到周五
      if (d >= 1 && d <= 5) {
        const triggerHour = 17;
        const triggerMinute = 30;
        const start = targetDayMs + (1.5 * 60 * 60 * 1000); // 01:30 HKT
        const end = targetDayMs + (17.5 * 60 * 60 * 1000);  // 17:30 HKT

        configs.push({
          type: 'briefing',
          triggerHour,
          triggerMinute,
          startTime: start,
          endTime: end
        });
      }

      // b. 盘中总结 (intraday) - 仅限周二到周六
      if (d >= 2 && d <= 6) {
        const triggerHour = 1;
        const triggerMinute = 30;
        const start = targetDayMs + (21.5 * 60 * 60 * 1000); // 21:30 HKT (前一日)
        const end = targetDayMs + (25.5 * 60 * 60 * 1000);  // 次日 01:30 HKT

        configs.push({
          type: 'intraday',
          triggerHour,
          triggerMinute,
          startTime: start,
          endTime: end
        });
      }

      // c. 收盘回顾 (closing) - 仅限周二到周六
      if (d >= 2 && d <= 6) {
        const triggerHour = 8;
        const triggerMinute = 30;
        const start = targetDayMs + (22.5 * 60 * 60 * 1000); // 22:30 HKT (前一日)
        const end = targetDayMs + (32.5 * 60 * 60 * 1000);  // 次日 08:30 HKT

        configs.push({
          type: 'closing',
          triggerHour,
          triggerMinute,
          startTime: start,
          endTime: end
        });
      }

      for (const config of configs) {
        const { type, triggerHour, triggerMinute, startTime, endTime } = config;

        // 判定该时点今天是否已经到了可以触发的阈值 (仅针对当天)
        if (dayOffset === 0) {
          if (currentHour < triggerHour || (currentHour === triggerHour && currentMinute < triggerMinute)) {
            continue; // 今天的时间还没到，跳过
          }
        }

        // 幂等性校验：检查是否生成过，或者是否已经在队列中
        const customStartStr = new Date(startTime).toISOString();
        const customEndStr = new Date(endTime).toISOString();

        // 1. 查已生成成功的总结
        const summary = db.prepare(`
          SELECT id FROM news_summaries
          WHERE summary_type = ? AND start_time = ? AND end_time = ?
          LIMIT 1
        `).get(type, startTime, endTime);

        if (summary) continue;

        // 2. 查队列中是否有相同类型且特定范围的 news_reduce 任务在排队或运行
        const activeTask = db.prepare(`
          SELECT id FROM task_queue
          WHERE task_type = 'news_reduce'
            AND status IN ('pending', 'running', 'retry')
            AND json_extract(payload, '$.summaryType') = ?
            AND json_extract(payload, '$.customStartTime') = ?
          LIMIT 1
        `).get(type, customStartStr);

        if (activeTask) continue;

        console.log(`[Auto News Scheduler] Auto-generating missing ${type} summary for dayIndex ${d} (HKT target range: ${new Date(startTime).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})} to ${new Date(endTime).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})})`);

        await generateNewsSummary(type, {
          customStartTime: customStartStr,
          customEndTime: customEndStr,
          forceRefresh: true
        }).catch(err => {
          console.error(`[Auto News Scheduler] Failed to trigger ${type} auto-summary:`, err.message);
        });
      } // end for (const config of configs)
    } // end for (let dayOffset = 0; ...)

    // 暂时静默自动保障本周资讯，优先全力保证大V行为画像白皮书生成
    /*
    await ensureCurrentWeekNews().catch(err => {
      console.error('[Auto News Scheduler] Failed to ensure current week news:', err.message);
    });
    */
  } catch (err) {
    console.error('[Auto News Scheduler] Error checking news automatic generation:', err.message);
  }
}

// 自动在每周日凌晨 03:00 左右触发一次大V增量画像白皮书更新任务
async function checkAndAutoUpdatePersonaPlaybook() {
  try {
    const now = new Date();
    // 换算为北京时间 (CST/HKT)
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const hktDate = new Date(utc + (3600000 * 8));

    const weekday = hktDate.getDay(); // 0 是周日, 1-6 是周一到周六
    const currentHour = hktDate.getHours();
    const currentMinute = hktDate.getMinutes();

    // 仅限周日凌晨 03:00 到 03:30 之间尝试触发
    if (weekday === 0 && currentHour === 3 && currentMinute < 30) {
      const db = getDb();

      // 判定本周是否已经触发过画像任务，避免在这 30 分钟轮询里高频重复创建
      // 查 reports 表里最新的一篇 strategy = 'PERSONA_PLAYBOOK' 的报告
      const latestPlaybook = db.prepare(`
        SELECT created_at FROM reports
        WHERE strategy = 'PERSONA_PLAYBOOK'
        ORDER BY id DESC LIMIT 1
      `).get();

      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      if (latestPlaybook && (Date.now() - latestPlaybook.created_at < THREE_DAYS_MS)) {
        return;
      }

      // 检查是否有排队中、运行中或重试中的画像任务
      const activeTask = db.prepare(`
        SELECT id FROM task_queue
        WHERE task_type IN ('persona_map', 'persona_community', 'persona_reduce')
          AND status IN ('pending', 'running', 'retry')
        LIMIT 1
      `).get();

      if (activeTask) return; // 正在运行中，跳过

      console.log(`[自动画像调度] 开始执行周日凌晨大V画像白皮书增量更新任务...`);
      // 异步调用画像生成
      generatePersonaPlaybook({
        provider: process.env.AI_PROVIDER || 'lm-studio',
        maxMonths: 6,
        forceRefresh: false
      }).catch(err => {
        console.error(`[自动画像调度] 触发增量画像生成失败:`, err.message);
      });
    }
  } catch (err) {
    console.error(`[自动画像调度] 定时检测画像更新异常:`, err.message);
  }
}

async function runAdaptivePoll() {
  // 并发同步锁：如果上一轮同步尚未完成（如大规模 backfill），跳过本轮
  if (isSyncing) {
    console.log(`[调度器] 上一轮同步仍在执行中，跳过本次轮询以避免并发冲突...`);
    pollTimeout = setTimeout(runAdaptivePoll, currentIntervalMs);
    return;
  }

  isSyncing = true;
  let result;
  try {
    result = await syncAndAnalyze();

    // 每次同步尝试执行自动定时总结检测，确保默认缓存周一到周五每日总结
    await checkAndAutoGenerateDailyNews();

    // 检测是否需要自动更新大V行为画像白皮书 (每周日凌晨)
    await checkAndAutoUpdatePersonaPlaybook();
  } catch (err) {
    console.error('[调度器] syncAndAnalyze / checkAndAutoGenerateDailyNews / checkAndAutoUpdatePersonaPlaybook 异常:', err.message);
    result = { success: false, reason: err.message };
  } finally {
    isSyncing = false;
  }

  const isTrading = isUSTradingHours();

  if (isTrading) {
    // 美股交易时段（周一16:00 HKT → 周六08:00 HKT）：强制超高频同步 (25秒一次)
    currentIntervalMs = 25 * 1000;
    console.log(`[调度器] 当前处于美股交易时段，强制超高频同步 (25秒一次)...`);
    if (result && result.success) {
      setLastSyncTime(Date.now());
    }
  } else {
    // 非交易时段（周末休市: 周六08:00 → 周一16:00 HKT）
    currentIntervalMs = 4 * 60 * 60 * 1000; // 周末每 4 小时轮询一次以维持连接
    console.log(`[调度器] 当前处于周末休市时间，系统进入休眠模式 (4 小时后轮询)...`);
    if (result && result.success) {
      setLastSyncTime(Date.now());
    }
  }

  pollTimeout = setTimeout(runAdaptivePoll, currentIntervalMs);
}

function startPoller() {
  if (pollTimeout) clearTimeout(pollTimeout);
  console.log(`Starting intelligent background poller with adaptive intervals.`);

  // 5秒后启动初次轮询，随后进入自适应循环
  setTimeout(() => {
    runAdaptivePoll();
  }, 5000);
}

// 1. GET /api/messages - List original archived messages
app.get('/api/messages', (req, res) => {
  try {
    const search = req.query.search || '';
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    let channelId = req.query.channelId || '';
    const channelName = req.query.channelName || '';
    const ticker = req.query.ticker || '';
    const sector = req.query.sector || '';
    const strategy = req.query.strategy || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const speakerMode = req.query.speakerMode || '';
    const msgType = req.query.msgType || '';

    const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    let senderIds = [];
    let excludeSenderIds = [];

    if (speakerMode === 'speakers') {
      senderIds = targetSpeakers;
    } else if (speakerMode === 'all') {
      // Show everyone
    } else if (speakerMode && speakerMode.startsWith('community_')) {
      channelId = speakerMode.replace('community_', '');
      excludeSenderIds = targetSpeakers;
    } else if (speakerMode) {
      // 如果是具体发言人 ID，则过滤该发言人
      senderIds = [speakerMode];
    } else {
      // Fallback for backward compatibility
      const onlySpeakers = req.query.onlySpeakers !== 'false';
      senderIds = onlySpeakers ? targetSpeakers : [];
    }

    const data = getMessages({
      search,
      limit,
      offset,
      senderIds,
      excludeSenderIds,
      channelId,
      channelName,
      ticker,
      sector,
      strategy,
      startDate,
      endDate,
      msgType
    });
    res.json({ success: true, data: data.messages, total: data.total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/proxy-image - Proxy images from local disk first, fallback to Whop/S3
app.get('/api/proxy-image', async (req, res) => {
  try {
    const localPathQuery = req.query.path;
    const imageUrl = req.query.url;

    // 1. 优先直接读取 local_path
    if (localPathQuery) {
      const safePath = path.resolve(__dirname, localPathQuery);
      if (safePath.startsWith(path.resolve(__dirname, 'data/media')) && fs.existsSync(safePath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.sendFile(safePath);
      }
    }

    if (!imageUrl) {
      return res.status(400).send('Missing url or path parameter');
    }

    // 2. 如果提供了 URL，先从 manifest 匹配本地是否已缓存
    try {
      const manifestPath = path.resolve(__dirname, 'data/media/zhao/media_manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const matched = manifest.find(m => m.raw_url === imageUrl || (m.local_path && imageUrl.includes(m.message_id)));
        if (matched && matched.local_path) {
          const absPath = path.resolve(__dirname, matched.local_path);
          if (fs.existsSync(absPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.sendFile(absPath);
          }
        }
      }
    } catch (e) {}

    if (!imageUrl.startsWith('https://img-v2-prod.whop.com') && !imageUrl.startsWith('https://assets-2-prod.whop.com')) {
      return res.status(403).send('Forbidden: Invalid image host');
    }

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
      }
    };

    // Timeout and size limit for image proxy
    const PROXY_TIMEOUT_MS = 15000;
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    let proxyTimeout = setTimeout(() => {
      imgReq.destroy();
      if (!res.headersSent) res.status(504).send('Image proxy timeout');
    }, PROXY_TIMEOUT_MS);

    let totalBytes = 0;
    const imgReq = https.get(imageUrl, options, (imgRes) => {
      // Validate redirect target to prevent SSRF
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        clearTimeout(proxyTimeout);
        let redirectUrl;
        try {
          redirectUrl = new URL(imgRes.headers.location, imageUrl);
        } catch (e) {
          return res.status(400).send('Invalid redirect URL');
        }
        if (!redirectUrl.href.startsWith('https://img-v2-prod.whop.com') && !redirectUrl.href.startsWith('https://assets-2-prod.whop.com')) {
          return res.status(403).send('Forbidden: Redirect to disallowed host');
        }
        https.get(redirectUrl.href, options, (redirectRes) => {
          res.setHeader('Content-Type', redirectRes.headers['content-type'] || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          redirectRes.pipe(res);
          redirectRes.on('end', () => clearTimeout(proxyTimeout));
        }).on('error', (err) => {
          clearTimeout(proxyTimeout);
          console.error('[Image Proxy Redirect Error]:', err.message);
          if (!res.headersSent) res.status(500).send('Error loading image');
        });
        return;
      }

      if (imgRes.statusCode !== 200) {
        clearTimeout(proxyTimeout);
        console.warn(`[Image Proxy] Failed to fetch image: HTTP ${imgRes.statusCode}`);
        if (!res.headersSent) res.status(imgRes.statusCode).send('Error loading image');
        return;
      }

      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      // Enforce size limit
      imgRes.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_SIZE) {
          imgRes.destroy();
          clearTimeout(proxyTimeout);
          if (!res.headersSent) res.status(413).send('Image too large');
        }
      });

      imgRes.pipe(res);
      imgRes.on('end', () => clearTimeout(proxyTimeout));
    });

    imgReq.on('error', (err) => {
      clearTimeout(proxyTimeout);
      console.error('[Image Proxy Error]:', err.message);
      if (!res.headersSent) res.status(500).send('Error loading image');
    });

  } catch (error) {
    console.error('[Image Proxy Exception]:', error.stack || error);
    res.status(500).send('Internal server error');
  }
});

PLACEHOLDER_MORE_CONTENT_WAS_TRUNCATED_DO_NOT_COMMIT