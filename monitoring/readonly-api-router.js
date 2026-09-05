/**
 * @file monitoring/readonly-api-router.js
 * @description P1-11 / T18 / T20: Web 看板只读路由集合 (与现网 public/app.js 前端契约 100% 对齐)
 *
 * 铁律约束:
 * 1. 拦截所有非 GET/HEAD/OPTIONS 的写请求，统一返回 HTTP 403 Forbidden；
 * 2. 优先复用 database.js / trading.js 的只读查询与业务逻辑，杜绝手写简陋 SQL；
 * 3. 字段形状全面适配前端现网消费契约 (兼备 data 与专用键名)，杜绝白屏；
 * 4. 挂载看板运行所需的所有只读路由：config、messages 过滤、proxy-image、context、quant、gpu、monitor、speakers 等。
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import net from 'net';
import { fileURLToPath } from 'url';
import {
  getDb,
  getMessages,
  getMessageContext,
  getReports,
  getOrders,
  getDistinctChannels,
  getLastSyncTime,
  getNewsSummaries,
  getLatestNewsSummary,
  getLatestPersonaPlaybook
} from '../database.js';
import { getUnifiedPortfolio, getUnifiedPositions } from '../trading.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export const readonlyRouter = Router();

/**
 * 1. 全局写操作物理拦截中间件 (READONLY_MODE=1)
 */
export function readonlyWriteBlockerMiddleware(req, res, next) {
  const allowedMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (!allowedMethods.includes(req.method)) {
    return res.status(403).json({
      success: false,
      error: `[READONLY_MODE] Write operation ${req.method} ${req.path} is strictly forbidden on web_dashboard. Routed to ingest_worker only.`,
      code: 'ERR_READONLY_PROCESS'
    });
  }
  next();
}

/**
 * 敏感字段掩码辅助函数
 */
