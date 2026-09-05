/**
 * @file monitoring/readonly-api-router.js
 * @description P1-11: Web 看板只读路由集合与写操作 403 防护拦截器
 *
 * 铁律约束:
 * 1. 拦截所有非 GET/HEAD/OPTIONS 的写请求，一律返回 HTTP 403 Forbidden；
 * 2. 所有只读接口均通过 { readonly: true } 句柄读取 SQLite，杜绝写锁争用；
 * 3. 严格对齐 docs/p1-11-route-ownership.md 清单。
 */

import { Router } from 'express';
import { getReadOnlyArchiveDb } from './db-readonly.js';

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
 * 2. 挂载只读 GET 路由子集
 */

// GET /api/messages (只读查询归档消息)
readonlyRouter.get('/api/messages', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = db.prepare(`
      SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at, attachments
      FROM messages
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const countRow = db.prepare('SELECT count(*) as total FROM messages').get();

    res.json({
      success: true,
      data: rows,
      total: countRow?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/channels (只读频道列表)
readonlyRouter.get('/api/channels', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const rows = db.prepare(`
      SELECT channel_id, channel_name, count(*) as message_count, max(created_at) as last_activity
      FROM messages
      GROUP BY channel_id, channel_name
      ORDER BY last_activity DESC
    `).all();

    res.json({ success: true, channels: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/speakers (只读发言人列表)
readonlyRouter.get('/api/speakers', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const rows = db.prepare(`
      SELECT sender_id, sender_name, count(*) as count, max(created_at) as last_seen
      FROM messages
      GROUP BY sender_id, sender_name
      ORDER BY count DESC
    `).all();

    res.json({ success: true, speakers: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reports (只读历史报告)
readonlyRouter.get('/api/reports', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = db.prepare(`
      SELECT id, strategy, ai_model, start_time, end_time, created_at, raw_messages_count
      FROM reports
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({ success: true, reports: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/news-summaries (只读历史资讯速报)
readonlyRouter.get('/api/news-summaries', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = db.prepare(`
      SELECT id, batch_id, summary_type, title, start_time, end_time, created_at, raw_messages_count
      FROM news_summaries
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/gpu/status (只读 GPU 显存锁状态)
readonlyRouter.get('/api/gpu/status', (req, res) => {
  const isLocked = global.gpuLock?.isLocked || false;
  const owner = global.gpuLock?.owner || null;
  res.json({
    success: true,
    isLocked,
    owner,
    note: 'In multi-process mode, gpuLock is managed inside ingest_worker.'
  });
});
