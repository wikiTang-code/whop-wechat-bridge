/**
 * @file monitoring/asset-freshness-probe.js
 * @description P1-9: 离线资产新鲜度探针 (E 组子系统)
 *
 * 作用：
 * 只读探测 Persona 画像、L2a 切窗水位与 News 新闻分析的滞后天数/小时数，
 * 超过预期更新周期时主动产生 warn / critical 告警，彻底根除长期滞后无人知晓的隐患。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { formatBeijingTime } from './alert-sink.js';
import { evaluateNewsFreshness } from './news-freshness.js';

let readOnlyDb = null;
let lastSnapshot = {
  status: 'ok',
  checkedAt: null,
  summary: '暂无采样',
  assets: {},
};

function getReadOnlyDb() {
  if (readOnlyDb) return readOnlyDb;
  const dbPath = path.resolve('whop_archive.db');
  if (!fs.existsSync(dbPath)) return null;

  try {
    readOnlyDb = new Database(dbPath, { readonly: true, timeout: 2000 });
    return readOnlyDb;
  } catch (e) {
    console.warn('[AssetProbe] 无法以只读模式打开 whop_archive.db:', e.message);
    return null;
  }
}

/**
 * 检查离线资产新鲜度
 */
export function checkAssetFreshness({
  personaWarnHours = 48,
  personaCriticalDays = 7,
  l2aWarnDays = 3,
  nowMs = Date.now(),
  /** 测试可注入；默认走 News 专用休市空窗（含周六上午监控窗） */
  isMarketClosed = null,
} = {}) {
  const db = getReadOnlyDb();
  const now = nowMs;

  if (!db) {
    lastSnapshot = {
      status: 'warn',
      checkedAt: formatBeijingTime(),
      summary: '主数据库未就绪，无法探测资产新鲜度',
      assets: {},
    };
    return lastSnapshot;
  }

  try {
    // 1. 检查 Persona Playbook
    const personaRow = db.prepare(`
      SELECT created_at FROM reports
      WHERE strategy = 'PERSONA_PLAYBOOK'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    const personaTs = personaRow ? Number(personaRow.created_at) : null;
    const personaLagHours = personaTs ? Math.round(((now - personaTs) / (1000 * 3600)) * 10) / 10 : null;
    const personaLagDays = personaLagHours ? Math.round((personaLagHours / 24) * 10) / 10 : null;

    let personaLevel = 'ok';
    if (!personaTs || personaLagDays >= personaCriticalDays) {
      personaLevel = 'critical';
    } else if (personaLagHours >= personaWarnHours) {
      personaLevel = 'warn';
    }

    // 2. 检查 L2a 切窗水位
    const l2aWmRow = db.prepare(`
      SELECT last_processed_ts FROM pipeline_watermarks
      WHERE pipeline_name = 'wm_l2a_cut'
    `).get();

    const l2aTs = l2aWmRow ? Number(l2aWmRow.last_processed_ts) : null;
    const l2aLagDays = l2aTs ? Math.round(((now - l2aTs) / (1000 * 3600 * 24)) * 10) / 10 : null;
    let l2aLevel = 'ok';
    if (!l2aTs || l2aLagDays >= l2aWarnDays) {
      l2aLevel = 'warn';
    }

    // 3. 检查 News 新闻分析（优先 news_summaries 表，兼顾 reports 表）
    let newsTs = null;
    try {
      const nsRow = db.prepare(`
        SELECT created_at FROM news_summaries
        ORDER BY created_at DESC LIMIT 1
      `).get();
      if (nsRow && nsRow.created_at) newsTs = Number(nsRow.created_at);
    } catch (e) {
      // 兼容表不存在的极端情况
    }

    if (!newsTs) {
      try {
        const repRow = db.prepare(`
          SELECT created_at FROM reports
          WHERE strategy = 'MARKET_NEWS_ANALYSIS'
          ORDER BY created_at DESC LIMIT 1
        `).get();
        if (repRow && repRow.created_at) newsTs = Number(repRow.created_at);
      } catch (e) {}
    }

    const newsEval = evaluateNewsFreshness({
      latestNewsTs: newsTs,
      nowMs: now,
      isMarketClosed,
    });
    const newsLevel = newsEval.status;
    const newsDescription = newsEval.description;
    const newsLagHours = newsEval.lagHours;
    const marketClosed = newsEval.marketClosed;

    // 4. 汇总判定整体资产健康度
    const levels = [personaLevel, l2aLevel, newsLevel];
    let overall = 'ok';
    if (levels.includes('critical')) overall = 'critical';
    else if (levels.includes('warn')) overall = 'warn';

    const assets = {
      persona: {
        status: personaLevel,
        lastUpdated: personaTs ? new Date(personaTs).toISOString() : null,
        lagDays: personaLagDays,
        lagHours: personaLagHours,
        description: personaTs ? `已滞后 ${personaLagDays} 天` : '未生成',
      },
      l2a_watermark: {
        status: l2aLevel,
        lastProcessedTs: l2aTs,
        lagDays: l2aLagDays,
        description: l2aTs ? `水位推进至 ${l2aLagDays} 天前` : '未记录',
      },
      news: {
        status: newsLevel,
        lastUpdated: newsTs ? new Date(newsTs).toISOString() : null,
        lagHours: newsLagHours,
        description: newsDescription,
        marketClosed,
        maxAllowedLagHours: newsEval.maxAllowedLagHours,
      },
    };

    const summary = `Persona ${assets.persona.description} · L2a ${assets.l2a_watermark.description} · 资产状态 ${overall.toUpperCase()}`;

    lastSnapshot = {
      status: overall,
      checkedAt: formatBeijingTime(now),
      summary,
      assets,
    };

    return lastSnapshot;
  } catch (err) {
    console.warn('[AssetProbe] 资产探测异常:', err.message);
    lastSnapshot = {
      status: 'warn',
      checkedAt: formatBeijingTime(now),
      summary: `资产探测异常: ${err.message}`,
      assets: {},
    };
    return lastSnapshot;
  }
}

export function getAssetFreshnessSnapshot() {
  return { ...lastSnapshot };
}

export function closeAssetProbeDb() {
  if (readOnlyDb) {
    try {
      readOnlyDb.close();
    } catch (_) {}
    readOnlyDb = null;
  }
}
