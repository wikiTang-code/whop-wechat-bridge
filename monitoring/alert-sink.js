/**
 * P0-1: WeCom alert sink with edge-trigger, critical dedupe, warn aggregation,
 * flapping dampening (anti-flood), slow-op attribution, and Beijing timezone formatting.
 * Side-path only — never writes whop_archive.db (R3).
 */

import { getRecentSlowOps } from './slow-log-tracker.js';
import { recordAlertHistory } from './monitoring-db.js';

const WECHAT_MAX_LENGTH = 4000;
const CRITICAL_DEDUPE_MS = 10 * 60 * 1000;
const WARN_FLUSH_MS = 5 * 60 * 1000;
const RING_MAX = 500;

// Flapping parameters
const FLAPPING_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const FLAPPING_THRESHOLD = 2;               // >2 level flips triggers flapping
const FLAPPING_SUSTAINED_OK_MS = 10 * 60 * 1000; // 10 min sustained OK to clear flapping

/** @type {Map<string, { level: string, at: number }>} */
const lastState = new Map();
/** @type {Map<string, number>} */
const lastCriticalSentAt = new Map();
/** @type {Map<string, { history: Array<{ level: string, at: number }>, isFlapping: boolean, lastFlapAlertSentAt: number, okSince: number }>} */
const flappingState = new Map();

/** @type {Array<{ subsystem: string, title: string, detail: string, at: number }>} */
const warnBucket = [];
/** @type {Array<object>} */
const ringBuffer = [];

let warnFlushTimer = null;
let pushImpl = null;
let nowFn = () => Date.now();

/**
 * Format timestamp to East-8 (Beijing Time) YYYY-MM-DD HH:mm:ss
 */
export function formatBeijingTime(ts = nowFn()) {
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' (北京时间)';
}

/**
 * Inject clock / push for tests. Production uses real webhook push.
 */
export function _resetAlertSinkForTests({ now, push } = {}) {
  lastState.clear();
  lastCriticalSentAt.clear();
  flappingState.clear();
  warnBucket.length = 0;
  ringBuffer.length = 0;
  if (warnFlushTimer) {
    clearInterval(warnFlushTimer);
    warnFlushTimer = null;
  }
  if (typeof now === 'function') nowFn = now;
  else nowFn = () => Date.now();
  if (typeof push === 'function') pushImpl = push;
  else pushImpl = null;
}

function fingerprint({ subsystem, level, title }) {
  return `${subsystem}|${level}|${title}`;
}

function pushToRing(entry) {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_MAX) ringBuffer.shift();
}

/**
 * Low-level WeCom markdown push (same contract as monitor.pushToWeChat).
 */
export async function pushToWeChat(webhookUrl, markdownContent) {
  if (pushImpl) {
    return pushImpl(webhookUrl, markdownContent);
  }
  if (!webhookUrl) {
    console.log('[AlertSink] Skipping WeChat push: webhook URL is not set.');
    return { skipped: true };
  }

  let content = String(markdownContent || '');
  if (content.length > WECHAT_MAX_LENGTH) {
    content = content.substring(0, WECHAT_MAX_LENGTH) + '\n\n---\n⚠️ *内容过长已截断*';
  }

  const webFetch = typeof fetch !== 'undefined' ? fetch : globalThis.fetch;
  const response = await webFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[AlertSink] WeChat HTTP ${response.status}: ${errText}`);
    return { ok: false, status: response.status };
  }

  const result = await response.json().catch(() => ({}));
  if (result.errcode !== 0) {
    console.error(`[AlertSink] WeChat API errcode=${result.errcode} errmsg=${result.errmsg}`);
    return { ok: false, errcode: result.errcode };
  }
  return { ok: true };
}

function formatAlertMarkdown({ level, subsystem, title, detail, evidence, suggestion, kind }) {
  const icon = level === 'critical' ? '🔴' : level === 'ok' ? '🟢' : '🟡';
  const lines = [
    `${icon} **[${String(level).toUpperCase()}] ${title}**`,
    `> 子系统: \`${subsystem}\` · ${kind || 'alert'}`,
    detail ? `\n${detail}` : '',
  ];
  if (evidence && typeof evidence === 'object') {
    const bits = Object.entries(evidence)
      .slice(0, 8)
      .map(([k, v]) => {
        const valStr = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
        return `- ${k}: \`${valStr}\``;
      })
      .join('\n');
    if (bits) lines.push('\n**证据**\n' + bits);
  }
  if (suggestion) lines.push(`\n**建议**: ${suggestion}`);
  lines.push(`\n_${formatBeijingTime(nowFn())}_`);
  return lines.filter(Boolean).join('\n');
}

