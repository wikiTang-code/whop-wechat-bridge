import crypto from 'crypto';
import { getDb, saveFollowDecision } from './database.js';
import { executeOrder } from './trading.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 业务跟单移动端 HITL 交互引擎 (Follow HITL Engine)
 * 对应 REQ-029 与 CHG-009，严格对齐 follow-hitl-plan.md Phase C
 * 物理隔离于运维 /ops，禁止任何运维 C2 越权
 */

const HITL_SECRET = process.env.WECOM_HITL_SECRET || 'follow_hitl_secret_key_2026';
const DEFAULT_TTL_SEC = 90;

/**
 * 生成防篡改签名 Token
 */
export function generateHitlToken(decisionId, ticker, action, createdAt) {
  const payload = `${decisionId}|${ticker}|${action}|${createdAt}`;
  return crypto.createHmac('sha256', HITL_SECRET).update(payload).digest('hex').substring(0, 32);
}

/**
 * 校验防篡改 Token
 */
export function verifyHitlToken(decisionId, ticker, action, createdAt, token) {
  if (!token || typeof token !== 'string') return false;
  const expected = generateHitlToken(decisionId, ticker, action, createdAt);
  const bufToken = Buffer.from(token);
  const bufExpected = Buffer.from(expected);
  if (bufToken.length !== bufExpected.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufToken, bufExpected);
}

/**
 * 解析允许操作的 UserID 白名单
 */
