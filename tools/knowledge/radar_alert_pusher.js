/**
 * tools/knowledge/radar_alert_pusher.js
 * REQ-046 — 美股盘中微观结构与四维共振预警企微卡片推送器 (Radar Alert Pusher)
 *
 * 核心逻辑:
 * 1. 触发门禁: 仅当四维共振打分达到高共振 (≥70分) 或王炸共振 (≥75分) 或命中 🌟 高胜率黄金战法时触发;
 * 2. 防抖与防刷屏 (Flapping & Dedupe): 单个标的具备 20 分钟冷静窗口，防止盘中频繁震荡刷屏;
 * 3. 结构化微观卡片: 整合 GEX 墙、黄金战法实测胜率、真实交割单、盘口大单以及 2x 杠杆战车折算点位;
 * 4. 纯只读安全红线: 绝不包含下单买卖指令，100% 隔离实盘交易资金，严禁接入 L2a。
 */

import dotenv from 'dotenv';
import { formatBeijingTime } from '../../monitoring/alert-sink.js';
import { TAPE_DISCLAIMER } from './tape_confluence_detector.js';

dotenv.config();

// 冷却状态记录器 (标的 -> { lastAt, lastScore })
const alertCooldownMap = new Map();
const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000; // 20 分钟冷却
const DEFAULT_MIN_SCORE = 70; // 默认最小触发分值

/**
 * 格式化企微四维共振预警卡片 Markdown
 */
export function formatRadarAlertMarkdown(radarData, options = {}) {
  const t = radarData.ticker;
  const price = Number(radarData.current_price || 0).toFixed(2);
  const score = radarData.confluence_score || 0;
  const level = radarData.confluence_level || 'NORMAL';
  const nowTs = options.nowTs || Date.now();
  const timeStr = formatBeijingTime(nowTs);

  const isWangzha = score >= 75 || level === 'WANGZHA_CONFLUENCE';
  const titlePrefix = isWangzha ? '🔥【四维共振预警 · 王炸共振触发】' : '⚡【四维共振预警 · 高置信度共振】';

  // 1. 维度分解提取
  const d = radarData.dimensions || {};
  const d1 = d.d1_gex_structure || { score: 0 };
  const d2 = d.d2_zhao_outlook || { score: 0 };
  const d3 = d.d3_trade_signals_proof || { score: 0 };
  const d4 = d.d4_tape_block_flow || { score: 0 };

  // 黄金战法高胜率标签
  let goldenStr = '';
  if (d2.is_golden_playbook && d2.golden_stats) {
    const h3 = (d2.golden_stats.hit_rate_3d * 100).toFixed(0);
    const h5 = (d2.golden_stats.hit_rate_5d * 100).toFixed(0);
    goldenStr = `\n> 🌟 <font color="warning">**高胜率黄金战法认证**</font> (3D胜率 ${h3}% | 5D胜率 ${h5}%)`;
  }

  // 2. 战车杠杆 ETF 折算
  let etfBlock = '';
  const etf = radarData.leveraged_etf || radarData.leveraged_etf_projection;
  if (etf) {
    const sup = etf.projected_support?.length ? `$${etf.projected_support.join(', $')}` : '暂无';
    const res = etf.projected_resistance?.length ? `$${etf.projected_resistance.join(', $')}` : '暂无';
    etfBlock = `\n### 🚗 衍生战车动态折算
> **${etf.name} (${etf.etf}) · ${etf.leverage}x 做多** (现价 $${etf.etf_current_price})
> ↳ 折算做多支撑: <font color="info">${sup}</font>
> ↳ 折算做多阻力: <font color="warning">${res}</font>`;
  }

  // 3. 周哥外部量化印证
  let quantBlock = '';
  if (radarData.external_quant_reference) {
    const q = radarData.external_quant_reference;
    quantBlock = `\n### 🤖 外部客观量化参谋 (周哥美股工具箱)
> **信号**: \`${q.signal_combo || '监控中'}\` | **参考点**: $${q.reference_price || 'N/A'}`;
  }

  // 4. SPX / SPY 跨时段等效换算及 TradingView 外部参考
  let spxRefBlock = '';
  if (t === 'SPX' || radarData.is_derived_from_spy) {
    spxRefBlock = `\n### 🌐 跨时段指数换算与全天候实时图表
> ↳ **数据源说明**: 当前时段通过全天候活跃交易的 SPY 现价动态等效折算
> ↳ **TradingView 实时行情**: [CAPITALCOM:SPX500 全天候实时图表](https://www.tradingview.com/chart/?symbol=CAPITALCOM%3ASPX500)`;
  }

  // 组装最终 Markdown
  return `## ${titlePrefix}
> **标的**: <font color="info">**${t}**</font> | **现价**: **$${price}**
> **共振总分**: <font color="${isWangzha ? 'warning' : 'info'}">**${score}/100**</font> (${level})
> **时间**: ${timeStr}

### 📐 四维微观结构印证
> • **D1 GEX做市商**: ${d1.score}/25 | ${d1.details || '常规做市商分布'}
> • **D2 大V多模态**: ${d2.score}/25 | ${d2.details || '形态跟踪中'}${goldenStr}
> • **D3 真实交割单**: ${d3.score}/25 | ${d3.details || '历史单据比对'}
> • **D4 盘口大单流**: ${d4.score}/25 | ${d4.details || '逐笔活跃监控'}
${etfBlock}${quantBlock}${spxRefBlock}

─────────────────────
<font color="comment">🛡️ 纯客观微观结构参谋，100% 隔离实盘下单资金，绝非投资建议。</font>`;
}