function maskSecret(str) {
  if (!str) return '';
  if (str.length <= 8) return '********';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

/**
 * 2. 现网前端契约对齐的只读 GET 路由
 */

// GET /api/csrf-token (前端页面初始化调用)
readonlyRouter.get('/api/csrf-token', (req, res) => {
  res.json({ success: true, csrfToken: 'readonly_safe_token_000000000000000000000000000000000000000000000000' });
});

// GET /api/config (设置页与上次同步时间，app.js 强依赖 result.data)
readonlyRouter.get('/api/config', (req, res) => {
  try {
    let lastSync = null;
    try {
      lastSync = getLastSyncTime();
    } catch (_) {}

    const configData = {
      PORT: process.env.PORT || '8085',
      AI_PROVIDER: process.env.AI_PROVIDER || 'lm-studio',
      GEMINI_API_KEY_MASKED: maskSecret(process.env.GEMINI_API_KEY),
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'deepseek-r1',
      LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080',
      LM_STUDIO_MODEL: process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct',
      WHOP_CHAT_CHANNEL_ID: process.env.WHOP_CHAT_CHANNEL_ID || '',
      WHOP_SIGNAL_CHANNEL_IDS: process.env.WHOP_SIGNAL_CHANNEL_IDS || 'chat_feed_1CTrCEx44dP13jW3RVkYiS,chat_feed_1CWLuNUVYVVYttro8gAvJ5',
      TARGET_SPEAKER_USER_IDS: process.env.TARGET_SPEAKER_USER_IDS || '',
      MONITOR_INTERVAL_MINUTES: process.env.MONITOR_INTERVAL_MINUTES || '15',
      WECHAT_WORK_WEBHOOK_URL_MASKED: maskSecret(process.env.WECHAT_WORK_WEBHOOK_URL),
      WECHAT_ALERT_WEBHOOK_URL_MASKED: maskSecret(process.env.WECHAT_ALERT_WEBHOOK_URL),
      WHOP_WEBHOOK_SECRET_MASKED: maskSecret(process.env.WHOP_WEBHOOK_SECRET),
      WHOP_USER_TOKEN_MASKED: maskSecret(process.env.WHOP_USER_TOKEN),
      LAST_SYNC_TIME: lastSync,
      // 风控与跟单配置项
      MOCK_TRADING_MODE: process.env.MOCK_TRADING_MODE || 'true',
      AUTO_TRADING_LEVEL: process.env.AUTO_TRADING_LEVEL || 'strict',
      USE_DYNAMIC_SIZING: process.env.USE_DYNAMIC_SIZING || 'true',
      DEFAULT_POSITION_PCT: process.env.DEFAULT_POSITION_PCT || '0.10',
      AUTO_SUBSTITUTE_LEVERAGED_ETFS: process.env.AUTO_SUBSTITUTE_LEVERAGED_ETFS || 'false',
      LEVERAGED_ETF_MAPPING: process.env.LEVERAGED_ETF_MAPPING || 'NVDA:NVDL,TSLA:TSLL,LITE:LITX',
      RISK_PER_TRADE_PCT: process.env.RISK_PER_TRADE_PCT || '0.01',
      MAX_CONCENTRATION_PCT: process.env.MAX_CONCENTRATION_PCT || '0.20',
      CASH_BUFFER_PCT: process.env.CASH_BUFFER_PCT || '0.15',
      // 多进程运行状态标识
      readonlyMode: true,
      role: 'web_dashboard',
    };

    res.json({
      success: true,
      data: configData,
      config: configData,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/messages (完全复用 database.js getMessages，对齐所有前端过滤参数)
readonlyRouter.get('/api/messages', (req, res) => {
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
      // 显示全部发言人
    } else if (speakerMode && speakerMode.startsWith('community_')) {
      channelId = speakerMode.replace('community_', '');
      excludeSenderIds = targetSpeakers;
    } else if (speakerMode) {
      senderIds = [speakerMode];
    } else {
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

    res.json({
      success: true,
      data: data.messages,
      messages: data.messages,
      total: data.total,
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/messages/:id/context (消息上下文回溯)
readonlyRouter.get('/api/messages/:id/context', (req, res) => {
  try {
    const messageId = req.params.id;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 10));
    const data = getMessageContext({ messageId, limit });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/proxy-image (对齐 server.js 现网图片代理机制，本地磁盘优先，回退官方防 SSRF 代理)
readonlyRouter.get('/api/proxy-image', async (req, res) => {
  try {
    const localPathQuery = req.query.path;
    const imageUrl = req.query.url;

    // 1. 优先直接读取 local_path
    if (localPathQuery) {
      const safePath = path.resolve(projectRoot, localPathQuery);
      if (safePath.startsWith(path.resolve(projectRoot, 'data/media')) && fs.existsSync(safePath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.sendFile(safePath);
      }
    }

    if (!imageUrl) {
      return res.status(400).send('Missing url or path parameter');
    }

    // 2. 从 manifest 匹配本地是否已缓存
    try {
      const manifestPath = path.resolve(projectRoot, 'data/media/zhao/media_manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const matched = manifest.find(m => m.raw_url === imageUrl || (m.local_path && imageUrl.includes(m.message_id)));
        if (matched && matched.local_path) {
          const absPath = path.resolve(projectRoot, matched.local_path);
          if (fs.existsSync(absPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.sendFile(absPath);
          }
        }
      }
    } catch (_) {}

    // 2.1 兜底：从 URL 中提取 post_xxx，并在 data/media/ 中检索已落盘图片
    try {
      const postMatch = imageUrl.match(/(post_[A-Za-z0-9_-]+)/);
      if (postMatch) {
        const pid = postMatch[1];
        const possibleDirs = ['data/media/zhao', 'data/media/zhou', 'data/media/general'];
        for (const relDir of possibleDirs) {
          const fullDir = path.resolve(projectRoot, relDir);
          if (fs.existsSync(fullDir)) {
            const dateDirs = fs.readdirSync(fullDir);
            for (const d of dateDirs) {
              const candidate = path.join(fullDir, d, `${pid}_0.jpg`);
              if (fs.existsSync(candidate)) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.sendFile(candidate);
              }
            }
          }
        }
      }
    } catch (_) {}

    // 3. 校验允许代理的外部图片 Host，防止 SSRF
    if (!imageUrl.startsWith('https://img-v2-prod.whop.com') && !imageUrl.startsWith('https://assets-2-prod.whop.com')) {
      return res.status(403).send('Forbidden: Invalid image host');
    }

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://whop.com/',
        'Cookie': process.env.WHOP_COOKIE || ''
      }
    };

    const PROXY_TIMEOUT_MS = 15000;
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    let proxyTimeout = setTimeout(() => {
      imgReq.destroy();
      if (!res.headersSent) res.status(504).send('Image proxy timeout');
    }, PROXY_TIMEOUT_MS);

    let totalBytes = 0;
    const imgReq = https.get(imageUrl, options, (imgRes) => {
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        clearTimeout(proxyTimeout);
        let redirectUrl;
        try {
          redirectUrl = new URL(imgRes.headers.location, imageUrl);
        } catch (_) {
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
    console.error('[Image Proxy Exception]:', error.message);
    res.status(500).send('Internal server error');
  }
});

// GET /api/channels (权威登记册补全 + 兼容 data 与 channels)
readonlyRouter.get('/api/channels', (req, res) => {
  try {
    const channels = getDistinctChannels();
    res.json({
      success: true,
      data: channels,
      channels: channels,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/speakers (过滤掉大V，剩下群友用于自动补全，兼容 data 与 speakers)
readonlyRouter.get('/api/speakers', (req, res) => {
  try {
    const db = getDb();
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

    const communitySpeakers = rows.filter(r => !targetSpeakers.includes(r.sender_id));

    res.json({
      success: true,
      data: communitySpeakers,
      speakers: communitySpeakers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reports (兼容 data 与 reports，含完整 summary_content 正文)
readonlyRouter.get('/api/reports', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const data = getReports({ limit, offset });
    res.json({
      success: true,
      data: data.reports,
      reports: data.reports,
      total: data.total,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/news-summaries (兼容 data 与 summaries，含 summary_content 正文)
readonlyRouter.get('/api/news-summaries', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const summaries = getNewsSummaries(limit, offset);
    res.json({
      success: true,
      data: summaries,
      summaries: summaries,
      total: summaries.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/news-summaries/latest
readonlyRouter.get('/api/news-summaries/latest', (req, res) => {
  try {
    const type = req.query.type || null;
    const summary = getLatestNewsSummary(type);
    res.json({
      success: true,
      data: summary,
      summary: summary,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news-summaries/status
readonlyRouter.get('/api/news-summaries/status', (req, res) => {
  try {
    const db = getDb();
    const active = db.prepare(`
      SELECT id FROM task_queue
      WHERE task_type LIKE 'news_%' AND status IN ('pending', 'running')
      LIMIT 1
    `).get();

    res.json({ status: active ? 'running' : 'idle' });
  } catch (_) {
    res.json({ status: 'idle' });
  }
});

// GET /api/persona/status
readonlyRouter.get('/api/persona/status', (req, res) => {
  try {
    const db = getDb();
    const active = db.prepare(`
      SELECT id FROM task_queue
      WHERE task_type LIKE 'persona_%' AND status IN ('pending', 'running')
      LIMIT 1
    `).get();

    res.json({ status: active ? 'running' : 'idle' });
  } catch (_) {
    res.json({ status: 'idle' });
  }
});

// GET /api/persona/latest (前端首屏白皮书渲染)
readonlyRouter.get('/api/persona/latest', (req, res) => {
  try {
    const playbook = getLatestPersonaPlaybook();
    res.json({
      success: !!playbook,
      data: playbook || null,
      playbook: playbook || null,
    });
  } catch (err) {
    res.json({ success: false, playbook: null, data: null, error: err.message });
  }
});

// ==========================================================================
// 量化交易与资产状态只读路由 (挂载 /api/quant/*)
// ==========================================================================

// GET /api/quant/portfolio (账户总资产、可用现金、持仓市值等)
readonlyRouter.get('/api/quant/portfolio', async (req, res) => {
  try {
    const data = await getUnifiedPortfolio();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/quant/positions (当前持仓明细)
readonlyRouter.get('/api/quant/positions', async (req, res) => {
  try {
    const data = await getUnifiedPositions();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/quant/orders (跟单订单历史记录，兼备 data 与 orders 键)
readonlyRouter.get('/api/quant/orders', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const data = getOrders({ limit, offset });
    res.json({
      success: true,
      data: data.orders,
      orders: data.orders,
      total: data.total
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// 系统监控与状态路由
// ==========================================================================

// GET /api/gpu/status (与现网契约对齐，包装 data: global.gpuLock，兼备顶层字段)
readonlyRouter.get('/api/gpu/status', (req, res) => {
  const isLocked = global.gpuLock?.isLocked || false;
  const owner = global.gpuLock?.owner || null;
  const acquiredAt = global.gpuLock?.acquiredAt || null;
  const gpuData = global.gpuLock || { isLocked, owner, acquiredAt };
  res.json({
    success: true,
    data: gpuData,
    isLocked,
    owner,
    note: 'In multi-process mode, gpuLock is managed inside ingest_worker.'
  });
});

// GET /api/system/monitor (对齐 server.js 现网形状，返回 activeTasks/completedTasks/rateLimiterStats 等完整丰富 JSON)
readonlyRouter.get('/api/system/monitor', async (req, res) => {
  try {
    const db = getDb();

    // a. Rate Limiter Stats
    let rateLimiterStats = { totalActive: 0, waitingInQueue: 0, byType: {} };
    let inMemoryApiTasks = [];
    try {
      const { getRateLimiterStats, getActiveApiCalls } = await import('../rate-limiter.js');
      rateLimiterStats = getRateLimiterStats();
      inMemoryApiTasks = (typeof getActiveApiCalls === 'function' ? getActiveApiCalls() : []).map(t => ({
        id: t.id,
        taskType: t.task_type,
        status: t.status,
        priority: t.priority,
        description: '☁️ Gemini API 云端多模态与文本精加工',
        updatedAt: t.updated_at
      }));
    } catch (_) {}

    // b. 本地大模型连线检测 (1000ms 超时)
    const checkLocalPort = (port, host) => {
      const recentlySuccessful = global.lastSuccessfulLocalAiTime && (Date.now() - global.lastSuccessfulLocalAiTime < 60000);
      if (recentlySuccessful) return Promise.resolve(true);

      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
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

    // c. GPU 锁状态
    const gpuLockStatus = global.gpuLock ? {
      isLocked: global.gpuLock.isLocked,
      owner: global.gpuLock.owner,
      acquiredAt: global.gpuLock.acquiredAt
    } : { isLocked: false, owner: null, acquiredAt: null };

    // d. 活跃排队任务
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

    const formattedTasks = activeTasks.map(t => {
      let desc = '未知系统任务';
      if (t.task_type === 'persona_reduce') {
        desc = '🧠 本地 14B 白皮书合成 (Gemini 仅稀疏兜底)';
      } else if (t.task_type.startsWith('persona_')) {
        desc = '🧠 大V行为画像分片分析 (Local 14B)';
      } else if (t.task_type === 'news_reduce') {
        desc = '📅 本地 14B 社区资讯终极总结 (Gemini 仅稀疏兜底)';
      } else if (t.task_type.startsWith('news_')) {
        const subType = t.task_type.split('_')[1] || '';
        const subMap = { briefing: '盘前速报', intraday: '盘中总结', closing: '收盘回顾', macro: '宏观周报', map: 'Map分片提取', reduce: 'Reduce终极合成' };
        desc = `📅 社区资讯速报生成 (${subMap[subType] || subType})`;
      } else if (t.task_type === 'gemini_api_cloud') {
        desc = '☁️ Gemini API 云端多模态与文本精加工';
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

    const combinedActiveTasks = [...inMemoryApiTasks, ...formattedTasks];

    // e. 最近历史任务
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

    const pendingTradeMsgsCount = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE is_traded = 0 AND (sender_id = 'user_4yeplXgbguTu4' OR sender_name LIKE '%zhao%' OR sender_name LIKE '%赵%')
    `).get()?.count || 0;

    res.json({
      success: true,
      data: {
        localModelConnected,
        rateLimiterStats,
        gpuLockStatus,
        activeTasks: combinedActiveTasks,
        activeTasksCount: activeTasksCount + inMemoryApiTasks.length,
        completedTasks: formattedHistory,
        pendingTradeMsgsCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
