/**
 * follow-replay-engine.js - 历史大V交易单回放校验与移动端纠错反馈引擎 (REQ-033)
 * 
 * 核心流程：
 * 1. 抽取特朗普访华（2026-05-15）至今所有赵哥交易单，建立持久化回放队列表 follow_replay_queue；
 * 2. 步进式推送：每次仅推送当前队头单据至企业微信群；
 * 3. 两种交互反馈路径：
 *    - 路径 A: 微信内点击一键确认跳过 -> 记录 confirmed_skip -> 自动推送下一条；
 *    - 路径 B: 微信内点击修正 -> 唤起移动端极简表单 -> 修改基础要素提交 -> 纠正入库 -> 自动推送下一条。
 */

import crypto from 'crypto';
import { getDb } from './database.js';
import dotenv from 'dotenv';

dotenv.config();

export function getBaseUrl() {
  return process.env.PUBLIC_URL || process.env.TUNNEL_URL || `http://${process.env.HOST_IP || '192.168.1.18'}:${process.env.PORT || 3000}`;
}
const REPLAY_SECRET = process.env.WECOM_HITL_SECRET || 'follow_replay_secret_key_2026';
const TRUMP_VISIT_START_TS = 1778803200000; // 2026-05-15 00:00:00 UTC

/**
 * 初始化回放数据库表结构
 */
export function initReplayTable(db = getDb()) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS follow_replay_queue (
      id TEXT PRIMARY KEY,
      pool_id TEXT,
      message_id TEXT,
      created_at INTEGER NOT NULL,
      raw_content TEXT NOT NULL,
      parsed_ticker TEXT NOT NULL,
      parsed_action TEXT NOT NULL,
      parsed_price REAL NOT NULL,
      parsed_qty INTEGER NOT NULL,
      fraction_desc TEXT,
      fraction_ratio REAL,
      before_qty INTEGER DEFAULT 0,
      before_avg_cost REAL DEFAULT 0,
      after_qty INTEGER DEFAULT 0,
      after_avg_cost REAL DEFAULT 0,
      user_qty INTEGER DEFAULT 0,
      user_avg_cost REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      corrected_json TEXT,
      reviewed_at INTEGER,
      seq_no INTEGER
    )
  `).run();

  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN fraction_desc TEXT").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN fraction_ratio REAL").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN before_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN before_avg_cost REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN after_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN after_avg_cost REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_avg_cost REAL DEFAULT 0").run(); } catch (_) {}

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_replay_status ON follow_replay_queue(status, seq_no ASC)
  `).run();
}

/**
 * 生成回放单操作签名 Token
 */
export function generateReplayToken(id, ticker, action) {
  const payload = `replay|${id}|${ticker}|${action}|${REPLAY_SECRET}`;
  return crypto.createHmac('sha256', REPLAY_SECRET).update(payload).digest('hex').substring(0, 24);
}

/**
 * 校验签名 Token
 */
export function verifyReplayToken(id, ticker, action, token) {
  if (!token) return false;
  const expected = generateReplayToken(id, ticker, action);
  return token === expected;
}

/**
 * 提炼仓位多维度描述（大V表述 + 比例折算）
 */
export function formatFractionDesc(fractionName, fractionRatio, rawContent) {
  const raw = rawContent || '';
  if (raw.includes('常规仓的一半') || raw.includes('一半常规仓')) {
    return '0.5 笔常规仓 (约占总资金 5.0%)';
  }
  if (raw.includes('三分之一常规仓') || raw.includes('1/3常规仓') || raw.includes('1/3 常规仓')) {
    return '1/3 笔常规仓 (约占总资金 3.3%)';
  }
  if (raw.includes('出一半') || raw.includes('半仓')) {
    return '0.5 笔仓位 (半仓 / 约 50% 标的持仓)';
  }
  if (raw.includes('清仓') || raw.includes('出完') || raw.includes('全出')) {
    return '全部清仓 (100% 标的持仓)';
  }
  if (fractionRatio) {
    const pct = (fractionRatio * 10).toFixed(1);
    return `${fractionName ? fractionName + ' ' : ''}(约占总资金 ${pct}%)`;
  }
  if (fractionName) {
    return fractionName;
  }
  return '常规操作 (未明确比例)';
}

/**
 * 从 trade_review_pool 初始化加载待回放单据
 */
