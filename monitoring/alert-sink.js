/**
 * P0-1: WeCom alert sink with edge-trigger, critical dedupe, warn aggregation.
 * Side-path only — never writes whop_archive.db (R3).
 * Wraps the same WeCom markdown webhook contract as monitor.pushToWeChat.
 */

const WECHAT_MAX_LENGTH = 4000;
const CRITICAL_DEDUPE_MS = 10 * 60 * 1000;
const WARN_FLUSH_MS = 5 * 60 * 1000;
const RING_MAX = 500;

/** @type {Map<string, { level: string, at: number }>} */
const lastState = new Map();
/** @type {Map<string, number>} */
const lastCriticalSentAt = new Map();
/** @type {Array<{ subsystem: string, title: string, detail: string, at: number }>} */
const warnBucket = [];
/** @type {Array<object>} */
const ringBuffer = [];

let warnFlushTimer = null;
let pushImpl = null;
let nowFn = () => Date.now();

/**
 * Inject clock / push for tests. Production uses real webhook push.
 */
export function _resetAlertSinkForTests({ now, push } = {}) {
  lastState.clear();
  lastCriticalSentAt.clear();
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
      .map(([k, v]) => `- ${k}: \`${v}\``)
      .join('\n');
    if (bits) lines.push('\n**证据**\n' + bits);
  }
  if (suggestion) lines.push(`\n**建议**: ${suggestion}`);
  lines.push(`\n_${new Date(nowFn()).toISOString()}_`);
  return lines.filter(Boolean).join('\n');
}

async function emitNow(payload) {
  const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
  const md = formatAlertMarkdown(payload);
  pushToRing({ ...payload, at: nowFn(), delivered: true });
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
 * Edge-triggered alert.
 * - critical: send on edge into critical; 10min fingerprint dedupe while staying bad; recovery notice once
 * - warn: edge into warn buckets for aggregation (or immediate if forceImmediate)
 * - ok: recovery notice when leaving warn/critical
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

  // Recovery edge
  if (lvl === 'ok') {
    if (!prev || prev.level === 'ok') {
      lastState.set(stateKey, { level: 'ok', at: now });
      return { action: 'noop' };
    }
    lastState.set(stateKey, { level: 'ok', at: now });
    lastCriticalSentAt.delete(fp);
    const result = await emitNow({
      level: 'ok',
      subsystem,
      title: `已恢复: ${title}`,
      detail: detail || `子系统 \`${subsystem}\` 已从 ${prev.level} 恢复`,
      evidence,
      suggestion,
      kind: 'recovery',
    });
    return { action: 'recovery', ...result };
  }

  const entering = !prev || prev.level !== lvl;
  lastState.set(stateKey, { level: lvl, at: now });

  if (lvl === 'critical') {
    const lastSent = lastCriticalSentAt.get(fp) || 0;
    if (!entering && now - lastSent < CRITICAL_DEDUPE_MS) {
      pushToRing({ subsystem, level: lvl, title, detail, at: now, delivered: false, reason: 'dedupe' });
      return { action: 'deduped' };
    }
    lastCriticalSentAt.set(fp, now);
    const result = await emitNow({
      level: 'critical',
      subsystem,
      title,
      detail,
      evidence,
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
      evidence,
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
      evidence,
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
    criticalDedupeMs: CRITICAL_DEDUPE_MS,
    warnFlushMs: WARN_FLUSH_MS,
  };
}