export function getAuthorizedUsers() {
  const raw = process.env.WECOM_FOLLOW_USERIDS || process.env.WECOM_OPS_USERIDS || '';
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

/**
 * 生成移动端交互确认卡片 Payload
 * @param {Object} decision - follow_decisions 记录
 * @returns {Object} 结构化卡片载荷
 */
export function generateFollowCardPayload(decision) {
  const ttlSec = DEFAULT_TTL_SEC;
  const createdAt = decision.created_at || Date.now();
  const expiresAt = createdAt + ttlSec * 1000;
  const token = generateHitlToken(decision.decision_id, decision.ticker, decision.side, createdAt);

  return {
    card_type: 'follow_execution_confirm',
    decision_id: decision.decision_id,
    ticker: decision.ticker,
    side: decision.side,
    call_price: decision.call_price,
    arrival_price: decision.arrival_price,
    slip_bps: decision.slip_bps,
    ttl_sec: ttlSec,
    expires_at: expiresAt,
    token,
    actions: [
      { id: 'EXECUTE', label: '🟢 确认执行跟单', style: 'primary' },
      { id: 'SKIP', label: '⚪ 放弃本次跟单', style: 'default' },
      { id: 'PARSE_ERROR', label: '⚠️ 标记解析错误', style: 'danger' }
    ]
  };
}

/**
 * 处理移动端 HITL 确认回调 (Handle HITL Callback)
 * @param {Object} params
 * @param {string} params.decision_id - 决策 ID
 * @param {string} params.action - 'EXECUTE' | 'SKIP' | 'PARSE_ERROR'
 * @param {string} params.userid - 操作人企微 ID
 * @param {string} params.token - 防篡改验证 Token
 * @param {number} [params.nowMs] - 当前时间戳 (测试用)
 */
export async function handleFollowHitlCallback({
  decision_id,
  action,
  userid,
  token,
  nowMs = Date.now()
}) {
  const db = getDb();

  // 1. 白名单鉴权：操作人校验
  const authorizedUsers = getAuthorizedUsers();
  if (authorizedUsers.size > 0 && (!userid || !authorizedUsers.has(String(userid).trim()))) {
    console.warn(`[Follow HITL 越权拦截] 未经授权的用户企图操作跟单卡片: userid=${userid}`);
    return {
      success: false,
      code: 403,
      error: `越权拦截：您的账号 (${userid || '未知'}) 未在跟单确认白名单中`
    };
  }

  // 2. 查询决策记录
  const decision = db.prepare('SELECT * FROM follow_decisions WHERE decision_id = ?').get(decision_id);
  if (!decision) {
    return {
      success: false,
      code: 404,
      error: `决策记录不存在: ${decision_id}`
    };
  }

  // 3. Token 防篡改签名核验
  const isValidToken = verifyHitlToken(decision.decision_id, decision.ticker, decision.side, decision.created_at, token);
  if (!isValidToken) {
    console.warn(`[Follow HITL 验签失败] decision_id=${decision_id} token 不匹配`);
    return {
      success: false,
      code: 400,
      error: '签名无效或已被篡改，拒绝操作'
    };
  }

  // 4. 防重放校验：若已处理过则拒绝重复操作
  const terminalStates = ['APPROVED_BY_USER', 'SKIPPED_BY_USER', 'PARSE_ERROR_REPORTED', 'SKIP_MANUAL_TIMEOUT'];
  if (terminalStates.includes(decision.decision_state)) {
    return {
      success: false,
      code: 409,
      error: `该卡片已被处理，当前状态为: ${decision.decision_state}`
    };
  }

  // 5. 90秒硬超时判定 (TTL Check)
  const elapsedSec = (nowMs - decision.created_at) / 1000;
  if (elapsedSec > DEFAULT_TTL_SEC) {
    // 标记为超时失效
    db.prepare(`
      UPDATE follow_decisions
      SET decision_state = 'SKIP_MANUAL_TIMEOUT', reason = ?, updated_at = ?
      WHERE decision_id = ?
    `).run(`90秒无操作自动超时放弃 (已过去 ${elapsedSec.toFixed(1)}s)`, nowMs, decision_id);

    return {
      success: false,
      code: 408,
      error: `已超时 (${elapsedSec.toFixed(1)}s > 90s)，已自动放弃跟单并销毁卡片`
    };
  }

  // 6. 执行动作分流
  const act = String(action || '').toUpperCase();

  if (act === 'EXECUTE') {
    // A: 批准实盘执行
    db.prepare(`
      UPDATE follow_decisions
      SET decision_state = 'APPROVED_BY_USER', reason = ?, updated_at = ?
      WHERE decision_id = ?
    `).run(`经用户 ${userid} 人工点击卡片授权执行实盘`, nowMs, decision_id);

    // 授权直连实盘下单 (isApprovedReal = true)
    let orderResult = null;
    try {
      orderResult = await executeOrder({
        ticker: decision.ticker,
        action: decision.side,
        price: decision.arrival_price || decision.call_price,
        quantity: decision.executed_qty || 100,
        account_type: 'real',
        isApprovedReal: true,
        reason: `[HITL 卡片确认] 用户 ${userid} 授权买入/卖出`
      });
    } catch (err) {
      console.error('[Follow HITL 实盘下单异常]:', err.message);
      orderResult = { success: false, reason: err.message };
    }

    return {
      success: true,
      decision_state: 'APPROVED_BY_USER',
      message: `已成功授权实盘执行: ${decision.side} ${decision.ticker} (${orderResult?.mode || 'LIVE'})`,
      orderResult
    };

  } else if (act === 'SKIP') {
    // B: 放弃本次跟单
    db.prepare(`
      UPDATE follow_decisions
      SET decision_state = 'SKIPPED_BY_USER', reason = ?, updated_at = ?
      WHERE decision_id = ?
    `).run(`用户 ${userid} 点击放弃跟单`, nowMs, decision_id);

    return {
      success: true,
      decision_state: 'SKIPPED_BY_USER',
      message: `已放弃本次跟单: ${decision.side} ${decision.ticker}`
    };

  } else if (act === 'PARSE_ERROR') {
    // C: 标记解析错误反馈
    db.prepare(`
      UPDATE follow_decisions
      SET decision_state = 'PARSE_ERROR_REPORTED', reason = ?, updated_at = ?
      WHERE decision_id = ?
    `).run(`用户 ${userid} 反馈该交易信号解析错误，绝不计入大V成交与实盘`, nowMs, decision_id);

    // 回写 trade_review_pool 表（若有关联消息）
    if (decision.message_id || decision.action_id) {
      try {
        db.prepare(`
          UPDATE trade_review_pool
          SET status = 'rejected', is_manual = 1, updated_at = ?
          WHERE id = ? OR message_id = ?
        `).run(nowMs, decision.action_id, decision.message_id);
      } catch (_) {}
    }

    return {
      success: true,
      decision_state: 'PARSE_ERROR_REPORTED',
      message: `已记录信号解析错误反馈，该单已被剔除，不计入任何持仓`
    };

  } else {
    return {
      success: false,
      code: 400,
      error: `不支持的动作类型: ${action}`
    };
  }
}