export function loadReplayCandidates(db = getDb(), startTs = TRUMP_VISIT_START_TS, forceReload = false) {
  initReplayTable(db);

  if (forceReload) {
    db.prepare("DELETE FROM follow_replay_queue").run();
  } else {
    const existingCount = db.prepare("SELECT count(*) as c FROM follow_replay_queue").get().c;
    if (existingCount > 0) {
      return existingCount;
    }
  }

  // 抓取 2026-05-15 至今的池记录
  const candidates = db.prepare(`
    SELECT id, message_id, ticker, action, price, fraction_name, fraction_ratio, before_qty, before_avg_cost, after_qty, after_avg_cost, raw_content, created_at
    FROM trade_review_pool
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(startTs);

  console.log(`[Follow Replay] 从历史记录中提取到 ${candidates.length} 条待回放校验单据...`);

  const insertStmt = db.prepare(`
    INSERT INTO follow_replay_queue 
    (id, pool_id, message_id, created_at, raw_content, parsed_ticker, parsed_action, parsed_price, parsed_qty, fraction_desc, fraction_ratio, before_qty, before_avg_cost, after_qty, after_avg_cost, user_qty, user_avg_cost, status, seq_no)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  const runBatch = db.transaction((rows) => {
    let seq = 1;
    for (const r of rows) {
      const replayId = `rpl_${r.id}`;
      const tickerClean = (r.ticker || '').toUpperCase();

      // 计算本笔交易变动股数 (而非持仓基数)
      let deltaQty = Math.abs((r.after_qty || 0) - (r.before_qty || 0));
      if (deltaQty === 0) {
        if (r.fraction_ratio && r.price > 0) {
          deltaQty = Math.round((100000 * 0.1 * r.fraction_ratio) / r.price) || 100;
        } else {
          deltaQty = 100;
        }
      }

      const fractionDesc = formatFractionDesc(r.fraction_name, r.fraction_ratio, r.raw_content);

      // 查询个人模拟账户 (positions 表) 的当前实际持仓
      let uQty = 0;
      let uCost = 0;
      try {
        const userPos = db.prepare("SELECT quantity, average_entry_price FROM positions WHERE ticker = ?").get(tickerClean);
        if (userPos) {
          uQty = userPos.quantity || 0;
          uCost = userPos.average_entry_price || 0;
        }
      } catch (_) {}

      insertStmt.run(
        replayId,
        r.id,
        r.message_id || '',
        r.created_at,
        r.raw_content || '',
        tickerClean,
        (r.action || 'BUY').toUpperCase(),
        Number(r.price || 0),
        deltaQty,
        fractionDesc,
        r.fraction_ratio || null,
        r.before_qty || 0,
        r.before_avg_cost || 0,
        r.after_qty || 0,
        r.after_avg_cost || 0,
        uQty,
        uCost,
        seq++
      );
    }
  });

  runBatch(candidates);
  return candidates.length;
}

/**
 * 获取当前队头待审记录与全局统计
 */
export function getNextPendingReplayItem(db = getDb()) {
  initReplayTable(db);

  const current = db.prepare(`
    SELECT * FROM follow_replay_queue
    WHERE status = 'pending'
    ORDER BY seq_no ASC
    LIMIT 1
  `).get();

  const total = db.prepare("SELECT count(*) as c FROM follow_replay_queue").get().c;
  const processed = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status != 'pending'").get().c;
  const confirmed = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status = 'confirmed_skip'").get().c;
  const corrected = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status = 'corrected'").get().c;

  return {
    item: current || null,
    stats: {
      total,
      processed,
      pending: total - processed,
      confirmed,
      corrected,
      progressPct: total > 0 ? ((processed / total) * 100).toFixed(1) : '100.0'
    }
  };
}

/**
 * 构建企业微信推送 Markdown 卡片文本与操作 URL
 */
export function buildReplayWeComMessage(item, stats) {
  const token = generateReplayToken(item.id, item.parsed_ticker, item.parsed_action);
  const totalAmount = (item.parsed_price * item.parsed_qty).toFixed(2);
  const timeStr = new Date(item.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const baseUrl = getBaseUrl();
  const confirmSkipUrl = `${baseUrl}/api/follow/replay-callback?action=CONFIRM_SKIP&id=${item.id}&token=${token}`;
  const correctFormUrl = `${baseUrl}/follow/correct?id=${item.id}&token=${token}`;

  const isBuy = item.parsed_action === 'BUY';
  const actionZh = isBuy ? '🟢 买入 (BUY)' : '🔴 卖出 (SELL)';
  const actionColor = isBuy ? '#10b981' : '#ef4444';
  const fractionDesc = item.fraction_desc || '常规操作 (未明确比例)';
  
  // 赵哥已持仓累计与变动
  const beforeQ = item.before_qty || 0;
  const afterQ = item.after_qty || (isBuy ? beforeQ + item.parsed_qty : Math.max(0, beforeQ - item.parsed_qty));
  const beforeCostStr = item.before_avg_cost > 0 ? `$${item.before_avg_cost.toFixed(2)}` : '成本未计';
  const afterCostStr = item.after_avg_cost > 0 ? `$${item.after_avg_cost.toFixed(2)}` : '成本未计';

  // 个人模拟账户持仓（与赵哥推演严格物理隔离）
  const uQty = item.user_qty || 0;
  const uCostStr = item.user_avg_cost > 0 ? `$${item.user_avg_cost.toFixed(2)}` : '$0.00';
  const userPosDesc = uQty > 0 ? `${uQty} 股 (成本 ${uCostStr})` : '0 股 *(当前无持仓 / 历史回放仅跳过核验)*';

  const text = `### 📋 历史大V交易单回放校验 (#${item.seq_no}/${stats.total})
> **进度**: 已审 **${stats.processed}/${stats.total}** (${stats.progressPct}%) ｜ 确认正确: ${stats.confirmed} ｜ 已修正: ${stats.corrected}

**原始大V发言**:
> 「*${item.raw_content}*」

---
- **发言时间**: \`${timeStr}\`
- **解析标的**: **${item.parsed_ticker}**
- **交易方向**: <font color="${actionColor}">${actionZh}</font>
- **委托价格**: \`$${item.parsed_price.toFixed(2)}\`
- **仓位维度 (大V表述)**: **${fractionDesc}**
- **参考委托股数**: \`${item.parsed_qty} 股\` *(交易额: $${totalAmount})*
---
📊 **双账本已持仓位对比**：
- **赵哥推演持仓**: \`${beforeQ} 股\` (${beforeCostStr}) ➔ \`${afterQ} 股\` (${afterCostStr})
- **个人模拟账户**: \`${userPosDesc}\`
---
👉 **请对照原始发言进行确认**：
1. **[✅ 确认解析正确 (跳过交易)](${confirmSkipUrl})**  
*(一键点击，判定解析准确并自动推送下一条)*
2. **[✏️ 存在解析错误 (在表单中修改)](${correctFormUrl})**  
*(微信内打开表单，修改时间/标的/方向/价格/数量/仓位表述后提交)*`;

  return { text, confirmSkipUrl, correctFormUrl };
}

/**
 * 发送当前队头卡片至企业微信
 */
export async function pushCurrentReplayCard(db = getDb()) {
  const { item, stats } = getNextPendingReplayItem(db);
  if (!item) {
    console.log('[Follow Replay] 🎉 队列已全部审核完毕！没有更多待审单据。');
    return { finished: true, stats };
  }

  const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('WECHAT_WORK_WEBHOOK_URL is not configured in .env');
  }

  const { text } = buildReplayWeComMessage(item, stats);

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: text }
    })
  });

  const json = await res.json().catch(() => ({}));
  if (json.errcode !== 0) {
    console.error(`[Follow Replay] 推送企微失败: errcode=${json.errcode}, errmsg=${json.errmsg}`);
    return { success: false, error: json.errmsg, item, stats };
  }

  console.log(`[Follow Replay] ✅ 已成功推送第 #${item.seq_no} 条待审单 (${item.parsed_ticker})`);
  return { success: true, item, stats };
}

