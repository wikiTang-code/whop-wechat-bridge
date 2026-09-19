/**
 * tools/knowledge/resonance_radar_engine.js
 * REQ-038-T3: 三点共振只读雷达核心引擎 (Resonance Radar Engine)
 * 规范权威参考: docs/project/req038-t3-resonance-radar-spec.md
 * 
 * 核心安全红线:
 * 1. 纯只读数据对齐，绝不生成 BUY/SELL 信号，严禁接入 L2a 自动化策略机与自动下单;
 * 2. 严格强制卡片 ID 溯源 (card_id) 与法律合规免责声明 (disclaimer);
 * 3. 数据库查询全部走 getDbReadOnly() 句柄，杜绝写锁争用。
 */

import { getDb } from '../../database.js';

export const RADAR_DISCLAIMER =
  '【纯客观结构参考 · 绝非投资建议】本雷达仅提供大V历史技术分析与期权做市商GEX结构之数学空间对齐，不包含任何买卖方向推荐，严禁作为自动交易依据。入市有风险，投资需谨慎。';

const DEFAULT_HALF_LIFE_DAYS = 30; // 观点时效半衰期 (30天)
const DEFAULT_TOLERANCE_PCT = 0.012; // 默认空间对齐容差 ±1.2%

/**
 * 计算时间半衰衰减权重
 * W = 0.5 ^ (deltaDays / halfLifeDays)
 */
export function calculateDecayWeight(createdAtMs, nowMs = Date.now(), halfLifeDays = DEFAULT_HALF_LIFE_DAYS) {
  if (!createdAtMs || isNaN(createdAtMs)) return 0.5;
  const elapsedDays = Math.max(0, (nowMs - Number(createdAtMs)) / (86400 * 1000));
  return Math.pow(0.5, elapsedDays / halfLifeDays);
}

/**
 * 计算两个价位之间的空间对齐置信度 (0.0 ~ 1.0)
 */
export function calculateProximityScore(priceCard, priceGex, currentPrice, decayWeight = 1.0) {
  if (!priceCard || !priceGex || !currentPrice) return 0.0;
  const sigma = currentPrice * 0.01; // 1% 标尺
  const diff = Math.abs(priceCard - priceGex);
  const rawScore = Math.exp(-diff / sigma);
  return Math.min(1.0, Math.max(0.0, rawScore * decayWeight));
}

/**
 * 抽取卡片中的有效点位信息 (支持 JSON 解析与多源字段)
 */
export function extractCardLevels(card) {
  const levels = {
    support: [],
    resistance: [],
  };

  let srData = card.support_resistance_json;
  if (typeof srData === 'string') {
    try {
      srData = JSON.parse(srData);
    } catch {
      srData = null;
    }
  }

  if (srData && typeof srData === 'object') {
    if (Array.isArray(srData.support)) {
      levels.support.push(...srData.support.map(Number).filter((n) => Number.isFinite(n) && n > 0));
    }
    if (Array.isArray(srData.resistance)) {
      levels.resistance.push(...srData.resistance.map(Number).filter((n) => Number.isFinite(n) && n > 0));
    }
  }

  return {
    card_id: card.id || card.card_id || 'unknown_card',
    ticker: (card.ticker || '').toUpperCase(),
    created_at: card.created_at || Date.now(),
    source_excerpt: (card.trigger_text || card.title || card.theory_text || '').slice(0, 100),
    support: Array.from(new Set(levels.support)),
    resistance: Array.from(new Set(levels.resistance)),
  };
}

/**
 * 核心三点共振计算器
 * @param {Object} params
 * @param {string} params.ticker 标的代码
 * @param {number} params.currentPrice 当前盘口价
 * @param {Object} params.gexSummary GEX 结构摘要
 * @param {Array<Object>} params.cards 大V战法卡列表
 * @param {Object} [params.options] 计算微调选项
 */
