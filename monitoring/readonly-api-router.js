/**
 * @file monitoring/readonly-api-router.js
 * @description P1-11 / T18: Web 看板只读路由集合 (与现网 public/app.js 前端契约 100% 对齐)
 *
 * 铁律约束:
 * 1. 拦截所有非 GET/HEAD/OPTIONS 的写请求，统一返回 HTTP 403 Forbidden；
 * 2. 所有只读接口均通过 { readonly: true } 句柄读取 SQLite，绝无写操作；
 * 3. 字段形状全面适配前端现网消费契约，防止白屏。
 */

import { Router } from 'express';
import { getReadOnlyArchiveDb } from './db-readonly.js';
import { buildHealthPayload } from './health.js';

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
 * 2. 现网前端契约对齐的只读 GET 路由
 */

// GET /api/csrf-token (前端初始化防崩溃)
readonlyRouter.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: 'readonly_safe_token' });
});

// GET /api/config
readonlyRouter.get('/api/config', (req, res) => {
  res.json({
    success: true,
    config: {
      aiProvider: process.env.AI_PROVIDER || 'lm-studio',
      readonlyMode: true,
      role: 'web_dashboard',
    }
  });
});

// GET /api/messages (查询归档消息，兼容 data 与 messages)
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
    const total = countRow?.total || 0;

    res.json({
      success: true,
      data: rows,
      messages: rows,
      total,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/channels (兼容 data 与 channels)
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

    res.json({
      success: true,
      data: rows,
      channels: rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/speakers (兼容 data 与 speakers)
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

    res.json({
      success: true,
      data: rows,
      speakers: rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reports (兼容 data 与 reports)
readonlyRouter.get('/api/reports', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = db.prepare(`
      SELECT id, strategy, ai_model, start_time, end_time, created_at, raw_messages_count, summary_content
      FROM reports
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const countRow = db.prepare('SELECT count(*) as total FROM reports').get();
    const total = countRow?.total || 0;

    res.json({
      success: true,
      data: rows,
      reports: rows,
      total,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/news-summaries (兼容 data 与 summaries)
readonlyRouter.get('/api/news-summaries', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = db.prepare(`
      SELECT id, batch_id, summary_type, title, start_time, end_time, created_at, raw_messages_count, summary_content
      FROM news_summaries
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const countRow = db.prepare('SELECT count(*) as total FROM news_summaries').get();
    const total = countRow?.total || 0;

    res.json({
      success: true,
      data: rows,
      summaries: rows,
      total,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/news-summaries/status
readonlyRouter.get('/api/news-summaries/status', (req, res) => {
  try {
    const db = getReadOnlyArchiveDb();
    if (!db) return res.json({ status: 'idle' });

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
    const db = getReadOnlyArchiveDb();
    if (!db) return res.json({ status: 'idle' });

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
    const db = getReadOnlyArchiveDb();
    if (!db) return res.json({ success: false, playbook: null });

    const row = db.prepare(`
      SELECT * FROM reports
      WHERE strategy = 'PERSONA_PLAYBOOK'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();

    res.json({
      success: !!row,
      playbook: row || null,
    });
  } catch (err) {
    res.json({ success: false, playbook: null, error: err.message });
  }
});

// GET /api/system/monitor
readonlyRouter.get('/api/system/monitor', (req, res) => {
  const health = buildHealthPayload();
  res.json({
    success: true,
    data: health,
  });
});

// GET /api/gpu/status
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