/**
 * 处理用户点击「确认解析正确 (跳过交易)」
 */
export async function handleReplayConfirmSkip(id, token, userid = 'human', db = getDb()) {
  initReplayTable(db);

  const row = db.prepare("SELECT * FROM follow_replay_queue WHERE id = ?").get(id);
  if (!row) {
    return { success: false, code: 404, error: '单据不存在' };
  }
  if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
    return { success: false, code: 400, error: 'Token 验签失败或已失效' };
  }
  if (row.status !== 'pending') {
    return { success: false, code: 409, error: `该单据已处理 (状态: ${row.status})` };
  }

  const now = Date.now();
  db.prepare(`
    UPDATE follow_replay_queue
    SET status = 'confirmed_skip', reviewed_at = ?
    WHERE id = ?
  `).run(now, id);

  // 标记 trade_review_pool 为 confirmed
  if (row.pool_id) {
    try {
      db.prepare(`
        UPDATE trade_review_pool 
        SET status = 'confirmed', updated_at = ? 
        WHERE id = ?
      `).run(now, row.pool_id);
    } catch (_) {}
  }

  // 异步触发推送下一条 (若非测试模式)
  if (process.env.NODE_ENV !== 'test') {
    setImmediate(() => {
      pushCurrentReplayCard(db).catch(err => console.error('[Follow Replay] 推进下一条异常:', err.message));
    });
  }

  return {
    success: true,
    message: `已确认单据 #${row.seq_no} (${row.parsed_ticker}) 解析正确，正在推送下一条...`
  };
}