async function emitNow(payload) {
  const webhookUrl = process.env.WECHAT_ALERT_WEBHOOK_URL || process.env.WECHAT_WORK_WEBHOOK_URL;
  const md = formatAlertMarkdown(payload);
  pushToRing({ ...payload, at: nowFn(), delivered: true });
  recordAlertHistory(payload);
  try {
    await pushToWeChat(webhookUrl, md);
    return { sent: true };
  } catch (err) {
    console.error('[AlertSink] push failed:', err.message);
    return { sent: false, error: err.message };
  }
}

function ensureWarnFlusher() {
  if (warnFlushTimer) return;
  warnFlushTimer = setInterval(() => {
    flushWarnBucket().catch((e) => console.error('[AlertSink] warn flush error:', e.message));
  }, WARN_FLUSH_MS);
  if (typeof warnFlushTimer.unref === 'function') warnFlushTimer.unref();
}

export async function flushWarnBucket() {
  if (warnBucket.length === 0) return { sent: false, count: 0 };
  const batch = warnBucket.splice(0, warnBucket.length);
  const detail = batch
    .map((w, i) => `${i + 1}. [\`${w.subsystem}\`] ${w.title}${w.detail ? ` — ${w.detail}` : ''}`)
    .join('\n');
  const result = await emitNow({
    level: 'warn',
    subsystem: 'aggregated',
    title: `聚合告警 (${batch.length} 条)`,
    detail,
    kind: 'warn-aggregate',
  });
  return { ...result, count: batch.length };
}

/**
 * Update flapping state machine and check if the subsystem is currently in flapping mode.
 * @param {string} stateKey
 * @param {string} newLevel
 * @param {number} now
 * @returns {{ isFlapping: boolean, justEnteredFlapping: boolean, flips: number }}
 */
function evaluateFlapping(stateKey, newLevel, now) {
  let record = flappingState.get(stateKey);
  if (!record) {
    record = { history: [], isFlapping: false, lastFlapAlertSentAt: 0, okSince: newLevel === 'ok' ? now : 0 };
    flappingState.set(stateKey, record);
  }

  // Prune history older than 10 minutes
  const cutoff = now - FLAPPING_WINDOW_MS;
  record.history = record.history.filter((h) => h.at >= cutoff);

  // Check if state changed
  const lastHistory = record.history[record.history.length - 1];
  if (!lastHistory || lastHistory.level !== newLevel) {
    record.history.push({ level: newLevel, at: now });
  }

  if (newLevel === 'ok') {
    if (!record.okSince) record.okSince = now;
  } else {
    record.okSince = 0;
  }

  // Count transitions (e.g. ok -> critical / critical -> ok) in last 10 min
  let flips = 0;
  for (let i = 1; i < record.history.length; i++) {
    if (record.history[i].level !== record.history[i - 1].level) {
      flips++;
    }
  }

  const wasFlapping = record.isFlapping;
  let justEnteredFlapping = false;

  if (!wasFlapping && flips > FLAPPING_THRESHOLD) {
    record.isFlapping = true;
    justEnteredFlapping = true;
  } else if (wasFlapping && newLevel === 'ok' && record.okSince && now - record.okSince >= FLAPPING_SUSTAINED_OK_MS) {
    // Clear flapping after 10 min sustained OK
    record.isFlapping = false;
    record.history = [];
  }

  return { isFlapping: record.isFlapping, justEnteredFlapping, flips };
}

/**
 * Edge-triggered alert with flapping dampening and slow-ops evidence.
 *
 * @returns {Promise<{ action: string, sent?: boolean }>}
 */
