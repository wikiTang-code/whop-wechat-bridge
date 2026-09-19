/**
 * routes/follow_replay_routes.js
 * 历史交易单回放交互与移动端纠错路由模块 (REQ-033)
 * 支持独立挂载于 web_runner.js 与 server.js，确保云端/本地一键回调与纠错表单畅通
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database.js';
import {
  verifyReplayToken,
  calculateExposureStats,
  handleReplayCorrectionSubmit,
  handleReplayConfirmSkip,
  handleReplayRejectNonTrade
} from '../follow-replay-engine.js';

const router = express.Router();

// GET /follow/correct - 移动端极简纠错页面
router.get('/follow/correct', (req, res) => {
  const filePath = path.resolve('public/follow-correct.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send('页面未找到');
});

// GET /api/follow/replay-item - 获取当前待审/待纠错单据详情
router.get('/api/follow/replay-item', (req, res) => {
  try {
    const { id, token } = req.query;
    if (!id || !token) {
      return res.status(400).json({ success: false, error: '缺少 id 或 token' });
    }
    const db = getDb();
    const row = db.prepare('SELECT * FROM follow_replay_queue WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ success: false, error: '单据不存在' });
    }
    if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
      return res.status(403).json({ success: false, error: 'Token 验签失败' });
    }
    const exp = calculateExposureStats(row, db);
    res.json({ success: true, item: { ...row, exposure: exp } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/follow/correct-submit - 提交移动端纠错表单
router.post('/api/follow/correct-submit', async (req, res) => {
  try {
    const result = await handleReplayCorrectionSubmit(req.body || {}, req.headers['x-wecom-userid'] || 'human');
    if (!result.success) {
      return res.status(result.code || 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/follow/replay-callback - 微信内一键点击确认跳过或转存策略
router.get('/api/follow/replay-callback', async (req, res) => {
  try {
    const { action, id, token } = req.query;
    console.log(`[Follow Replay Callback] 收到回放请求: action=${action}, id=${id}, clientIp=${req.ip}`);
    if (action === 'CONFIRM_SKIP') {
      const result = await handleReplayConfirmSkip(id, token, req.headers['x-wecom-userid'] || 'human');
      if (!result.success) {
        if (result.code === 409) {
          return res.send(`
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>无需重复确认</title>
            <style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#0f172a;}
            .card{background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 12px rgba(0,0,0,0.06);max-width:400px;margin:0 auto;}
            </style></head><body>
            <div class="card">
              <div style="font-size:3rem;margin-bottom:12px;">ℹ️</div>
              <h2>该单据此前已确认处理</h2>
              <p style="color:#64748b;margin-top:10px;">${result.error}</p>
              <p style="margin-top:20px;font-size:0.9rem;color:#94a3b8;">系统采用【单据 UUID 强绑定机制】，每条链接仅对绑定的具体单据生效，无需重复点击。请返回微信查看当前最新推送的单据。</p>
            </div>
            </body></html>
          `);
        }
        return res.status(result.code || 400).send(`<h2 style="color:red">操作失败: ${result.error}</h2>`);
      }
      return res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>确认成功</title>
        <style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#0f172a;}
        .card{background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 12px rgba(0,0,0,0.06);max-width:400px;margin:0 auto;}
        .btn{display:inline-block;margin-top:20px;padding:12px 24px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold;}
        </style></head><body>
        <div class="card">
          <div style="font-size:3rem;margin-bottom:12px;">✅</div>
          <h2>已确认解析正确！</h2>
          <p style="color:#64748b;margin-top:10px;">${result.message}</p>
          <p style="margin-top:20px;font-size:0.9rem;color:#94a3b8;">已自动推送下一条到企业微信，请返回微信查看。</p>
        </div>
        </body></html>
      `);
    }

    if (action === 'REJECT_NON_TRADE' || action === 'CLASSIFY_STRATEGY') {
      const result = await handleReplayRejectNonTrade(id, token, 'strategy_plan', req.headers['x-wecom-userid'] || 'human');
      if (!result.success) {
        if (result.code === 409) {
          return res.send(`
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>无需重复确认</title>
            <style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#0f172a;}
            .card{background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 12px rgba(0,0,0,0.06);max-width:400px;margin:0 auto;}
            </style></head><body>
            <div class="card">
              <div style="font-size:3rem;margin-bottom:12px;">ℹ️</div>
              <h2>该单据此前已处理</h2>
              <p style="color:#64748b;margin-top:10px;">${result.error}</p>
              <p style="margin-top:20px;font-size:0.9rem;color:#94a3b8;">系统采用【单据 UUID 强绑定机制】，每条链接仅对绑定的具体单据生效。请返回微信查看当前最新推送的单据。</p>
            </div>
            </body></html>
          `);
        }
        return res.status(result.code || 400).send(`<h2 style="color:red">操作失败: ${result.error}</h2>`);
      }
      return res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>策略资产沉淀成功</title>
        <style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#0f172a;}
        .card{background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 12px rgba(0,0,0,0.06);max-width:400px;margin:0 auto;}
        </style></head><body>
        <div class="card">
          <div style="font-size:3rem;margin-bottom:12px;">💡</div>
          <h2>已成功沉淀为【大V策略资产】！</h2>
          <p style="color:#64748b;margin-top:10px;">${result.message}</p>
          <p style="margin-top:20px;font-size:0.9rem;color:#94a3b8;">已安全归档至策略规则与盯盘资产库（不影响即时交易持仓），系统已自动向企业微信推送下一条。</p>
        </div>
        </body></html>
      `);
    }

    res.status(400).send('未知动作');
  } catch (err) {
    res.status(500).send(`服务端异常: ${err.message}`);
  }
});

// POST /api/follow/replay-reject - 移动端一键转存为策略资产
router.post('/api/follow/replay-reject', async (req, res) => {
  try {
    const { id, token, reason } = req.body || {};
    const result = await handleReplayRejectNonTrade(id, token, reason || 'strategy_plan', req.headers['x-wecom-userid'] || 'human');
    if (!result.success) {
      return res.status(result.code || 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
