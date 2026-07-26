import express from 'express';
import https from 'https';
import { spawn, exec, execSync } from 'child_process';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason?.stack || reason);
});
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
import { processNewsTask, generateNewsSummary } from './news-engine.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB
initDb();
seed2026MacroEvents().catch(err => console.error('[Startup] Failed to seed macro events:', err.message));

// Rebuild campaigns if empty
const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

for (const speaker of targetSpeakers) {
  const dbInstance = getDb();
  const count = dbInstance.prepare("SELECT COUNT(*) as count FROM campaigns WHERE influencer_id = ?").get(speaker)?.count || 0;
  if (count === 0) {
    console.log(`[Startup] Campaigns table empty for speaker ${speaker}. Rebuilding historical campaigns...`);
    rebuildHistoricalCampaigns(speaker).catch(err => console.error(`[Startup] Rebuilding campaigns failed:`, err.message));
  }
}

const app = express();
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
      let clean = text.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*/i, '');
        clean = clean.replace(/\s*```$/, '');
      }
      return JSON.parse(clean);
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
const AUTH_RATE_LIMIT = 10; // max attempts per window
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
  // Exclude Whop official Webhook endpoint from authentication
  if (req.path === '/webhook') {
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
// Regular JSON body parser for APIs
app.use(express.json());

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
}, 5 * 60 * 1000);

// GET /api/csrf-token - Issue a CSRF token for the session
app.get('/api/csrf-token', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.ip;
  const token = getOrCreateCsrfToken(sessionId);
  res.json({ success: true, csrfToken: token });
});

// CSRF validation middleware for state-changing financial endpoints
function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  const sessionId = req.headers['x-session-id'] || req.ip;
  
  if (!token) {
    return res.status(403).json({ success: false, error: 'Missing CSRF token.' });
  }
  
  const record = csrfTokens.get(sessionId);
  if (!record || record.token !== token || Date.now() - record.created > CSRF_TOKEN_TTL) {
    return res.status(403).json({ success: false, error: 'Invalid or expired CSRF token.' });
  }
  
  next();
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
      }
    }
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
      
      console.log(`[Auto Persona Scheduler] 开始执行周日凌晨大V画像白皮书增量更新任务...`);
      // 异步调用画像生成
      generatePersonaPlaybook({
        provider: process.env.AI_PROVIDER || 'lm-studio',
        maxMonths: 6,
        forceRefresh: false
      }).catch(err => {
        console.error(`[Auto Persona Scheduler] 触发增量画像生成失败:`, err.message);
      });
    }
  } catch (err) {
    console.error(`[Auto Persona Scheduler] 定时检测画像更新异常:`, err.message);
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
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
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

// GET /api/proxy-image - Proxy images from Whop/S3 to avoid CORS/GFW/Expiration issues
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('Missing url parameter');
    }

    if (!imageUrl.startsWith('https://img-v2-prod.whop.com') && !imageUrl.startsWith('https://assets-2-prod.whop.com')) {
      return res.status(403).send('Forbidden: Invalid image host');
    }

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
      }
    };

    const imgReq = https.get(imageUrl, options, (imgRes) => {
      // Forward status code (handle redirects if any)
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        // Follow redirect once
        https.get(imgRes.headers.location, options, (redirectRes) => {
          res.setHeader('Content-Type', redirectRes.headers['content-type'] || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          redirectRes.pipe(res);
        }).on('error', (err) => {
          console.error('[Image Proxy Redirect Error]:', err.message);
          res.status(500).send('Error loading image');
        });
        return;
      }

      if (imgRes.statusCode !== 200) {
        console.warn(`[Image Proxy] Failed to fetch image: HTTP ${imgRes.statusCode}`);
        return res.status(imgRes.statusCode).send('Error loading image');
      }

      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      imgRes.pipe(res);
    });

    imgReq.on('error', (err) => {
      console.error('[Image Proxy Error]:', err.message);
      res.status(500).send('Error loading image');
    });

  } catch (error) {
    console.error('[Image Proxy Exception]:', error.stack || error);
    res.status(500).send('Internal server error');
  }
});

// 1.2 GET /api/channels - List unique channels in the archive database
app.get('/api/channels', (req, res) => {
  try {
    const channels = getDistinctChannels();
    res.json({ success: true, data: channels });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1.3 GET /api/speakers - List unique speakers/senders in the archive database
app.get('/api/speakers', (req, res) => {
  try {
    const db = getDb();
    
    // 获取所有的 targetSpeakers
    const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
      
    const rows = db.prepare(`
      SELECT DISTINCT sender_id, sender_name 
      FROM messages 
      WHERE sender_name IS NOT NULL AND sender_name != ''
      ORDER BY sender_name ASC
    `).all();
    
    // 过滤掉大V，剩下的是群友（大V已经有独立的“只看大V”选项了）
    const communitySpeakers = rows.filter(r => !targetSpeakers.includes(r.sender_id));
    
    res.json({ success: true, speakers: communitySpeakers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1.5 GET /api/messages/:id/context - Get context messages for a specific message
app.get('/api/messages/:id/context', (req, res) => {
  try {
    const messageId = req.params.id;
    const limit = parseInt(req.query.limit || '10', 10);
    const data = getMessageContext({ messageId, limit });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. GET /api/reports - List AI reports
app.get('/api/reports', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    const data = getReports({ limit, offset });
    res.json({ success: true, data: data.reports, total: data.total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. POST /api/sync - Legacy general manual trigger sync (redirects to realtime)
app.post('/api/sync', requireCsrf, async (req, res) => {
  try {
    console.log('Manual sync triggered (fallback)');
    const result = await syncAndAnalyze({ backfill: false, skipTrades: false, skipWeChat: false, skipReport: false });
    if (result && result.success) {
      setLastSyncTime(Date.now());
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/sync/realtime - Fast realtime sync with copy-trading and notifications
app.post('/api/sync/realtime', requireCsrf, async (req, res) => {
  try {
    console.log('Real-time sync triggered by Web UI');
    const result = await syncAndAnalyze({ backfill: false, skipTrades: false, skipWeChat: false, skipReport: false });
    if (result && result.success) {
      setLastSyncTime(Date.now());
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/sync/archive - Deep backfill for RAG archiving (no trades, no WeChat alerts)
app.post('/api/sync/archive', requireCsrf, async (req, res) => {
  try {
    console.log('Deep historical archive sync triggered by Web UI');
    const result = await syncAndAnalyze({ backfill: true, skipTrades: true, skipWeChat: true, skipReport: true });
    if (result && result.success) {
      setLastSyncTime(Date.now());
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/reports/global-rolling - Incremental rolling global briefing report
app.post('/api/reports/global-rolling', requireCsrf, async (req, res) => {
  try {
    console.log('Global rolling report generation triggered by Web UI');
    const provider = process.env.AI_PROVIDER || 'gemini';
    const result = await generateGlobalRollingReport(provider);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/reports/kline-combined - K-line technical analysis combined report
app.post('/api/reports/kline-combined', requireCsrf, async (req, res) => {
  try {
    console.log('Kline-combined report generation triggered by Web UI');
    const provider = process.env.AI_PROVIDER || 'gemini';
    const result = await generateKlineCombinedReport(provider);
    res.json(result);
  } catch (error) {
    console.error('[Kline Report Error]', error.message);
    res.status(500).json({ success: false, reason: error.message });
  }
});

// === Persona Playbook Endpoints ===

// 1. POST /api/persona/generate - Trigger persona playbook generation
app.post('/api/persona/generate', requireCsrf, async (req, res) => {
  try {
    const provider = req.body.provider || process.env.AI_PROVIDER || 'lm-studio';
    const maxMonths = parseInt(req.body.maxMonths || '6', 10);
    const forceRefresh = req.body.forceRefresh === true;

    console.log(`[API Persona] Triggering playbook generation with provider=${provider}, maxMonths=${maxMonths}, forceRefresh=${forceRefresh}`);
    
    // 使用 setImmediate 彻底移出当前事件循环主线程，实现真正的毫秒级解耦返回，免受 SQLite 读写锁争用影响
    setImmediate(() => {
      generatePersonaPlaybook({ provider, maxMonths, forceRefresh }).catch(err => {
        console.error('[API Persona] Asynchronous generation failed:', err.message);
      });
    });

    res.json({ success: true, message: '大V行为画像生成任务启动成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. GET /api/persona/status - Get current persona playbook generation status
app.get('/api/persona/status', (req, res) => {
  try {
    const status = getPersonaStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. GET /api/persona/latest - Get the latest generated playbook report
app.get('/api/persona/latest', (req, res) => {
  try {
    const playbook = getLatestPersonaPlaybook();
    if (playbook) {
      res.json({ success: true, playbook });
    } else {
      res.json({ success: true, playbook: null });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. POST /api/persona/resume - Resume persona playbook generation
app.post('/api/persona/resume', requireCsrf, async (req, res) => {
  try {
    const result = resumePersonaPlaybook();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === News Summaries Endpoints ===

// 1. POST /api/news-summaries/generate - Trigger news/consulting summary generation
app.post('/api/news-summaries/generate', requireCsrf, async (req, res) => {
  try {
    const type = req.body.type || 'briefing';
    const forceRefresh = req.body.forceRefresh === true;
    const customStartTime = req.body.customStartTime || null;
    const customEndTime = req.body.customEndTime || null;

    console.log(`[API News] Triggering news summary generation for type=${type}, forceRefresh=${forceRefresh}, customStartTime=${customStartTime}, customEndTime=${customEndTime}`);
    
    const result = await generateNewsSummary(type, { 
      forceRefresh,
      customStartTime,
      customEndTime
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. GET /api/news-summaries/status - Get latest news summary generation status
app.get('/api/news-summaries/status', (req, res) => {
  try {
    const db = getDb();
    const latestTask = db.prepare(`
      SELECT id, status, error_message, updated_at FROM task_queue 
      WHERE task_type = 'news_reduce'
      ORDER BY id DESC LIMIT 1
    `).get();

    if (latestTask) {
      res.json({
        success: true,
        status: latestTask.status,
        error: latestTask.error_message,
        updatedAt: latestTask.updated_at
      });
    } else {
      res.json({
        success: true,
        status: 'idle',
        error: null,
        updatedAt: null
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. GET /api/news-summaries - Get news summaries history list
app.get('/api/news-summaries', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const summaries = getNewsSummaries(limit, offset);
    res.json({ success: true, summaries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. GET /api/news-summaries/latest - Get the latest summary
app.get('/api/news-summaries/latest', (req, res) => {
  try {
    const type = req.query.type || null;
    const summary = getLatestNewsSummary(type);
    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === Campaign & Macro Events Endpoints ===

// === System Monitor & Task Queue Control Endpoints ===

// 1. GET /api/system/monitor - 获取大模型、GPU 锁、API 配额以及队列任务状态监控数据
app.get('/api/system/monitor', async (req, res) => {
  try {
    const db = getDb();

    // a. 获取 Rate Limiter 限额情况
    const rateLimiterStats = getRateLimiterStats();

    // b. 极速 Socket 检测本地大模型连接状态 (8080 端口)，限制在 150ms 内
    const checkLocalPort = (port, host) => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(150);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, host);
      });
    };
    const localModelConnected = await checkLocalPort(8080, '127.0.0.1');

    // c. 获取 GPU 锁状态
    const gpuLockStatus = global.gpuLock ? {
      isLocked: global.gpuLock.isLocked,
      owner: global.gpuLock.owner,
      acquiredAt: global.gpuLock.acquiredAt
    } : { isLocked: false, owner: null, acquiredAt: null };

    // d. 从 sqlite 中统计当前队列中的具体排队任务 (限制最大 50 条展示，防止数万条任务构建巨型 JSON 卡死浏览器)
    const activeTasksCount = db.prepare(`
      SELECT COUNT(*) as count FROM task_queue WHERE status IN ('running', 'pending', 'retry')
    `).get()?.count || 0;

    const activeTasks = db.prepare(`
      SELECT id, task_type, status, priority, error_message, updated_at 
      FROM task_queue 
      WHERE status IN ('running', 'pending', 'retry')
      ORDER BY priority DESC, id ASC
      LIMIT 50
    `).all();

    // e. 对任务类型进行优雅的中文意图转换描述
    const formattedTasks = activeTasks.map(t => {
      let desc = '未知系统任务';
      if (t.task_type.startsWith('persona_')) {
        desc = '🧠 大V行为画像白皮书重构分析';
      } else if (t.task_type.startsWith('news_')) {
        const subType = t.task_type.split('_')[1] || '';
        const subMap = { briefing: '盘前速报', intraday: '盘中总结', closing: '收盘回顾', macro: '宏观周报' };
        desc = `📅 社区资讯速报生成 (${subMap[subType] || subType})`;
      } else if (t.task_type.startsWith('trade_')) {
        desc = '💼 赵哥历史跟单订单提炼与对账';
      }
      return {
        id: t.id,
        taskType: t.task_type,
        status: t.status,
        priority: t.priority,
        description: desc,
        updatedAt: t.updated_at
      };
    });

    // 新增：获取最近完成/失败的历史任务 (最近 15 条)
    const completedTasks = db.prepare(`
      SELECT id, task_type, status, priority, error_message, updated_at 
      FROM task_queue 
      WHERE status IN ('done', 'failed')
      ORDER BY updated_at DESC, id DESC
      LIMIT 15
    `).all();

    const formattedHistory = completedTasks.map(t => {
      let desc = '未知系统任务';
      if (t.task_type.startsWith('persona_')) {
        desc = '🧠 大V行为画像分析';
      } else if (t.task_type.startsWith('news_')) {
        const subType = t.task_type.split('_')[1] || '';
        const subMap = { briefing: '盘前速报', intraday: '盘中总结', closing: '收盘回顾', macro: '宏观周报' };
        desc = `📅 社区资讯速报 (${subMap[subType] || subType})`;
      } else if (t.task_type.startsWith('trade_')) {
        desc = '💼 赵哥历史跟单提炼';
      }
      return {
        id: t.id,
        taskType: t.task_type,
        status: t.status,
        priority: t.priority,
        description: desc,
        errorMessage: t.error_message,
        updatedAt: t.updated_at
      };
    });

    // 统计消息表中还有多少条 is_traded = 0 的大V消息等待跟单引擎提炼
    const pendingTradeMsgsCount = db.prepare(`
      SELECT COUNT(*) as count FROM messages 
      WHERE is_traded = 0
    `).get()?.count || 0;

    res.json({
      success: true,
      data: {
        localModelConnected,
        rateLimiterStats,
        gpuLockStatus,
        activeTasks: formattedTasks,
        activeTasksCount,
        completedTasks: formattedHistory,
        pendingTradeMsgsCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/task-queue/clear - 强制取消当前所有或特定分类的计算/排队中任务
app.post('/api/task-queue/clear', requireCsrf, (req, res) => {
  try {
    const db = getDb();
    const type = req.query.type || 'all';
    let changes = 0;
    
    if (type === 'persona') {
      const info = db.prepare(`
        UPDATE task_queue 
        SET status = 'failed', error_message = '用户手动取消了任务' 
        WHERE task_type LIKE 'persona_%'
          AND status IN ('pending', 'running', 'retry')
      `).run();
      changes = info.changes;
      forceUpdatePersonaStatus('idle', '已取消后台画像生成。', 0);
    } else if (type === 'news') {
      const info = db.prepare(`
        UPDATE task_queue 
        SET status = 'failed', error_message = '用户手动取消了任务' 
        WHERE task_type LIKE 'news_%'
          AND status IN ('pending', 'running', 'retry')
      `).run();
      changes = info.changes;
    } else {
      const info = db.prepare(`
        UPDATE task_queue 
        SET status = 'failed', error_message = '用户手动取消了全部任务' 
        WHERE status IN ('pending', 'running', 'retry')
      `).run();
      changes = info.changes;
      forceUpdatePersonaStatus('idle', '已取消后台画像生成。', 0);
    }
    
    res.json({ success: true, message: `成功强制取消并中断了 ${changes} 个后台排队计算任务。` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Local Model Tunnel Management ===

let localModelTunnelProcess = null;

// 3. POST /api/system/local-model/start - 启动本地大模型 SSH 反向隧道
app.post('/api/system/local-model/start', requireCsrf, async (req, res) => {
  try {
    // 检查端口是否已被占用（说明隧道可能已在运行）
    const isUp = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(200);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(8080, '127.0.0.1');
    });

    if (isUp) {
      return res.json({ success: true, connected: true, message: '本地模型 (8080) 已处于连接状态，无需重复启动。' });
    }

    // 先清理残留的僵尸进程
    try { execSync('fuser -k 8080/tcp 2>/dev/null || true', { timeout: 3000 }); } catch(e) {}

    // 获取隧道启动命令（可通过 .env 覆盖）
    // 默认：SSH 反向隧道，VM 反连到本地 Windows 的 LM Studio (8080端口)
    // 需要在本地 Windows 上先开放 SSH 服务（WSL2 端口可通过 Windows 宿主机 IP 直达）
    const tunnelCmd = process.env.LOCAL_MODEL_TUNNEL_CMD || null;

    if (!tunnelCmd) {
      return res.json({ 
        success: false, 
        connected: false, 
        message: '未配置 LOCAL_MODEL_TUNNEL_CMD 环境变量。请在 .env 中设置隧道启动命令，或从本地 Windows 运行 SSH 反向隧道命令。',
        hint: `在本地 Windows PowerShell 中运行：\nssh -i C:\\Users\\86597\\.ssh\\stable_key -R 8080:localhost:8080 -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes wikitang628@35.212.142.173`
      });
    }

    console.log(`[Local Model] 正在执行隧道启动命令: ${tunnelCmd}`);
    
    // 使用 spawn 非阻塞启动隧道子进程
    localModelTunnelProcess = spawn('bash', ['-c', tunnelCmd], {
      detached: true,
      stdio: 'ignore'
    });
    localModelTunnelProcess.unref();

    localModelTunnelProcess.on('error', (err) => {
      console.error('[Local Model] 隧道进程启动失败:', err.message);
      localModelTunnelProcess = null;
    });

    localModelTunnelProcess.on('close', (code) => {
      console.log(`[Local Model] 隧道进程退出, code=${code}`);
      localModelTunnelProcess = null;
    });

    // 等待 3 秒后检测端口是否通了
    await new Promise(r => setTimeout(r, 3000));
    const connected = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(300);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(8080, '127.0.0.1');
    });

    res.json({ 
      success: true, 
      connected,
      message: connected 
        ? '🟢 本地大模型隧道建立成功！8080端口已就绪。' 
        : '⏳ 隧道命令已执行，但端口尚未响应。请稍后刷新检查。'
    });
  } catch (err) {
    console.error('[Local Model] Start error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/system/local-model/stop - 断开本地大模型隧道
app.post('/api/system/local-model/stop', requireCsrf, async (req, res) => {
  try {
    // 终止管理中的隧道子进程
    if (localModelTunnelProcess) {
      try { localModelTunnelProcess.kill('SIGTERM'); } catch(e) {}
      localModelTunnelProcess = null;
    }

    // 额外保险：强杀 8080 上的所有进程
    try { 
      execSync('fuser -k 8080/tcp 2>/dev/null || true', { timeout: 3000 }); 
    } catch(e) {}

    // 也杀掉可能残留的 SSH 隧道进程
    try {
      execSync("pkill -f 'ssh.*8080' 2>/dev/null || true", { timeout: 3000 });
    } catch(e) {}

    console.log('[Local Model] 本地大模型隧道连接已断开，8080端口进程已终止。');
    res.json({ success: true, message: '🔴 本地大模型连接已断开。8080端口进程已终止。' });
  } catch (err) {
    console.error('[Local Model] Stop error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zhao-positions - 获取大V（赵哥）当前持仓 Lots、历史已平仓记录及大V口头披露仓位状态
app.get('/api/zhao-positions', async (req, res) => {
  try {
    const db = getDb();
    
    // 1. 获取所有的成功订单，按时间升序排列，用以 FIFO 算法对冲仓位明细
    const orders = db.prepare(`
      SELECT * FROM orders 
      WHERE status = 'filled' OR status = 'completed' OR status = 'success' OR status = 'completed_fully'
      ORDER BY created_at ASC
    `).all();
    
    const positionsMap = {};
    const closedPositions = [];
    
    // 2. FIFO 仓位对冲计算引擎
    for (const ord of orders) {
      const ticker = ord.ticker.toUpperCase();
      const action = ord.action.toUpperCase();
      const price = ord.price;
      const qty = ord.quantity;
      
      if (action === 'BUY') {
        if (!positionsMap[ticker]) {
          positionsMap[ticker] = {
            ticker,
            lots: []
          };
        }
        positionsMap[ticker].lots.push({
          price,
          quantity: qty,
          time: ord.created_at,
          reason: ord.reason || '大V开仓/加仓'
        });
      } else if (action === 'SELL') {
        if (positionsMap[ticker]) {
          let sellQty = qty;
          let realizedPnLForThisSell = 0;
          let totalCostForThisSell = 0;
          
          while (sellQty > 0 && positionsMap[ticker].lots.length > 0) {
            const currentLot = positionsMap[ticker].lots[0];
            if (currentLot.quantity <= sellQty) {
              sellQty -= currentLot.quantity;
              totalCostForThisSell += currentLot.quantity * currentLot.price;
              realizedPnLForThisSell += currentLot.quantity * (price - currentLot.price);
              positionsMap[ticker].lots.shift(); 
            } else {
              currentLot.quantity -= sellQty;
              totalCostForThisSell += sellQty * currentLot.price;
              realizedPnLForThisSell += sellQty * (price - currentLot.price);
              sellQty = 0;
            }
          }
          
          if (positionsMap[ticker].lots.length === 0) {
            const finalPnlRatio = totalCostForThisSell > 0 ? (realizedPnLForThisSell / totalCostForThisSell) : 0;
            closedPositions.push({
              ticker,
              totalPnL: realizedPnLForThisSell,
              pnlRatio: finalPnlRatio,
              closeTime: ord.created_at
            });
            delete positionsMap[ticker];
          }
        }
      }
    }
    
    // 3. 对活跃持仓获取当前最新价格，计算未实现盈亏
    const activePositions = Object.values(positionsMap);
    const tickersList = activePositions.map(p => p.ticker);
    
    let marketPrices = {};
    if (tickersList.length > 0) {
      try {
        const context = await getMarketContextForTickers(tickersList);
        if (context && context.prices) {
          marketPrices = context.prices; 
        }
      } catch (priceErr) {
        console.warn('[Zhao Positions API] 无法获取市场实时现价，将使用成本均价退避:', priceErr.message);
      }
    }
    
    const formattedActivePositions = activePositions.map(pos => {
      const totalQuantity = pos.lots.reduce((sum, l) => sum + l.quantity, 0);
      const totalCost = pos.lots.reduce((sum, l) => sum + (l.quantity * l.price), 0);
      const averageCost = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;
      
      const currentPrice = marketPrices[pos.ticker] || averageCost; 
      const marketValue = totalQuantity * currentPrice;
      const unrealizedPnL = totalQuantity * (currentPrice - averageCost);
      const pnlRatio = averageCost > 0 ? (currentPrice - averageCost) / averageCost : 0;
      
      return {
        ticker: pos.ticker,
        totalQuantity,
        averageCost,
        currentPrice,
        marketValue,
        unrealizedPnL,
        pnlRatio,
        lots: pos.lots
      };
    });
    
    // 4. 【大V口头披露仓位状态提取】 — 直接读取后台缓存数据，实现接口毫秒级极速返回
    const verbalExposure = cachedVerbalExposure;
    
    // 5. 聚合战役的统计
    const activeCampaignsCount = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'").get()?.count || 0;
    const closedCampaignsCount = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'closed'").get()?.count || 0;
    
    res.json({
      success: true,
      data: {
        verbalExposure,
        currentPositions: formattedActivePositions,
        closedPositions,
        activeCampaignsCount,
        closedCampaignsCount
      }
    });
  } catch (err) {
    console.error('[Zhao Positions API] 获取失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/campaigns - Get all campaigns
app.get('/api/campaigns', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM campaign_messages WHERE campaign_id = c.id) as message_count
      FROM campaigns c
      ORDER BY c.open_time DESC
    `).all();
    res.json({ success: true, campaigns: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/campaigns/:id/messages - Get messages associated with a campaign
app.get('/api/campaigns/:id/messages', (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const db = getDb();
    
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, error: '战役未找到' });
    }
    
    const messages = db.prepare(`
      SELECT m.* 
      FROM messages m
      JOIN campaign_messages cm ON m.id = cm.message_id
      WHERE cm.campaign_id = ?
      ORDER BY m.created_at ASC
    `).all(campaignId);
    
    res.json({ success: true, campaign, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/macro-events - Get all macro events
app.get('/api/macro-events', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM macro_events 
      ORDER BY event_timestamp DESC
    `).all();
    res.json({ success: true, events: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 量化跟单与交易 API 路由
// ==========================================================================

// GET /api/quant/portfolio - 获取账户总资产、可用现金、持仓市值等统计数据
app.get('/api/quant/portfolio', async (req, res) => {
  try {
    const data = await getUnifiedPortfolio();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/quant/positions - 获取当前持仓明细
app.get('/api/quant/positions', async (req, res) => {
  try {
    const data = await getUnifiedPositions();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/quant/orders - 获取跟单订单历史记录
app.get('/api/quant/orders', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const data = getOrders({ limit, offset });
    res.json({ success: true, data: data.orders, total: data.total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/quant/reset - 重置沙盒模拟账户资金
app.post('/api/quant/reset', requireCsrf, (req, res) => {
  try {
    const amount = parseFloat(req.body.amount || '100000.00');
    resetPortfolioCash(amount);
    res.json({ success: true, message: `模拟账户已成功重置，初始资金为 $${amount.toFixed(2)}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/quant/trade - 手动下单（用于测试风控引擎和下单通道）
app.post('/api/quant/trade', requireCsrf, async (req, res) => {
  try {
    const { ticker, action, price, quantity, stopLoss, reason } = req.body;

    // Validate required parameters
    if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
      return res.status(400).json({ success: false, error: '缺少或无效的 ticker 参数' });
    }
    if (!action || !['BUY', 'SELL'].includes(action.toUpperCase())) {
      return res.status(400).json({ success: false, error: 'action 参数必须为 BUY 或 SELL' });
    }
    const parsedPrice = parseFloat(price);
    if (!parsedPrice || parsedPrice <= 0 || !isFinite(parsedPrice)) {
      return res.status(400).json({ success: false, error: 'price 参数必须为正数' });
    }
    const parsedQty = parseInt(quantity, 10);
    if (!parsedQty || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
      return res.status(400).json({ success: false, error: 'quantity 参数必须为正整数' });
    }

    const result = await executeOrder({
      ticker: ticker.trim().toUpperCase(),
      action: action.toUpperCase(),
      price: parsedPrice,
      quantity: parsedQty,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      reason: reason || '手动触发交易'
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to update .env file and process.env
function updateEnvFile(newConfig) {
  const envPath = path.join(process.cwd(), '.env');
  let currentEnv = {};
  
  if (fs.existsSync(envPath)) {
    const fileContent = fs.readFileSync(envPath, 'utf-8');
    const lines = fileContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        currentEnv[match[1]] = match[2] ? match[2].trim().replace(/^['"]|['"]$/g, '') : '';
      }
    }
  }

  const mergedConfig = { ...currentEnv, ...newConfig };
  const outputContent = Object.entries(mergedConfig)
    .map(([key, val]) => `${key}=${val}`)
    .join('\n') + '\n';
    
  fs.writeFileSync(envPath, outputContent, 'utf-8');

  // Update in-memory process.env
  for (const [key, val] of Object.entries(newConfig)) {
    process.env[key] = val;
  }
}

// ==========================================================================
// Map-Reduce 分批合并处理大语言模型核心函数
// ==========================================================================

// Helper for Map-Reduce AI calling
async function callAI(provider, prompt) {
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment.');
    return await runWithRateLimit(() => analyzeWithGemini(apiKey, prompt), { priority: 5 });
  } else if (provider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'deepseek-r1';
    return await analyzeWithOllama(baseUrl, model, prompt);
  } else if (provider === 'lm-studio') {
    const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
    const model = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';
    return await analyzeWithLMStudio(baseUrl, model, prompt);
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// Generate the final reduce prompt based on whether it is from Map-Reduce or raw messages
function getFinalReducePrompt(inputText, primarySpeakerName, isStrategyMode, extraParam, isFromMapReduce = false) {
  const dataSourceDesc = isFromMapReduce 
    ? `美股社区大V [${primarySpeakerName}] 的历史发言核心要点精炼汇总记录` 
    : `美股社区大V [${primarySpeakerName}] 的历史发言原始归档记录`;

  if (isStrategyMode) {
    const strategyName = extraParam;
    return `你是一位资深的美股量化与宏观投资策略分析师，精通美股交易规则、期权定价、以及各种实战战法。
以下是${dataSourceDesc}。
请对这些发言要点内容进行深度的系统整理、复盘与提炼，生成一份极其专业的“战法专项技术分析与实战总结报告”，以帮助订阅者深入学习大V的操作逻辑和风控思想。

你必须生成一份极其详尽且结构化的 Markdown 总结，格式如下：

# 📈 【${strategyName}】战法专项技术分析报告

## 📌 一、战法核心逻辑与思路提炼
- 详细提炼大V在该战法下的**核心操盘逻辑**是什么？大V在什么市场环境下倾向于使用此战法？
- 大V操作思路是侧重防守（降本、锁利、避险）还是进攻？有哪些核心技术要点？

## 🎯 二、具体执行细节与仓位管理
深入解析发言中体现出的执行细节：
- **买入与加仓时机**：如何寻找介入点？有什么明确的信号或技术支撑位判断？
- **卖出与止损/止利**：何时出局？如何博弈波动率（IV）或日内急涨急跌？
- **仓位配比与仓位分级**：该战法一般占用多少仓位？如何分批建仓与减仓？

## 📊 三、涉及标的与操作盘口汇总
整理发言中提及的重点个股，并制作一个 Markdown 表格，列出以下内容（如未提及则填“未明确说明”）：
| 股票代码 | 交易方向 (买入/卖出/做T/防御/观望) | 点位与价格区间 | 仓位管理 (半仓/轻仓/底仓等) | 核心支撑/压力位与执行逻辑 |

## 🛡️ 四、大V跟单风控金句与实战避坑指南
- 提炼这批发言中关于【${strategyName}】最核心的**风控金句或原则**（用引用块 \`>\` 突出）。
- 普通投资者在使用该战法或跟单时，最容易犯的错误是什么？应该如何进行心态建设和风控防线设计？

以下是分析的数据源：
${inputText}`;
  } else {
    const filterStr = extraParam;
    return `你是一位资深的美股量化与宏观投资策略分析师，精通美股交易规则、期权定价、以及各种实战战法（如财报战法、做T、尾盘强平、节日被动减仓、单调减仓等）。
以下是${dataSourceDesc}。
请对这些发言要点内容进行深度的系统整理、复盘与提炼，生成一份极其专业的“维度复盘与策略学习总结报告”，以帮助订阅者深入学习大V的操作逻辑和风控思想。

你必须生成一份极其详尽且结构化的 Markdown 总结，格式如下：

# 📈 [${filterStr}] 维度复盘与策略总结报告

## 📌 一、核心观点与交易思路提炼
- 总结大V在这些发言中的**核心观点**是什么？他对这些个股或板块的看法经历了怎样的变化？
- 在这个特定维度下，大V的操作是偏向防御性（如节日被动减仓、弹性股防御）还是进攻性（如财报战法、做T）？

## 🎯 二、策略战法实战解析
深入解析发言中体现出的实战战法（如果涉及）：
- **财报战法**：如何控制仓位？如何博弈财报发布前后的预期差和隐波（IV）？
- **做T/波段策略**：做T的节奏是什么？他是如何利用急涨急跌、日内低吸高抛来降本的？
- **尾盘强平与资金博弈**：发言中是如何博弈尾盘强平时段（如3点到3点半）的低点和高点的？
- **节日及资金面防守**：大V对于假前减仓、节日被动减仓等避险操作有哪些要求？
- **单调减仓**：大V在判断单边下跌时，是如何进行单调减仓防守的？

## 📊 三、标的物与执行细节汇总
整理发言中提及的重点个股，并制作一个 Markdown 表格，列出以下内容（如未提及则填“未明确说明”）：
| 股票代码 | 操作类型 (买入/卖出/做T/观望) | 点位与价格区间 | 仓位管理 (如半仓/轻仓) | 核心逻辑与技术支撑位 |

## 🛡️ 四、学习要点与跟单风控指南（金句提炼）
- 提炼这批发言中含金量最高、最适合反复学习和遵守的**风控金句或原则**（请用引用块 \`>\` 突出）。
- 普通订阅者在面临类似行情或使用该战法时，应该如何做仓位和心理建设？

以下是分析的数据源：
${inputText}`;
  }
}

// Master Map-Reduce analysis scheduler
async function runMapReduceAnalysis(messages, provider, isStrategyMode, extraParam) {
  const CHUNK_SIZE = 60; // Optimal batch size for 8k VRAM limit
  
  if (messages.length <= CHUNK_SIZE) {
    console.log(`[AI Map-Reduce] 消息总数为 ${messages.length}，少于分批阈值 ${CHUNK_SIZE}，执行单次直连分析。`);
    const messagesText = messages
      .map((msg) => {
        const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        return `[${timeStr}] [${msg.channel_name || '讨论区'}] ${msg.sender_name}: ${msg.content}`;
      })
      .join('\n\n');
      
    const primarySpeakerName = messages[0].sender_name;
    const prompt = getFinalReducePrompt(messagesText, primarySpeakerName, isStrategyMode, extraParam);
    return await callAI(provider, prompt);
  }

  console.log(`[AI Map-Reduce] 消息总数为 ${messages.length}，超过阈值 ${CHUNK_SIZE}。将执行分批合并（Map-Reduce）处理。`);
  const chunks = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    chunks.push(messages.slice(i, i + CHUNK_SIZE));
  }

  const chunkSummaries = [];
  const primarySpeakerName = messages[0].sender_name;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[AI Map-Reduce] 正在进行 Map 阶段分析 (${i + 1}/${chunks.length})，处理 ${chunk.length} 条发言...`);
    
    const chunkText = chunk
      .map((msg) => {
        const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        return `[${timeStr}] [${msg.channel_name || '讨论区'}] ${msg.sender_name}: ${msg.content}`;
      })
      .join('\n\n');

    const mapPrompt = `你是一个专业的投资策略数据精炼助手。以下是一份美股大V [${primarySpeakerName}] 历史发言归档的一部分（批次：${i + 1}/${chunks.length}）。
请从这批发言中提取出大V透露的所有核心观点、具体交易策略（如财报战法、做T操作相关）、关注个股的具体点位/区间与逻辑，以及关键的风控原则。
要求：内容必须高度精炼，删去日常闲聊，只保留核心要点，格式使用简洁的 Markdown 列表。
发言记录：
${chunkText}`;

    try {
      const summary = await callAI(provider, mapPrompt);
      chunkSummaries.push(`### 📅 批次数据回顾 (${i + 1}/${chunks.length})\n\n${summary}`);
    } catch (err) {
      console.error(`[AI Map-Reduce] 批次 ${i + 1} Map 分析失败:`, err.message);
    }
  }

  if (chunkSummaries.length === 0) {
    throw new Error('分批 Map 提炼全部失败，无法生成最终总结。');
  }

  console.log(`[AI Map-Reduce] 正在进行 Reduce 阶段整合，融合所有批次的摘要...`);
  const aggregatedSummariesText = chunkSummaries.join('\n\n=======================\n\n');
  
  const finalPrompt = getFinalReducePrompt(aggregatedSummariesText, primarySpeakerName, isStrategyMode, extraParam, true);
  return await callAI(provider, finalPrompt);
}

// 4. GET /api/config - Retrieve current config (secrets masked)
app.get('/api/config', (req, res) => {
  const mask = (str) => {
    if (!str) return '';
    if (str.length <= 8) return '********';
    return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
  };

  res.json({
    success: true,
    data: {
      PORT: process.env.PORT || '3000',
      AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
      GEMINI_API_KEY_MASKED: mask(process.env.GEMINI_API_KEY),
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'deepseek-r1',
      LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
      LM_STUDIO_MODEL: process.env.LM_STUDIO_MODEL || 'qwen3.5-35b-a3b',
      WHOP_CHAT_CHANNEL_ID: process.env.WHOP_CHAT_CHANNEL_ID || '',
      WHOP_SIGNAL_CHANNEL_IDS: process.env.WHOP_SIGNAL_CHANNEL_IDS || 'chat_feed_1CTrCEx44dP13jW3RVkYiS,chat_feed_1CWLuNUVYVVYttro8gAvJ5',
      TARGET_SPEAKER_USER_IDS: process.env.TARGET_SPEAKER_USER_IDS || '',
      MONITOR_INTERVAL_MINUTES: process.env.MONITOR_INTERVAL_MINUTES || '15',
      WECHAT_WORK_WEBHOOK_URL_MASKED: mask(process.env.WECHAT_WORK_WEBHOOK_URL),
      WHOP_WEBHOOK_SECRET_MASKED: mask(process.env.WHOP_WEBHOOK_SECRET),
      WHOP_USER_TOKEN_MASKED: mask(process.env.WHOP_USER_TOKEN),
      LAST_SYNC_TIME: getLastSyncTime(),
      // 风控与跟单配置项
      MOCK_TRADING_MODE: process.env.MOCK_TRADING_MODE || 'true',
      AUTO_TRADING_LEVEL: process.env.AUTO_TRADING_LEVEL || 'strict',
      USE_DYNAMIC_SIZING: process.env.USE_DYNAMIC_SIZING || 'true',
      DEFAULT_POSITION_PCT: process.env.DEFAULT_POSITION_PCT || '0.10',
      AUTO_SUBSTITUTE_LEVERAGED_ETFS: process.env.AUTO_SUBSTITUTE_LEVERAGED_ETFS || 'false',
      LEVERAGED_ETF_MAPPING: process.env.LEVERAGED_ETF_MAPPING || 'NVDA:NVDL,TSLA:TSLL,LITE:LITX',
      RISK_PER_TRADE_PCT: process.env.RISK_PER_TRADE_PCT || '0.01',
      MAX_CONCENTRATION_PCT: process.env.MAX_CONCENTRATION_PCT || '0.20',
      CASH_BUFFER_PCT: process.env.CASH_BUFFER_PCT || '0.15'
    }
  });
});

// 5. POST /api/config - Save configuration updates (CSRF protected)
app.post('/api/config', requireCsrf, (req, res) => {
  try {
    const updates = req.body;
    const cleanUpdates = {};

    // Only allow updating specific whitelisted environment variables
    const whitelist = [
      'PORT',
      'AI_PROVIDER',
      'GEMINI_API_KEY',
      'OLLAMA_BASE_URL',
      'OLLAMA_MODEL',
      'LM_STUDIO_BASE_URL',
      'LM_STUDIO_MODEL',
      'WHOP_CHAT_CHANNEL_ID',
      'WHOP_SIGNAL_CHANNEL_IDS',
      'TARGET_SPEAKER_USER_IDS',
      'MONITOR_INTERVAL_MINUTES',
      'WECHAT_WORK_WEBHOOK_URL',
      'WHOP_WEBHOOK_SECRET',
      'WHOP_USER_TOKEN',
      // 新增量化风控项
      'MOCK_TRADING_MODE',
      'AUTO_TRADING_LEVEL',
      'USE_DYNAMIC_SIZING',
      'DEFAULT_POSITION_PCT',
      'AUTO_SUBSTITUTE_LEVERAGED_ETFS',
      'LEVERAGED_ETF_MAPPING',
      'RISK_PER_TRADE_PCT',
      'MAX_CONCENTRATION_PCT',
      'CASH_BUFFER_PCT'
    ];

    for (const key of whitelist) {
      if (updates[key] !== undefined) {
        // If it starts with masking pattern and wasn't edited, keep current process.env value
        if (updates[key].includes('...') && (key === 'GEMINI_API_KEY' || key === 'WECHAT_WORK_WEBHOOK_URL' || key === 'WHOP_WEBHOOK_SECRET' || key === 'WHOP_USER_TOKEN')) {
          continue; // Keep current
        }
        cleanUpdates[key] = String(updates[key]).trim();
      }
    }

    updateEnvFile(cleanUpdates);
    
    // Restart poller task to reflect new interval
    startPoller();

    res.json({ success: true, message: 'Configuration updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. POST /webhook - Official Whop Webhook endpoint (Receive payments/membership updates)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  const signature = req.headers['x-whop-signature'] || req.headers['x-whop-signature-256'];
  const rawBody = req.body;

  if (secret && signature) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');
    
    try {
      const actualBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      
      if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        console.warn('Webhook signature verification failed.');
        return res.status(401).send('Unauthorized signature');
      }
    } catch (e) {
      console.warn('Error verifying webhook signature:', e);
      return res.status(401).send('Unauthorized');
    }
  }

  // Acknowledge receipt to Whop immediately
  res.status(200).send('OK');

  // Process asynchronously to prevent timeout
  try {
    const payload = JSON.parse(rawBody.toString('utf-8'));
    console.log('Received valid Whop Webhook:', payload.type);
    
    let msgText = `### 🔔 Whop 业务事件通知\n**事件类型**: \`${payload.type}\`\n`;
    if (payload.data) {
      const data = payload.data;
      if (payload.type.startsWith('payment.')) {
        msgText += `**金额**: $${((data.amount || 0) / 100).toFixed(2)}\n**付款用户**: ${data.user?.username || data.email || '未知'}\n**产品**: ${data.product?.title || '未知产品'}\n`;
      } else if (payload.type.startsWith('membership.')) {
        msgText += `**用户**: ${data.user?.username || data.email || '未知'}\n**产品/计划**: ${data.plan?.title || '未知'}\n**状态**: ${payload.type.split('.')[1] || '更新'}\n`;
      } else {
        msgText += `**数据摘要**: ${JSON.stringify(data).substring(0, 200)}...\n`;
      }
    }
    
    // Push notification to WeChat Bot
    if (process.env.WECHAT_WORK_WEBHOOK_URL) {
      await fetch(process.env.WECHAT_WORK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: msgText }
        })
      });
    }
  } catch (error) {
    console.error('Error processing webhook asynchronously:', error);
  }
});

// 7. POST /api/reports/dimensional-summary - Generate a customized AI report from filtered messages (CSRF protected)
app.post('/api/reports/dimensional-summary', requireCsrf, async (req, res) => {
  try {
    const { search, onlySpeakers, speakerMode, channelId: bodyChannelId, channelName, ticker, sector, strategy, startDate, endDate } = req.body;
    console.log('[API Reports] req.body:', req.body);

    const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    console.log('[API Reports] targetSpeakers:', targetSpeakers);

    let senderIds = [];
    let excludeSenderIds = [];
    let queryChannelId = bodyChannelId || '';

    const effectiveSpeakerMode = speakerMode || (onlySpeakers !== false ? 'speakers' : 'all');

    if (effectiveSpeakerMode === 'speakers') {
      senderIds = targetSpeakers;
    } else if (effectiveSpeakerMode === 'all') {
      // Show everyone
    } else if (effectiveSpeakerMode && effectiveSpeakerMode.startsWith('community_')) {
      queryChannelId = effectiveSpeakerMode.replace('community_', '');
      excludeSenderIds = targetSpeakers;
    }

    // Retrieve up to 200 messages for historical review analysis
    const data = getMessages({ 
      search: search || '', 
      limit: 200, 
      offset: 0, 
      senderIds,
      excludeSenderIds,
      channelId: queryChannelId,
      channelName: channelName || '',
      ticker: ticker || '',
      sector: sector || '',
      strategy: strategy || '',
      startDate: startDate || '',
      endDate: endDate || ''
    });

    if (!data.messages || data.messages.length === 0) {
      return res.status(400).json({ success: false, error: '当前过滤条件下没有找到历史发言，无法进行 AI 复盘总结。' });
    }

    // Sort chronologically (oldest first)
    const messages = [...data.messages].sort((a, b) => a.created_at - b.created_at);
    
    const primarySpeakerName = messages[0].sender_name;
    const filterDesc = [];
    if (effectiveSpeakerMode === 'speakers') {
      filterDesc.push('大V发言');
    } else if (effectiveSpeakerMode.startsWith('community_')) {
      const db = getDb();
      const ch = db.prepare("SELECT channel_name FROM messages WHERE channel_id = ? LIMIT 1").get(effectiveSpeakerMode.replace('community_', ''));
      const chName = ch ? ch.channel_name : '未知频道';
      filterDesc.push(`频道群友:${chName}`);
    } else {
      filterDesc.push('所有人发言');
    }
    if (sector) filterDesc.push(`板块:${sector}`);
    if (strategy) filterDesc.push(`战法:${strategy}`);
    if (ticker) filterDesc.push(`个股:${ticker}`);
    if (startDate || endDate) filterDesc.push(`时间:${startDate || '起'}至${endDate || '至今'}`);
    const filterStr = filterDesc.length > 0 ? filterDesc.join(', ') : '全维度历史';

    const provider = process.env.AI_PROVIDER || 'gemini';
    
    console.log(`[AI 维度复盘] 开始调用 AI (${provider})，采用分批合并机制生成维度总结报告...`);
    const startTimeAI = Date.now();
    const summaryContent = await runMapReduceAnalysis(messages, provider, false, filterStr);
    const durationAI = ((Date.now() - startTimeAI) / 1000).toFixed(1);
    console.log(`[AI 维度复盘] 维度总结报告生成成功！耗时: ${durationAI}秒。`);

    // Save report to DB
    const startTime = messages[0].created_at;
    const endTime = messages[messages.length - 1].created_at;
    
    let modelNameUsed = 'Gemini';
    if (provider === 'ollama') {
      modelNameUsed = `Ollama (${process.env.OLLAMA_MODEL || 'deepseek-r1'})`;
    } else if (provider === 'lm-studio') {
      modelNameUsed = `LM Studio (${process.env.LM_STUDIO_MODEL || 'qwen3.5-35b-a3b'})`;
    }

    const reportId = saveReport({
      startTime,
      endTime,
      summaryContent,
      aiModel: `${modelNameUsed} (维度复盘)`,
      rawMessagesCount: messages.length,
    });

    res.json({ 
      success: true, 
      id: reportId,
      created_at: Date.now(),
      summary_content: summaryContent,
      ai_model: `${modelNameUsed} (维度复盘)`,
      raw_messages_count: messages.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// 战法策略统计与专项 AI 研报分析 API 路由
// ==========================================================================

// GET /api/strategies - 获取 7 大战法统计信息和最新报告
app.get('/api/strategies', (req, res) => {
  try {
    const strategies = [
      { key: '财报战法', name: '财报战法', desc: '博弈财报发布前后的预期差、波动率（IV）与股价急涨急跌' },
      { key: '节日被动减', name: '节日被动减', desc: '节假日放假避险或资金周转进行的被动避险减仓' },
      { key: '单调减', name: '单调减', desc: '仓位持续单向递减、只出不进防守策略' },
      { key: '尾盘强平', name: '尾盘强平', desc: '博弈尾盘强平时段（如3:00 - 3:30）的异常低点/高点' },
      { key: '做T', name: '做T', desc: '在底仓基础上的日内/波段 T+0 低吸高抛操作，降低持仓成本' },
      { key: '弹性股防御', name: '弹性股防御', desc: '大盘回调期选择高弹性防御标的或避险板块博弈' },
      { key: '规律总结', name: '规律总结', desc: '对市场特征、特定庄股手法或大盘中长线规律的提炼' }
    ];

    const conn = getDb();
    const result = strategies.map(strat => {
      // 查询有该战法标记的消息总数
      const countRow = conn.prepare(`
        SELECT COUNT(*) as count FROM messages 
        WHERE strategies LIKE ?
      `).get(`%,${strat.key},%`);
      
      const messageCount = countRow ? countRow.count : 0;
      
      // 查询此战法关联的最新的 AI 研报
      const latestReport = getLatestReportForStrategy(strat.key);
      
      return {
        key: strat.key,
        name: strat.name,
        desc: strat.desc,
        messageCount,
        latestReport: latestReport ? {
          id: latestReport.id,
          created_at: latestReport.created_at,
          summary_content: latestReport.summary_content,
          ai_model: latestReport.ai_model,
          raw_messages_count: latestReport.raw_messages_count
        } : null
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/strategies/analyze - 对指定战法触发 AI 研报深度分析 (CSRF protected)
app.post('/api/strategies/analyze', requireCsrf, async (req, res) => {
  try {
    const { strategy } = req.body;
    if (!strategy) {
      return res.status(400).json({ success: false, error: '缺少 strategy 参数' });
    }

    const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // 获取该策略相关的最近最多 200 条消息来进行复盘总结
    const data = getMessages({
      limit: 200,
      offset: 0,
      senderIds: targetSpeakers,
      strategy: strategy
    });

    if (!data.messages || data.messages.length === 0) {
      return res.status(400).json({ success: false, error: `当前数据库中没有关于【${strategy}】的历史发言，无法进行 AI 分析。` });
    }

    // 按时间先后顺序排列 (最早的消息排在最前面)
    const messages = [...data.messages].sort((a, b) => a.created_at - b.created_at);
    
    const provider = process.env.AI_PROVIDER || 'gemini';
    
    console.log(`[AI 战法分析] 开始调用 AI (${provider})，采用分批合并机制生成【${strategy}】专项研报...`);
    const startTimeAI = Date.now();
    const summaryContent = await runMapReduceAnalysis(messages, provider, true, strategy);
    const durationAI = ((Date.now() - startTimeAI) / 1000).toFixed(1);
    console.log(`[AI 战法分析] 【${strategy}】专项研报生成成功！耗时: ${durationAI}秒。`);

    // 保存报告，带上 strategy 标记
    const startTime = messages[0].created_at;
    const endTime = messages[messages.length - 1].created_at;
    
    let modelNameUsed = 'Gemini';
    if (provider === 'ollama') {
      modelNameUsed = `Ollama (${process.env.OLLAMA_MODEL || 'deepseek-r1'})`;
    } else if (provider === 'lm-studio') {
      modelNameUsed = `LM Studio (${process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct'})`;
    }

    const reportId = saveReport({
      startTime,
      endTime,
      summaryContent,
      aiModel: `${modelNameUsed} (${strategy})`,
      rawMessagesCount: messages.length,
      strategy: strategy
    });

    res.json({ 
      success: true, 
      id: reportId,
      created_at: Date.now(),
      summary_content: summaryContent,
      ai_model: `${modelNameUsed} (${strategy})`,
      raw_messages_count: messages.length,
      strategy: strategy
    });
  } catch (error) {
    console.error('Error generating strategy analysis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// RAG (Retrieval-Augmented Generation) & Local LM Studio Embedding Support
// ==========================================================================

let isVectorSearchEnabled = false;
let isEmbeddingWorkerRunning = false;

async function fetchLMStudioEmbedding(text) {
  const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
  const model = process.env.LM_STUDIO_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
  const url = `${baseUrl.replace(/\/$/, '')}/v1/embeddings`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        input: text
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      throw new Error(`LM Studio HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    if (data && data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding;
    } else {
      throw new Error('Invalid embedding response structure.');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}


async function fetchGeminiEmbedding(text, priority = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=' + apiKey;
  
  const callFn = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: text }] }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error('Gemini embedding HTTP ' + res.status);
      }
      
      const data = await res.json();
      if (data && data.embedding && data.embedding.values) {
        return data.embedding.values;
      } else {
        throw new Error('Invalid Gemini embedding response');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  return await runWithRateLimit(callFn, { priority });
}

async function fetchEmbedding(text, priority = 1) {
  try {
    return await fetchLMStudioEmbedding(text);
  } catch (err) {
    try {
      return await fetchGeminiEmbedding(text, priority);
    } catch (gErr) {
      console.warn('[RAG] Gemini Embedding 触发配额保护挂起，跳过当前消息向量化以保护系统吞吐:', gErr.message);
      return null;
    }
  }
}

async function checkEmbeddingApi() {
  try {
    console.log('[RAG] Testing embedding API (LM Studio -> Gemini fallback)...');
    const testVector = await fetchEmbedding('test string', 0);
    if (Array.isArray(testVector) && testVector.length > 0) {
      isVectorSearchEnabled = true;
      console.log('[RAG] Embedding API active. Vector size: ' + testVector.length + '. Vector search enabled.');
      startBackgroundEmbedder();
    }
  } catch (err) {
    console.warn('[RAG] Embedding API not available. Falling back to keyword search. Error: ' + err.message);
  }
}

async function startBackgroundEmbedder() {
  if (isEmbeddingWorkerRunning) return;
  isEmbeddingWorkerRunning = true;
  
  console.log('[RAG] Background embedding worker started.');
  
  while (isVectorSearchEnabled) {
    try {
      if (global.isAiGenerating) {
        // Yield GPU resources to text generation completions
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const unembedded = getMessagesWithoutEmbeddings(20);
      if (unembedded.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }
      
      console.log(`[RAG] Indexing embeddings: ${unembedded.length} messages remaining in batch...`);
      
      for (const msg of unembedded) {
        if (!isVectorSearchEnabled) break;
        if (global.isAiGenerating) break; // Break batch if text completions starts
        
        if (!msg.content || msg.content.trim() === '') {
          saveMessageEmbedding(msg.id, new Array( testLMStudioVectorSize() || 384 ).fill(0));
          continue;
        }
        
        try {
          const embedding = await fetchEmbedding(msg.content, 0);
          saveMessageEmbedding(msg.id, embedding);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`[RAG] Failed to embed message ${msg.id}: ${err.message}`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          break;
        }
      }

      // Delay between batches to prevent GPU resource starvation
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error('[RAG] Error in embedding worker loop:', err);
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  
  isEmbeddingWorkerRunning = false;
  console.log('[RAG] Background embedding worker stopped.');
}

function testLMStudioVectorSize() {
  // Safe default fallback
  return 384;
}

// POST /api/rag/query - Ask natural language questions grounded on historical whop chats (CSRF protected)
app.post('/api/rag/query', requireCsrf, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim() === '') {
      return res.status(400).json({ success: false, error: '问题不能为空。' });
    }
    
    console.log(`[RAG] Received question: "${question}"`);
    
    const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    let topMessages = [];
    let retrievalMode = 'FTS5 (Keyword Only)';
    
    let queryEmbedding = null;
    if (isVectorSearchEnabled) {
      try {
        queryEmbedding = await fetchEmbedding(question, 10);
      } catch (err) {
        console.warn(`[RAG] Failed to generate embedding for query, falling back to keyword search: ${err.message}`);
      }
    }
    
    if (queryEmbedding) {
      retrievalMode = 'Hybrid (FTS5 + Vector Embeddings)';
      const vectorMatches = searchVectorMessages(queryEmbedding, 30, targetSpeakers);
      const ftsMatches = searchFTSMessages(question, 30, targetSpeakers);
      
      const rrfScores = {};
      const messagesMap = {};
      
      vectorMatches.forEach((msg, index) => {
        const rank = index + 1;
        rrfScores[msg.id] = (rrfScores[msg.id] || 0) + 1 / (60 + rank);
        messagesMap[msg.id] = msg;
      });
      
      ftsMatches.forEach((msg, index) => {
        const rank = index + 1;
        rrfScores[msg.id] = (rrfScores[msg.id] || 0) + 1 / (60 + rank);
        messagesMap[msg.id] = msg;
      });
      
      const sortedIds = Object.keys(rrfScores).sort((a, b) => rrfScores[b] - rrfScores[a]);
      topMessages = sortedIds.slice(0, 7).map(id => messagesMap[id]);
    } else {
      topMessages = searchFTSMessages(question, 7, targetSpeakers);
    }
    
    if (topMessages.length === 0) {
      const data = getMessages({ search: question, limit: 10, senderIds: targetSpeakers });
      topMessages = data.messages || [];
      retrievalMode = 'LIKE (FTS/Vector Empty Fallback)';
    }
    
    if (topMessages.length === 0) {
      return res.json({
        success: true,
        answer: '抱歉，知识库中暂时没有任何相关的历史发言记录，因此我无法为您提供准确的回答。您可以尝试更换个股代码或关键字提问。',
        citations: [],
        retrieval_mode: retrievalMode
      });
    }
    
    const chronMessages = [...topMessages].sort((a, b) => a.created_at - b.created_at);
    
    const contextText = chronMessages.map((msg, index) => {
      const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      return `[消息 ID: ${index + 1}] [时间: ${timeStr}] [频道: ${msg.channel_name || '讨论区'}] ${msg.sender_name}: ${msg.content}`;
    }).join('\n\n');
    
    let playbookText = '';
    try {
      const latestPlaybook = getLatestPersonaPlaybook();
      if (latestPlaybook && latestPlaybook.summary_content) {
        playbookText = latestPlaybook.summary_content.substring(0, 1500);
      }
    } catch (playbookErr) {
      console.warn(`[RAG] Failed to read latest persona playbook: ${playbookErr.message}`);
    }

    const aiPrompt = `你现在是社区大V【赵哥】的数字交易助理分身。你的任务是针对用户的问题，深入分析并梳理【历史发言上下文】中大V的交易逻辑、思考轨迹和操作策略，为用户提供有深度、有逻辑且专业性强的AI分析回答。

【角色与回答要求】：
1. **深度AI分析**：请不要机械地堆砌检索到的消息，而是要理解大V说话的宏观背景与具体语境，提炼出他的操作意图（如：防守做空、急跌急吸、逢高锁定利润、做T降成本等），并深度剖析其背后的交易逻辑。
2. **严格基于事实与引用**：你的分析必须紧扣“历史发言上下文”。每一个核心陈述（例如买卖价格、加仓点位、多空方向、后市看法等），都必须在句尾方括号标注对应的“消息 ID”来源（例如：[1]、[2]），确保有据可查，绝不凭空捏造。若上下文无相关记录，直接表明大V近期未提及。
3. **结合交易画像与常识**：在遵循上下文事实的前提下，可以结合赵哥的【基本交易规则与人格属性】（如：不赌财报、少做长线死拿等习惯）来对大V的操作和决策进行合理的上下文解读。
4. **精美结构化排版**：不要用单一的文本块。请使用清晰的 Markdown 标题、列表或表格，将分析整理为例如：【核心策略观点】、【具体操作分析】、【风险防御与建议】等板块，字数控制在 600 字以内，既专业深刻又条理清晰。

【基本交易规则与人格属性】（仅用于规范表达方式和基本常识，不要脑补为最新交易动作）：
${playbookText || '待生成'}

【历史发言上下文】：
${contextText}

【用户问题】：
${question}`;

    const provider = process.env.AI_PROVIDER || 'gemini';
    let answer = '';
    
    console.log(`[RAG] Querying LLM (${provider}) for answer...`);
    const startTimeAI = Date.now();
    
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
      answer = await runWithRateLimit(() => analyzeWithGemini(apiKey, aiPrompt), { priority: 10 });
    } else if (provider === 'ollama') {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const model = process.env.OLLAMA_MODEL || 'deepseek-r1';
      answer = await analyzeWithOllama(baseUrl, model, aiPrompt);
    } else if (provider === 'lm-studio') {
      const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
      const model = process.env.LM_STUDIO_MODEL || 'qwen3.5-35b-a3b';
      answer = await analyzeWithLMStudio(baseUrl, model, aiPrompt);
    } else {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }
    
    const durationAI = ((Date.now() - startTimeAI) / 1000).toFixed(1);
    console.log(`[RAG] Answer generated successfully in ${durationAI}s. Retrieval Mode: ${retrievalMode}`);
    
    res.json({
      success: true,
      answer: answer,
      citations: chronMessages.map((msg, index) => ({
        citationId: index + 1,
        id: msg.id,
        sender_name: msg.sender_name,
        channel_name: msg.channel_name,
        content: msg.content,
        created_at: msg.created_at
      })),
      retrieval_mode: retrievalMode
    });
    
  } catch (error) {
    console.error('[RAG] Error answering query:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

let tunnelProcess = null;

function startCloudflareTunnel(port) {
  console.log('[Cloudflare Tunnel] Starting Cloudflare quick tunnel for port', port);
  
  // Spawn npx cloudflared tunnel --url http://localhost:${port}
  // On Windows, npx is a cmd/ps1 file, so { shell: true } is required
  tunnelProcess = spawn('npx', ['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], { shell: true });
  
  let urlFound = false;

  const handleData = async (data) => {
    const output = data.toString();
    console.log(`[Cloudflare Log] ${output.trim()}`);
    
    if (urlFound) return;

    // Search for trycloudflare.com URL
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      const tunnelUrl = match[0];
      urlFound = true;
      console.log(`=================================================`);
      console.log(`[Cloudflare Tunnel] Public URL created successfully!`);
      console.log(`Public Link: ${tunnelUrl}`);
      console.log(`=================================================`);

      // Push to WeChat Bot
      const wechatWebhook = process.env.WECHAT_WORK_WEBHOOK_URL;
      if (wechatWebhook) {
        try {
          const msgText = `### 🌐 Whop WeChat Bridge 启动成功\n\n服务已成功启动，并通过 Cloudflare Tunnel 穿透公网。\n\n**公网控制台**: [点击访问](${tunnelUrl})\n**本地控制台**: http://localhost:${port}\n\n---\n*后台智能轮询器已激活，将在美股交易时段内提供超高频数据同步。*`;
          await fetch(wechatWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              msgtype: 'markdown',
              markdown: { content: msgText }
            })
          });
          console.log('[Cloudflare Tunnel] Public URL pushed to WeChat Bot.');
        } catch (err) {
          console.error('[Cloudflare Tunnel] Failed to push URL to WeChat:', err.message);
        }
      }
    }
  };

  tunnelProcess.stdout.on('data', handleData);
  tunnelProcess.stderr.on('data', handleData);

  tunnelProcess.on('close', (code) => {
    console.log(`[Cloudflare Tunnel] Process exited with code ${code}`);
    tunnelProcess = null;
  });

  tunnelProcess.on('error', (err) => {
    console.error('[Cloudflare Tunnel] Process error:', err.message);
  });
}

// Clean up child process on exit
process.on('exit', () => {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
});
process.on('SIGINT', () => {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
  process.exit();
});
process.on('SIGTERM', () => {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
  process.exit();
});

// Start Express server and background Poller
const server = app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`Whop Webhook & Bridge Server running on port ${PORT}`);
  console.log(`Web Dashboard: http://localhost:${PORT}`);
  console.log(`=================================================`);
  
  startPoller();
  // Check local LM Studio embedding server and start background worker if active
  checkEmbeddingApi();
  // Start background task queue worker with concurrency = 4 (并行调动 GPU 显力)
  startQueueWorker(async (task) => {
    if (task.task_type.startsWith('persona_')) {
      return await processPersonaTask(task);
    }
    if (task.task_type.startsWith('news_')) {
      return await processNewsTask(task);
    }
    throw new Error(`Unsupported task type: ${task.task_type}`);
  }, 4, 800);
  // Start Cloudflare Tunnel and push URL to WeChat
  startCloudflareTunnel(PORT);
  
  // 5 秒后首次后台更新口头仓位披露缓存，此后每 15 分钟定时静默拉取
  setTimeout(() => {
    updateCachedVerbalExposure();
  }, 5000);
  setInterval(() => {
    updateCachedVerbalExposure();
  }, 15 * 60 * 1000);
});
server.timeout = 1200000; // 20 minutes timeout for long local LLM reasoning

// ==========================================================================
// 全局 GPU 资源排队与独占调度系统 (用于协同解决 WeChat Bridge & OpenMontage 显存冲突)
// ==========================================================================
global.gpuLock = {
  isLocked: false,
  owner: null,
  acquiredAt: null
};

// 申请 GPU 锁
app.post('/api/gpu/acquire', async (req, res) => {
  const { owner } = req.body;
  if (!owner) {
    return res.status(400).json({ success: false, error: 'owner is required' });
  }

  // 如果锁已被自己持有，直接返回成功
  if (global.gpuLock.isLocked && global.gpuLock.owner === owner) {
    return res.json({ success: true, message: 'GPU already locked by you' });
  }

  // 如果被别人持有，返回失败并告知占用者
  if (global.gpuLock.isLocked && global.gpuLock.owner !== owner) {
    return res.json({
      success: false,
      reason: `GPU 已被 ${global.gpuLock.owner} 占用，锁定于 ${new Date(global.gpuLock.acquiredAt).toLocaleTimeString('zh-CN')}`
    });
  }

  global.gpuLock = {
    isLocked: true,
    owner,
    acquiredAt: Date.now()
  };
  console.log(`[GPU Scheduler] GPU 锁已被 ${owner} 成功获取`);

  if (owner === 'openmontage') {
    // 自动卸载大模型以腾空全部显存给视频渲染
    try {
      const { exec } = await import('child_process');
      console.log('[GPU Scheduler] 检测到 openmontage 触发独占渲染，正在执行 lms unload 释放显存...');
      exec('lms unload --all', (err, stdout, stderr) => {
        if (err) {
          console.warn('[GPU Scheduler] lms 命令行卸载失败，可能未安装 lms CLI。尝试 HTTP 备用路径:', err.message);
          const lmStudioUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
          // 备用请求：卸载本地大模型接口
          fetch(`${lmStudioUrl}/api/v1/models/unload`, { method: 'POST' }).catch(() => {});
        } else {
          console.log('[GPU Scheduler] LM Studio 显存成功彻底释放:', stdout.trim());
        }
      });
    } catch (e) {
      console.warn('[GPU Scheduler] 执行 lms 卸载任务异常:', e.message);
    }
  }

  res.json({ success: true, message: 'GPU locked successfully' });
});

// 释放 GPU 锁
app.post('/api/gpu/release', (req, res) => {
  const { owner } = req.body;
  if (!owner) {
    return res.status(400).json({ success: false, error: 'owner is required' });
  }

  if (!global.gpuLock.isLocked) {
    return res.json({ success: true, message: 'GPU is already unlocked' });
  }

  if (global.gpuLock.owner !== owner) {
    return res.status(403).json({ success: false, error: `You cannot release lock held by ${global.gpuLock.owner}` });
  }

  console.log(`[GPU Scheduler] GPU 锁已被 ${owner} 释放`);
  global.gpuLock = {
    isLocked: false,
    owner: null,
    acquiredAt: null
  };

  res.json({ success: true, message: 'GPU unlocked successfully' });
});

// 获取当前 GPU 锁状态
app.get('/api/gpu/status', (req, res) => {
  res.json({ success: true, data: global.gpuLock });
});

