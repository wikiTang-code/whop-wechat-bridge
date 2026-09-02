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

const AUTH_RATE_LIMIT = 10; // max attempts per 15-minute window