export function computeResonanceRadar(params = {}) {
  const {
    ticker,
    currentPrice,
    gexSummary,
    cards = [],
    options = {},
  } = params;

  if (!ticker) {
    throw new Error('MISSING_TICKER: 标的代码不能为空');
  }

  const cleanTicker = String(ticker).trim().toUpperCase();
  const px = Number(currentPrice);
  const now = options.nowMs || Date.now();
  const tolerancePct = options.tolerancePct || DEFAULT_TOLERANCE_PCT;

  const result = {
    schema_version: '1.0.0',
    generated_at: new Date(now).toISOString(),
    disclaimer: RADAR_DISCLAIMER,
    ticker: cleanTicker,
    current_price: Number.isFinite(px) && px > 0 ? px : null,
    gex_available: false,
    cards_available: false,
    gex_summary: null,
    resonance_zones: [],
    safety_audit: {
      has_buy_sell_signals: false,
      is_l2a_eligible: false,
      cards_referenced_count: 0,
      inspection_passed: true,
    },
  };

  // 1. 装载 GEX 结构
  if (gexSummary && typeof gexSummary === 'object') {
    result.gex_available = true;
    result.gex_summary = {
      regime: gexSummary.regime || gexSummary.gex_regime || 'neutral',
      call_wall: Number(gexSummary.call_wall) || null,
      put_wall: Number(gexSummary.put_wall) || null,
      zero_gamma: Number(gexSummary.zero_gamma) || null,
      absolute_gamma: Number(gexSummary.absolute_gamma) || null,
    };
  }

  // 2. 筛选并规范化大V卡片
  const validCards = cards
    .filter((c) => {
      const cardTickers = String(c.tickers_json || c.ticker || '').toUpperCase();
      return cardTickers.includes(cleanTicker);
    })
    .map(extractCardLevels)
    .filter((c) => c.support.length > 0 || c.resistance.length > 0);

  if (validCards.length > 0) {
    result.cards_available = true;
  }

  if (!result.current_price || !result.gex_available) {
    // 降级：缺乏有效盘口或 GEX 数据时，不捏造共振区
    return result;
  }

  const referencedCardIds = new Set();
  const zones = [];

  const callWall = result.gex_summary.call_wall;
  const putWall = result.gex_summary.put_wall;
  const zeroGamma = result.gex_summary.zero_gamma;

  // 3. 对齐阻力位共振 (Call Wall vs 卡片阻力位)
  if (callWall && Number.isFinite(callWall)) {
    for (const card of validCards) {
      for (const resPx of card.resistance) {
        const diffRatio = Math.abs(resPx - callWall) / callWall;
        if (diffRatio <= tolerancePct) {
          const decay = calculateDecayWeight(card.created_at, now);
          const score = calculateProximityScore(resPx, callWall, px, decay);
          if (score >= 0.5) {
            referencedCardIds.add(card.card_id);
            zones.push({
              zone_type: 'resistance_confluence',
              price_center: callWall,
              price_span: [
                Math.min(resPx, callWall),
                Math.max(resPx, callWall),
              ],
              resonance_score: Number(score.toFixed(2)),
              sources: {
                gex: { feature: 'call_wall', level: callWall },
                ontology_cards: [
                  {
                    card_id: card.card_id,
                    level: resPx,
                    role: 'resistance',
                    card_created_at: new Date(Number(card.created_at)).toISOString(),
                    source_excerpt: card.source_excerpt,
                  },
                ],
              },
              structural_observation: `大V阻力位 ${resPx} 与期权 Call Wall (${callWall}) 在 ±${(diffRatio * 100).toFixed(1)}% 容差内高度共振，形成强结构性上方压力带。`,
            });
          }
        }
      }
    }
  }

  // 4. 对齐支撑位共振 (Put Wall vs 卡片支撑位)
  if (putWall && Number.isFinite(putWall)) {
    for (const card of validCards) {
      for (const supPx of card.support) {
        const diffRatio = Math.abs(supPx - putWall) / putWall;
        if (diffRatio <= tolerancePct) {
          const decay = calculateDecayWeight(card.created_at, now);
          const score = calculateProximityScore(supPx, putWall, px, decay);
          if (score >= 0.5) {
            referencedCardIds.add(card.card_id);
            zones.push({
              zone_type: 'support_confluence',
              price_center: putWall,
              price_span: [
                Math.min(supPx, putWall),
                Math.max(supPx, putWall),
              ],
              resonance_score: Number(score.toFixed(2)),
              sources: {
                gex: { feature: 'put_wall', level: putWall },
                ontology_cards: [
                  {
                    card_id: card.card_id,
                    level: supPx,
                    role: 'support',
                    card_created_at: new Date(Number(card.created_at)).toISOString(),
                    source_excerpt: card.source_excerpt,
                  },
                ],
              },
              structural_observation: `大V支撑位 ${supPx} 与期权 Put Wall (${putWall}) 在 ±${(diffRatio * 100).toFixed(1)}% 容差内高度共振，形成强结构性下方支撑带。`,
            });
          }
        }
      }
    }
  }

  // 5. 对齐伽马翻转点共振 (Zero Gamma vs 卡片关键位)
  if (zeroGamma && Number.isFinite(zeroGamma)) {
    for (const card of validCards) {
      const allLevels = [...card.support, ...card.resistance];
      for (const lvl of allLevels) {
        const diffRatio = Math.abs(lvl - zeroGamma) / zeroGamma;
        if (diffRatio <= tolerancePct) {
          const decay = calculateDecayWeight(card.created_at, now);
          const score = calculateProximityScore(lvl, zeroGamma, px, decay);
          if (score >= 0.5) {
            referencedCardIds.add(card.card_id);
            zones.push({
              zone_type: 'regime_flip_alignment',
              price_center: zeroGamma,
              price_span: [
                Math.min(lvl, zeroGamma),
                Math.max(lvl, zeroGamma),
              ],
              resonance_score: Number(score.toFixed(2)),
              sources: {
                gex: { feature: 'zero_gamma', level: zeroGamma },
                ontology_cards: [
                  {
                    card_id: card.card_id,
                    level: lvl,
                    role: 'critical_boundary',
                    card_created_at: new Date(Number(card.created_at)).toISOString(),
                    source_excerpt: card.source_excerpt,
                  },
                ],
              },
              structural_observation: `大V关键分水岭 ${lvl} 与期权 Zero Gamma 翻转线 (${zeroGamma}) 发生重合，越过该带可能引发做市商对冲性质剧变。`,
            });
          }
        }
      }
    }
  }

  // 按置信度降序排列
  zones.sort((a, b) => b.resonance_score - a.resonance_score);
  result.resonance_zones = zones;

  // 6. 门禁审计与物理防护
  result.safety_audit.cards_referenced_count = referencedCardIds.size;
  // 严查输出中是否存在任何 BUY/SELL 字段
  const serialized = JSON.stringify(result);
  if (/\b(BUY|STRONG_BUY|SELL|STRONG_SELL)\b/i.test(serialized)) {
    // 触发不可逾越的安全红线
    throw new Error('SAFETY_VIOLATION: 雷达产物中检测到非法交易买卖指令，已被底层物理拦截！');
  }

  return result;
}
