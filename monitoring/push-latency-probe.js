/**
 * @file monitoring/push-latency-probe.js
 * @description P1-10: 大V发言到企微推送与交易提取链路的端到端时延 (TTL) 与积压监测探针
 *
 * 核心指标：
 * 1. 端到端 TTL (Time-To-Live / E2E Latency): 大V消息在 Whop 发布到推送企微成功的总耗时 (pushEnd - msg.created_at)
 * 2. 企微网络往返时延 (Push RTT): 企微 Webhook 单次 HTTP POST 往返耗时
 * 3. 待推送/待跟单实时积压: 0 锁只读扫描 messages 表中的未推送与未交易大V发言
 * 4. 连续失败熔断感知: 监控企微 Webhook 连续抛错次数，防止静默掉线
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { formatBeijingTime } from './alert-sink.js';

const RING_MAX = 50;
const pushHistory = []; // 环形缓冲区，最近 50 次推送指标
let consecutiveFailures = 0;
let lastPushMetric = null;

let readOnlyDb = null;
let lastSnapshot = {
  status: 'ok',
  checkedAt: null,
  summary: '暂无推送监测采样',
  pendingPushes: 0,
  pendingTrades: 0,
  oldestPendingWaitSec: 0,
  recentP95TtlMs: 0,
  recentAvgTtlMs: 0,
  recentSuccessRate: 1.0,
  consecutiveFailures: 0,
  lastPush: null,
};

function getReadOnlyDb() {
  if (readOnlyDb) return readOnlyDb;
  const dbPath = path.resolve('whop_archive.db');
  if (!fs.existsSync(dbPath)) return null;

  try {
    readOnlyDb = new Database(dbPath, { readonly: true, timeout: 2000 });
    return readOnlyDb;
  } catch (e) {
    console.warn('[PushLatencyProbe] 无法以只读方式打开 whop_archive.db:', e.message);
    return null;
  }
}

/**
 * 记录一次大V消息推送的度量数据 (由 monitor.js 推送完成时调用)
 */
export function recordPushMetric({
  messageId,
  speakerName = 'unknown',
  createdAt = Date.now(),
  pushedAt = Date.now(),
  ttlMs = null,
  rttMs = null,
  success = true,
  error = null,
  skipped = false,
}) {
  const finalTtl = ttlMs !== null ? ttlMs : Math.max(0, pushedAt - createdAt);
  const metric = {
    messageId,
    speakerName,
    createdAt,
    pushedAt,
    ttlMs: finalTtl,
    rttMs: rttMs || 0,
    success: !!success,
    error: error ? String(error) : null,
    skipped: !!skipped,
    recordedAtBeijing: formatBeijingTime(pushedAt),
  };

  if (success) {
    consecutiveFailures = 0;
  } else if (!skipped) {
    consecutiveFailures += 1;
  }

  lastPushMetric = metric;

  pushHistory.push(metric);
  if (pushHistory.length > RING_MAX) {
    pushHistory.shift();
  }

  return metric;
}

/**
 * 计算最近推送历史的时延分位数与统计信息
 */
export function calculateRecentPushStats() {
  const nonSkipped = pushHistory.filter(m => !m.skipped);
  if (nonSkipped.length === 0) {
    return {
      sampleCount: 0,
      avgTtlMs: 0,
      p95TtlMs: 0,
      maxTtlMs: 0,
      avgRttMs: 0,
      successRate: 1.0,
      consecutiveFailures,
      lastPush: lastPushMetric,
    };
  }

  let totalTtl = 0;
  let totalRtt = 0;
  let successCount = 0;
  const ttls = [];

  for (const item of nonSkipped) {
    totalTtl += item.ttlMs;
    totalRtt += item.rttMs;
    if (item.success) successCount += 1;
    ttls.push(item.ttlMs);
  }

  ttls.sort((a, b) => a - b);
  const p95Idx = Math.floor(ttls.length * 0.95);
  const p95TtlMs = ttls[Math.min(p95Idx, ttls.length - 1)] || 0;
  const maxTtlMs = ttls[ttls.length - 1] || 0;

  return {
    sampleCount: nonSkipped.length,
    avgTtlMs: Math.round(totalTtl / nonSkipped.length),
    p95TtlMs: Math.round(p95TtlMs),
    maxTtlMs: Math.round(maxTtlMs),
    avgRttMs: Math.round(totalRtt / nonSkipped.length),
    successRate: parseFloat((successCount / nonSkipped.length).toFixed(2)),
    consecutiveFailures,
    lastPush: lastPushMetric,
  };
}

/**
 * 巡检推送与交易链路健康度 (只读扫库 + 内存指标结合)
 */