/**
 * 核心推送函数
 */
export async function pushRadarAlert(radarData, options = {}) {
  const {
    minScore = DEFAULT_MIN_SCORE,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    force = false,
    dryRun = false,
    webhookUrl =
      process.env.WECHAT_QUANT_RADAR_WEBHOOK_URL ||
      process.env.WECHAT_ALERT_WEBHOOK_URL ||
      process.env.WECHAT_WORK_WEBHOOK_URL,
    fetchImpl = fetch,
    nowFn = () => Date.now(),
  } = options;

  if (!radarData || !radarData.ticker) {
    return { ok: false, error: 'MISSING_TICKER' };
  }

  const t = radarData.ticker.toUpperCase();
  const score = radarData.confluence_score || 0;
  const isGolden = Boolean(radarData.dimensions?.d2_zhao_outlook?.is_golden_playbook);
  const now = nowFn();

  // 1. 门禁检查：是否达到推送分值标准
  if (!force && score < minScore && !isGolden) {
    return { ok: false, skipped: true, reason: 'SCORE_BELOW_THRESHOLD', score, minScore };
  }

  // 2. 防抖防刷屏检查
  const lastRecord = alertCooldownMap.get(t);
  if (!force && lastRecord) {
    const elapsed = now - lastRecord.lastAt;
    const scoreDiff = score - lastRecord.lastScore;
    if (elapsed < cooldownMs && scoreDiff < 15) {
      return {
        ok: false,
        skipped: true,
        reason: 'COOLDOWN_ACTIVE',
        elapsedSec: Math.round(elapsed / 1000),
        remainingSec: Math.round((cooldownMs - elapsed) / 1000),
      };
    }
  }

  // 3. 生成内容
  const content = formatRadarAlertMarkdown(radarData, { nowTs: now });

  if (dryRun) {
    console.log(`[RadarAlert DryRun] 🚀 触发标的 ${t} 预警 (得分: ${score}):\n${content}\n`);
    alertCooldownMap.set(t, { lastAt: now, lastScore: score });
    return { ok: true, dryRun: true, ticker: t, score };
  }

  if (!webhookUrl) {
    console.warn(`[RadarAlert] ⚠️ 未配置 WECHAT_ALERT_WEBHOOK_URL 或 WECHAT_WORK_WEBHOOK_URL，跳过网络推送`);
    alertCooldownMap.set(t, { lastAt: now, lastScore: score });
    return { ok: false, skipped: true, reason: 'NO_WEBHOOK_CONFIGURED' };
  }

  // 4. 发送 Webhook 请求
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (data.errcode === 0 || res.ok) {
      alertCooldownMap.set(t, { lastAt: now, lastScore: score });
      return { ok: true, ticker: t, score, response: data };
    } else {
      return { ok: false, error: data.errmsg || `HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 重置防抖状态 (仅用于单测)
 */
export function _resetCooldownMapForTests() {
  alertCooldownMap.clear();
}