export async function sendAlert({
  subsystem,
  level,
  title,
  detail = '',
  evidence = null,
  suggestion = '',
  forceImmediate = false,
  key = null,
} = {}) {
  if (!subsystem || !level || !title) {
    throw new Error('sendAlert requires subsystem, level, title');
  }

  const stateKey = key || subsystem;
  const lvl = String(level).toLowerCase();
  const now = nowFn();
  const prev = lastState.get(stateKey);
  const fp = fingerprint({ subsystem: stateKey, level: lvl, title });

  // Attach recent slow operations if not already provided and level is non-ok
  let enrichedEvidence = evidence ? { ...evidence } : {};
  if (lvl !== 'ok' && !enrichedEvidence.recentSlowOps) {
    const slowOps = getRecentSlowOps(2);
    if (slowOps && slowOps.length > 0) {
      enrichedEvidence.recentSlowOps = slowOps.map(
        (s) => `${s.fn}(batch=${s.batchSize}) ${s.durationMs}ms [${s.timeStr}]`
      );
    }
  }

  // Evaluate flapping
  const { isFlapping, justEnteredFlapping, flips } = evaluateFlapping(stateKey, lvl, now);

  // Recovery edge
  if (lvl === 'ok') {
    if (!prev || prev.level === 'ok') {
      lastState.set(stateKey, { level: 'ok', at: now });
      return { action: 'noop' };
    }
    lastState.set(stateKey, { level: 'ok', at: now });
    lastCriticalSentAt.delete(fp);

    // FLAPPING DAMPENING: silence single recovery if in flapping mode
    if (isFlapping) {
      pushToRing({ subsystem, level: 'ok', title, detail, at: now, delivered: false, reason: 'flapping_silenced' });
      return { action: 'flapping_silenced', reason: 'high_frequency_oscillation' };
    }

    const result = await emitNow({
      level: 'ok',
      subsystem,
      title: `已恢复: ${title}`,
      detail: detail || `子系统 \`${subsystem}\` 已从 ${prev.level} 恢复`,
      evidence: enrichedEvidence,
      suggestion,
      kind: 'recovery',
    });
    return { action: 'recovery', ...result };
  }

  const entering = !prev || prev.level !== lvl;
  lastState.set(stateKey, { level: lvl, at: now });

  // If newly entered flapping state, send a summary notification and suppress repeated flapping floods
  if (justEnteredFlapping) {
    const flapRecord = flappingState.get(stateKey);
    flapRecord.lastFlapAlertSentAt = now;
    const result = await emitNow({
      level: 'warn',
      subsystem,
      title: `[震荡抑制] ${subsystem} 频繁卡死/恢复翻转 (${flips}次/10分钟)`,
      detail: `检测到子系统处于高频震荡状态（最近10分钟已发生 ${flips} 次状态翻转）。系统已自动启动告警抑制：单次恢复通知已静音，以消除刷屏骚扰。`,
      evidence: enrichedEvidence,
      suggestion: '请优先排查后台周期性大任务（如大批次 saveMessages/FTS/正则）；连续正常 10 分钟后才会发送最终恢复卡片。',
      kind: 'flapping-suppress',
    });
    return { action: 'flapping_suppressed', ...result };
  }

  if (lvl === 'critical') {
    const lastSent = lastCriticalSentAt.get(fp) || 0;
    if (!entering && now - lastSent < CRITICAL_DEDUPE_MS) {
      pushToRing({ subsystem, level: lvl, title, detail, at: now, delivered: false, reason: 'dedupe' });
      return { action: 'deduped' };
    }
    // If flapping and an alert was sent recently, dedupe strictly
    if (isFlapping) {
      const flapRecord = flappingState.get(stateKey);
      if (flapRecord && now - (flapRecord.lastFlapAlertSentAt || 0) < CRITICAL_DEDUPE_MS) {
        pushToRing({ subsystem, level: lvl, title, detail, at: now, delivered: false, reason: 'flapping_dedupe' });
        return { action: 'flapping_deduped' };
      }
      if (flapRecord) flapRecord.lastFlapAlertSentAt = now;
    }

    lastCriticalSentAt.set(fp, now);
    const result = await emitNow({
      level: 'critical',
      subsystem,
      title,
      detail,
      evidence: enrichedEvidence,
      suggestion,
      kind: entering ? 'edge' : 'dedupe-window-refresh',
    });
    return { action: entering ? 'edge' : 'refresh', ...result };
  }

  // warn — edge fires once; further warns queue for periodic aggregate flush
  if (forceImmediate) {
    const result = await emitNow({
      level: 'warn',
      subsystem,
      title,
      detail,
      evidence: enrichedEvidence,
      suggestion,
      kind: 'immediate',
    });
    return { action: 'immediate', ...result };
  }

  ensureWarnFlusher();

  if (entering) {
    const result = await emitNow({
      level: 'warn',
      subsystem,
      title,
      detail,
      evidence: enrichedEvidence,
      suggestion,
      kind: 'edge',
    });
    return { action: 'edge', ...result };
  }

  warnBucket.push({ subsystem, title, detail, at: now });
  return { action: 'queued', queued: warnBucket.length };
}

export function getAlertRingBuffer() {
  return ringBuffer.slice();
}

export function getAlertSinkStats() {
  return {
    ringSize: ringBuffer.length,
    warnQueued: warnBucket.length,
    trackedSubsystems: lastState.size,
    flappingSubsystems: Array.from(flappingState.entries())
      .filter(([, v]) => v.isFlapping)
      .map(([k]) => k),
    criticalDedupeMs: CRITICAL_DEDUPE_MS,
    warnFlushMs: WARN_FLUSH_MS,
  };
}
