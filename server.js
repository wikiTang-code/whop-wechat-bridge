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