/**
 * 处理用户在表单中提交纠错信息
 */
export async function handleReplayCorrectionSubmit(data, userid = 'human', db = getDb()) {
  const { id, token, ticker, action, price, quantity, fraction_desc, trade_time, note } = data;
  initReplayTable(db);

  const row = db.prepare("SELECT * FROM follow_replay_queue WHERE id = ?").get(id);
  if (!row) {
    return { success: false, code: 404, error: '单据不存在' };
  }
  if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
    return { success: false, code: 400, error: 'Token 验签失败或已失效' };
  }

  const cleanTicker = String(ticker || '').trim().toUpperCase();
  const cleanAction = String(action || '').trim().toUpperCase();
  const cleanPrice = parseFloat(price);
  const cleanQty = parseInt(quantity, 10);
  const cleanTime = trade_time ? new Date(trade_time).getTime() : row.created_at;
  const cleanFraction = String(fraction_desc || row.fraction_desc || '').trim();

  if (!cleanTicker || !['BUY', 'SELL'].includes(cleanAction) || isNaN(cleanPrice) || cleanPrice <= 0 || isNaN(cleanQty) || cleanQty <= 0) {
    return { success: false, code: 400, error: '提交的要素格式不合法 (标的、方向、价格、数量不能为空且必须大于0)' };
  }

  const correctionPayload = {
    original: {
      ticker: row.parsed_ticker,
      action: row.parsed_action,
      price: row.parsed_price,
      quantity: row.parsed_qty,
      fraction_desc: row.fraction_desc,
      time: row.created_at
    },
    corrected: {
      ticker: cleanTicker,
      action: cleanAction,
      price: cleanPrice,
      quantity: cleanQty,
      fraction_desc: cleanFraction,
      time: cleanTime,
      totalAmount: (cleanPrice * cleanQty).toFixed(2),
      note: note || '',
      corrected_by: userid
    }
  };

  const now = Date.now();
  db.prepare(`
    UPDATE follow_replay_queue
    SET status = 'corrected', 
        parsed_ticker = ?, 
        parsed_action = ?, 
        parsed_price = ?, 
        parsed_qty = ?, 
        fraction_desc = ?,
        corrected_json = ?, 
        reviewed_at = ?
    WHERE id = ?
  `).run(cleanTicker, cleanAction, cleanPrice, cleanQty, cleanFraction, JSON.stringify(correctionPayload), now, id);

  // 纠正回写 trade_review_pool 表
  if (row.pool_id) {
    try {
      db.prepare(`
        UPDATE trade_review_pool 
        SET ticker = ?, action = ?, price = ?, fraction_name = ?, is_manual = 1, status = 'confirmed', updated_at = ?
        WHERE id = ?
      `).run(cleanTicker, cleanAction, cleanPrice, cleanFraction, now, row.pool_id);
    } catch (_) {}
  }

  // REQ-035: 同步纠错流水至 trade_signals 底册 (打上 source: manual_correct)
  try {
    const { saveTradeSignal } = await import('./database.js');
    saveTradeSignal({
      signal_id: `sig_corr_${row.id}_${now}`,
      message_id: row.message_id || null,
      channel_id: null,
      speaker_name: '赵哥(人工修正)',
      ticker: cleanTicker,
      action: cleanAction,
      price: cleanPrice,
      quantity: cleanQty,
      reason: `回放纠错 #${row.seq_no}: ${cleanFraction}`,
      parse_status: 'ok',
      source: 'manual_correct',
      created_at: cleanTime
    }, db);
  } catch (_) {}

  // 异步触发推送下一条 (若非测试环境)
  if (process.env.NODE_ENV !== 'test') {
    setImmediate(() => {
      pushCurrentReplayCard(db).catch(err => console.error('[Follow Replay] 推进下一条异常:', err.message));
    });
  }

  return {
    success: true,
    message: `已成功保存对 #${row.seq_no} 单的纠错修正，正在推送下一条...`,
    correction: correctionPayload
  };
}