export function checkPushPipelineHealth({
  warnTtlMs = 60_000,
  criticalTtlMs = 120_000,
  warnPendingAgeMs = 45_000,
  criticalPendingAgeMs = 120_000,
} = {}) {
  const now = Date.now();
  const recentStats = calculateRecentPushStats();
  const db = getReadOnlyDb();

  const targetSpeakersStr = process.env.TARGET_SPEAKER_USER_IDS || '';
  const targetSpeakers = targetSpeakersStr.split(',').map(s => s.trim()).filter(Boolean);

  let pendingPushes = 0;
  let pendingTrades = 0;
  let oldestPushAgeMs = 0;
  let oldestTradeAgeMs = 0;

  if (db && targetSpeakers.length > 0) {
    try {
      const placeholders = targetSpeakers.map(() => '?').join(',');
      const recentWindow = now - (30 * 60 * 1000);

      // 1. 扫描未推送大V消息
      const pushSql = 'SELECT count(*) as cnt, min(created_at) as oldest_created_at FROM messages WHERE sender_id IN (' + placeholders + ') AND is_pushed = 0 AND created_at > ?';
      const pushRow = db.prepare(pushSql).get(...targetSpeakers, recentWindow);

      if (pushRow && pushRow.cnt > 0) {
        pendingPushes = pushRow.cnt;
        if (pushRow.oldest_created_at) {
          oldestPushAgeMs = Math.max(0, now - pushRow.oldest_created_at);
        }
      }

      // 2. 扫描未交易大V消息
      const tradeSql = 'SELECT count(*) as cnt, min(created_at) as oldest_created_at FROM messages WHERE sender_id IN (' + placeholders + ') AND is_traded = 0 AND created_at > ?';
      const tradeRow = db.prepare(tradeSql).get(...targetSpeakers, recentWindow);

      if (tradeRow && tradeRow.cnt > 0) {
        pendingTrades = tradeRow.cnt;
        if (tradeRow.oldest_created_at) {
          oldestTradeAgeMs = Math.max(0, now - tradeRow.oldest_created_at);
        }
      }
    } catch (err) {
      console.warn('[PushLatencyProbe] 只读查询积压异常:', err.message);
    }
  }

  // 判定状态等级
  let level = 'ok';
  const reasons = [];

  // Critical 判定
  if (consecutiveFailures >= 3) {
    level = 'critical';
    reasons.push(`企微推送连续失败 ${consecutiveFailures} 次`);
  } else if (oldestPushAgeMs >= criticalPendingAgeMs) {
    level = 'critical';
    reasons.push(`大V发言待推送积压严重，最长已滞留 ${(oldestPushAgeMs / 1000).toFixed(1)}s (>= 120s)`);
  } else if (recentStats.sampleCount >= 3 && recentStats.p95TtlMs >= criticalTtlMs) {
    level = 'critical';
    reasons.push(`大V发言端到端推送 P95 TTL 达 ${(recentStats.p95TtlMs / 1000).toFixed(1)}s (>= 120s)`);
  }

  // Warn 判定
  if (level !== 'critical') {
    if (consecutiveFailures >= 1) {
      level = 'warn';
      reasons.push(`企微推送单次失败 (连续失败 ${consecutiveFailures} 次)`);
    } else if (oldestPushAgeMs >= warnPendingAgeMs) {
      level = 'warn';
      reasons.push(`大V发言待推送等待 ${(oldestPushAgeMs / 1000).toFixed(1)}s (>= 45s)`);
    } else if (recentStats.sampleCount >= 3 && recentStats.p95TtlMs >= warnTtlMs) {
      level = 'warn';
      reasons.push(`大V发言端到端推送 P95 TTL 达 ${(recentStats.p95TtlMs / 1000).toFixed(1)}s (>= 60s)`);
    } else if (oldestTradeAgeMs >= criticalPendingAgeMs) {
      level = 'warn';
      reasons.push(`量化跟单提取存在滞后，最长滞留 ${(oldestTradeAgeMs / 1000).toFixed(1)}s`);
    }
  }

  const oldestWaitSec = Math.round(Math.max(oldestPushAgeMs, oldestTradeAgeMs) / 1000);
  const summary = reasons.length > 0
    ? reasons.join('; ')
    : `链路顺畅 (待推送: ${pendingPushes}, 待跟单: ${pendingTrades}, 最近P95 TTL: ${recentStats.p95TtlMs}ms)`;

  lastSnapshot = {
    status: level,
    checkedAt: formatBeijingTime(now),
    summary,
    pendingPushes,
    pendingTrades,
    oldestPendingWaitSec: oldestWaitSec,
    recentP95TtlMs: recentStats.p95TtlMs,
    recentAvgTtlMs: recentStats.avgTtlMs,
    recentSuccessRate: recentStats.successRate,
    consecutiveFailures,
    lastPush: recentStats.lastPush,
  };

  return lastSnapshot;
}

export function getPushPipelineSnapshot() {
  return lastSnapshot;
}

/**
 * 供测试重置内部状态
 */
export function _resetPushMetricsForTests() {
  pushHistory.length = 0;
  consecutiveFailures = 0;
  lastPushMetric = null;
  lastSnapshot = {
    status: 'ok',
    checkedAt: null,
    summary: '暂无推送监测采样',
    pendingPushes: 0,
    pendingTrades: 0,
    oldestPendingWaitSec: 0,
    recentP95TtlMs: 0,
    recentAvgTtlMs: 0,
    recentSuccessRate: 1.0,
    consecutiveFailures: 0,
    lastPush: null,
  };
}
