/**
 * tools/knowledge/tape_confluence_detector.js
 * REQ-041 — 盘口微观大单与四维共振检测引擎 (Quad-Confluence Tape Detector)
 *
 * 核心架构:
 * 1. 维度 1: 大盘 GEX 期权做市商引力场 (Put Wall / Call Wall / 60点动态箱体);
 * 2. 维度 2: 赵哥大盘与标的多模态走势预判 (ontology_card / message_vision_meta);
 * 3. 维度 3: 赵哥 457 笔历史第一人称真实成交单价格佐证 (trade_signals / zhao_positions);
 * 4. 维度 4: 盘口微观超级大单通吃检测 (Block Trade Sweep / 云光存板块异动 / 尾盘V点窗口).
 *
 * 安全红线:
 * - 纯只读数据对齐与参谋，绝不生成实盘 BUY/SELL 下单，严禁接入 L2a;
 * - 强制免责声明与数据溯源。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getDb } from '../../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const GEX_PATH = path.join(ROOT_DIR, 'data/gex/latest.json');
export const GOLDEN_PLAYBOOK_PATH = path.join(ROOT_DIR, 'data/runtime/golden_playbook.json');

export const TAPE_DISCLAIMER =
  '【纯客观盘口微观结构参谋 · 绝非投资建议】本引擎整合做市商GEX伽马分布、大V历史预判图表、真实交割单点位与盘口大单特征，仅用于市场微观机制学术与复盘印证，严禁作为自动交易依据。';

/** 大V赵哥本人唯一真相源身份 (全频道发言采集，但严格物理硬锁用户本人) */
export const ZHAO_PRIMARY_SENDER_ID = 'user_4yeplXgbguTu4';
export const ZHAO_PRIMARY_SENDER_NAME = 'xiaozhaolucky';

/** 交易单 (trade_signals) 严格物理准入的两大专属频道 */
export const TRADE_SIGNAL_CHANNELS = [
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN', // 历史股票期权记录区
  'chat_feed_1CTrCEx44dP13jW3RVkYiS',  // 不用翻墙期权
];

/** 周哥自研美股工具箱量化参考身份与信号频道 (外部客观量化参谋) */
export const ZHOU_QUANT_SENDER_ID = 'user_HnSG7BJWMTfDz';
export const ZHOU_QUANT_CHANNEL_ID = 'chat_feed_1CaEnj8BrNBr95YSbgabYZ'; // 日内波段信号检测

/** 云·光·存 核心主线标的池 (赵哥量化核心仓) */
export const SECTOR_MAP = {
  CLOUD: ['CRWV', 'IREN', 'NBIS', 'CIFR', 'DELL'],
  OPTICS: ['LITE', 'COHR'],
  MEMORY: ['DRAM', 'MU', 'WDC', 'SNDK', 'SNXX'],
  FLAGSHIP: ['TSLA', 'TSLL', 'NVDA', 'INTC', 'QQQ', 'SPY', 'SPX'],
};

/** 正股 ↔ 杠杆做多 ETF 常用战法军火库映射 */
export const LEVERAGED_ETF_MAP = {
  TSLA: { etf: 'TSLL', leverage: 2, name: '2倍做多特斯拉', defaultPrice: 10.35 },
  NBIS: { etf: 'NEBX', leverage: 2, name: '2倍做多Nebius', defaultPrice: 28.5 },
  LITE: { etf: 'LITX', leverage: 2, name: '2倍做多Lumentum', defaultPrice: 846.0 },
  COHR: { etf: 'COHX', leverage: 2, name: '2倍做多Coherent', defaultPrice: 42.0 },
  COIN: { etf: 'CONL', leverage: 2, name: '2倍做多Coinbase', defaultPrice: 3.99 },
  QQQ: { etf: 'TQQQ', leverage: 3, name: '3倍做多纳指', defaultPrice: 78.5 },
  SPY: { etf: 'SPYU', leverage: 4, name: '4倍做多标普', defaultPrice: 33.26 },
  SPX: { etf: 'UPRO', leverage: 3, name: '3倍做多标普500', defaultPrice: 75.20 },
  WDC: { etf: 'SNXX', leverage: 2, name: '2倍做多闪存存储', defaultPrice: 18.2 },
  SNDK: { etf: 'SNXX', leverage: 2, name: '2倍做多闪存存储', defaultPrice: 18.2 },
  MU: { etf: 'MUU', leverage: 2, name: '2倍做多美光', defaultPrice: 35.7 },
};

/**
 * 将正股关键点位（支撑/阻力/做市商墙）动态折算为杠杆做多 ETF 对应点位
 * 公式: L_etf = P_etf * (1 + leverage * ((L_underlying - P_underlying) / P_underlying))
 */
export function projectLeveragedEtfLevels(underlyingTicker, levels = {}, underlyingPrice, customEtfPrice = null) {
  const t = (underlyingTicker || '').toUpperCase();
  const meta = LEVERAGED_ETF_MAP[t];
  if (!meta || !underlyingPrice || underlyingPrice <= 0) return null;

  const etfPrice = customEtfPrice || meta.defaultPrice;
  const { leverage, etf, name } = meta;

  const project = (lvl) => {
    if (typeof lvl !== 'number' || lvl <= 0) return null;
    const deltaPct = (lvl - underlyingPrice) / underlyingPrice;
    const etfLvl = etfPrice * (1 + leverage * deltaPct);
    return Number(Math.max(0.01, etfLvl).toFixed(2));
  };

  return {
    etf,
    name,
    leverage,
    etf_current_price: etfPrice,
    underlying_ticker: t,
    underlying_price: underlyingPrice,
    projected_support: (levels.support || []).map(project).filter(Boolean),
    projected_resistance: (levels.resistance || []).map(project).filter(Boolean),
  };
}

/**
 * 获取标的所属板块
 */
export function getSector(ticker) {
  const t = (ticker || '').toUpperCase();
  for (const [sec, list] of Object.entries(SECTOR_MAP)) {
    if (list.includes(t)) return sec;
  }
  return 'OTHER';
}

/**
 * 期权大单 Block Trade / 扫盘特征库 (Dimension 4 Pattern Registry)
 */
export const TAPE_BLOCK_PATTERNS = {
  INSTITUTIONAL_SWEEP: {
    id: 'INSTITUTIONAL_SWEEP',
    name: '机构激进跨所扫盘 (Aggressive Sweep)',
    min_amount_usd: 500000,
    weight: 12,
    description: '跨交易所多路吃尽盘口，不计滑点快速建仓'
  },
  JUMBO_BLOCK_TRADE: {
    id: 'JUMBO_BLOCK_TRADE',
    name: '巨额大宗交易 (Jumbo Block Trade)',
    min_amount_usd: 1000000,
    weight: 10,
    description: '单笔百万美金以上主力资金建仓或大宗暗池对倒吸筹'
  },
  POWER_HOUR_SQUEEZE: {
    id: 'POWER_HOUR_SQUEEZE',
    name: '尾盘强平V反窗口 (Power Hour Squeeze)',
    weight: 8,
    description: '美东 15:00~16:00 尾盘强平扫单窗口，0DTE 期权强平回补与做市商 Gamma 逼空'
  },
  OPENING_PULLBACK_DIP: {
    id: 'OPENING_PULLBACK_DIP',
    name: '早盘回踩捡漏吸筹 (Opening Pullback Dip)',
    weight: 8,
    description: '美东 09:30~10:30 开盘剧烈博弈时区，大跌探底、支撑回踩确认或主力急跌诱空洗盘吸筹'
  },
  RETAIL_PANIC_ABSORPTION: {
    id: 'RETAIL_PANIC_ABSORPTION',
    name: '恐慌盘通吃吸纳 (Retail Panic Absorption)',
    weight: 6,
    description: '散户止损盘被单笔大单瞬间吸纳，盘口呈现 V 型企稳'
  },
  DEPTH_LIQUIDITY_IMBALANCE: {
    id: 'DEPTH_LIQUIDITY_IMBALANCE',
    name: '买盘深度压倒性倾斜 (Order Book Imbalance)',
    weight: 6,
    description: '买单深度挂单量与比率显著占优，主力真金白银托盘'
  },
  OTM_GAMMA_BURST: {
    id: 'OTM_GAMMA_BURST',
    name: '价外期权暴量异动 (OTM Gamma Burst)',
    weight: 7,
    description: '价外期权瞬间成交量远超持仓量，做市商短线对冲需求激增'
  },
  UNUSUAL_OPTION_FLOW: {
    id: 'UNUSUAL_OPTION_FLOW',
    name: '期权异动资金定向流入 (Unusual Option Flow)',
    weight: 7,
    description: '大额异动资金集中买入单一方向期权合约'
  }
};

/**
 * 评估微观盘口超级大单与期权扫盘特征
 */
export function evaluateTapeBlockFlow(tapeEvent) {
  let score = 0;
  const observations = [];
  const matchedPatterns = [];
  let flowSentiment = 'NEUTRAL';
  let totalFlowUsd = 0;

  if (!tapeEvent) {
    return {
      score: 10,
      matched_patterns: [],
      flow_sentiment: 'NEUTRAL',
      total_flow_usd: 0,
      details: '常规微观盘口活跃度监控中',
      observations: ['常规微观盘口活跃度监控中']
    };
  }

  // 提取资金量
  const amountUsd =
    Number(tapeEvent.block_buy_usd || tapeEvent.block_amount_usd || tapeEvent.premium_usd || tapeEvent.notional_usd) || 0;
  totalFlowUsd = amountUsd;

  // 1. 机构激进跨所扫盘 (Sweep)
  const isSweep = Boolean(tapeEvent.is_sweep || tapeEvent.sweep_trade || tapeEvent.order_type === 'SWEEP');
  if (isSweep) {
    const pat = TAPE_BLOCK_PATTERNS.INSTITUTIONAL_SWEEP;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`⚡【机构扫盘】检测到激进跨所连环吃单 (${pat.description})`);
    flowSentiment = tapeEvent.aggressor === 'SELL' ? 'BEARISH' : 'BULLISH';
  }

  // 2. 超级巨额大宗 (Jumbo Block Trade >= $1M)
  if (amountUsd >= 1000000) {
    const pat = TAPE_BLOCK_PATTERNS.JUMBO_BLOCK_TRADE;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`💰【巨额大宗】单笔大资金注入 ($${(amountUsd / 1e6).toFixed(2)}M)`);
    if (flowSentiment === 'NEUTRAL') flowSentiment = 'BULLISH';
  } else if (amountUsd >= 500000 && !isSweep) {
    score += 6;
    observations.push(`检测到单笔大资金建仓 ($${(amountUsd / 1e3).toFixed(0)}K)`);
  }

  // 3. 恐慌盘通吃吸纳
  if (tapeEvent.retail_panic) {
    const pat = TAPE_BLOCK_PATTERNS.RETAIL_PANIC_ABSORPTION;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`🧲【恐慌吸收】微观特征符合: 散户恐慌止损盘被单笔主力资金一把通吃扫入`);
    flowSentiment = 'BULLISH';
  }

  // 4. 尾盘强平 V 反窗口 (美东 15:00 ~ 16:00 三点到四点)
  if (tapeEvent.time_et) {
    const [hh, mm] = String(tapeEvent.time_et).split(':').map(Number);
    if (hh === 15) {
      const pat = TAPE_BLOCK_PATTERNS.POWER_HOUR_SQUEEZE;
      score += pat.weight;
      matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
      observations.push(`⏱️【尾盘强平时区】命中机构强平与尾盘扫单窗口 [${tapeEvent.time_et} ET]: 0DTE 期权强平 Delta 回补拉升区`);
    }

    // 4b. 早盘回踩捡漏吸筹窗口 (美东 09:30 ~ 10:30)
    const timeNum = hh * 100 + mm;
    if (timeNum >= 930 && timeNum <= 1030) {
      const pat = TAPE_BLOCK_PATTERNS.OPENING_PULLBACK_DIP;
      score += pat.weight;
      matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
      observations.push(`🌅【早盘回踩】命中开盘捡漏吸筹黄金时区 [${tapeEvent.time_et} ET]: 波动加剧回踩支撑确认`);
    }
  }

  // 5. 盘口深度买卖倾斜 (Depth Imbalance)
  const ratio = Number(tapeEvent.imbalance_ratio) || 0;
  if (ratio >= 1.8) {
    const pat = TAPE_BLOCK_PATTERNS.DEPTH_LIQUIDITY_IMBALANCE;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`📊【盘口倾斜】买卖五档挂单比达 ${ratio.toFixed(1)}x，买方厚度压倒性占优`);
  }

  // 6. 价外期权暴量异动 (OTM Gamma)
  if (tapeEvent.is_otm || tapeEvent.otm_gamma_burst) {
    const pat = TAPE_BLOCK_PATTERNS.OTM_GAMMA_BURST;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`🎯【期权Gamma异动】价外期权异动换手，做市商短线逼空对冲风险高`);
  }

  // 7. 期权异动大单流入
  if (tapeEvent.unusual_option_flow || tapeEvent.unusual_option) {
    const pat = TAPE_BLOCK_PATTERNS.UNUSUAL_OPTION_FLOW;
    score += pat.weight;
    matchedPatterns.push({ id: pat.id, name: pat.name, weight: pat.weight });
    observations.push(`🌊【期权异动流入】大量期权 Smart Money 集中入场`);
  }

  // 兜底基础分保证
  const finalScore = Math.min(25, Math.max(tapeEvent ? 8 : 10, score));

  return {
    score: finalScore,
    matched_patterns: matchedPatterns,
    flow_sentiment: flowSentiment,
    total_flow_usd: totalFlowUsd,
    details: observations.join('; '),
    observations
  };
}

/**
 * 盘口大单微观检测器核心实现
 */
export function detectTapeConfluence(params = {}) {
  const {
    ticker,
    currentPrice,
    timestamp = Date.now(),
    tapeEvent = null, // 盘口逐笔事件 { block_buy_usd: 2500000, is_sweep: true, retail_panic: true, time_et: '15:35' }
    gexSnapshot = null,
    dbInstance = getDb(),
  } = params;

  if (!ticker || !currentPrice) {
    throw new Error('MISSING_REQUIRED_PARAMS: ticker and currentPrice are required');
  }

  const t = ticker.toUpperCase();
  const sector = getSector(t);

  const report = {
    schema_version: '1.0.0',
    detected_at: new Date(timestamp).toISOString(),
    ticker: t,
    sector,
    current_price: currentPrice,
    disclaimer: TAPE_DISCLAIMER,
    dimensions: {
      d1_gex_structure: { score: 0, max: 25, details: null },
      d2_zhao_outlook: { score: 0, max: 25, details: null },
      d3_trade_signals_proof: { score: 0, max: 25, details: null },
      d4_tape_block_flow: { score: 0, max: 25, details: null },
    },
    total_confluence_score: 0,
    confluence_level: 'NORMAL', // NORMAL | HIGH | WANGZHA_CONFLUENCE
    observations: [],
    safety_audit: {
      has_buy_sell_orders: false,
      is_l2a_eligible: false,
      source_db: 'whop_archive.db',
    },
  };

  if (params.isDerivedFromSpy || tapeEvent?.is_derived_from_spy) {
    report.observations.push('🔄【跨时段指数换算】当前时段 SPX 现价由全天候交易的 SPY 动态等效换算');
  }

  const m7Breadth = params.m7Breadth || null;
  if (m7Breadth) {
    report.m7_breadth = m7Breadth;
    if (m7Breadth.is_unilateral_downtrend) {
      report.observations.push(m7Breadth.playbook_advice || `🚨【赵哥战法 · 七姐妹单边下跌】开盘首小时 M7 普跌 (${m7Breadth.down_count}/7)，当天易走单边下跌模式！早盘严禁接飞刀，策略推迟至尾盘三点强平再买/捡漏！`);
    }
  }

  // --- 维度 1: 大盘 GEX 结构比对 (0 ~ 25分) ---
  let gex = gexSnapshot;
  if (!gex && fs.existsSync(GEX_PATH)) {
    try {
      gex = JSON.parse(fs.readFileSync(GEX_PATH, 'utf8'));
    } catch (_) {}
  }

  if (gex) {
    // 检查标的本身或联动大盘 (SPY/QQQ) 的 GEX
    let targetGex = gex.zero_dte?.[t] || gex.matrix?.[t];
    let macroGex = gex.zero_dte?.['SPY'] || gex.zero_dte?.['QQQ'];

    let gexScore = 0;
    const gexObs = [];

    if (targetGex) {
      const putWall = targetGex.king?.strike;
      const callWall = targetGex.floor?.strike;
      if (putWall && Math.abs(currentPrice - putWall) / putWall <= 0.015) {
        gexScore += 15;
        gexObs.push(`标的现价 ${currentPrice} 紧贴自身 GEX Put Wall (${putWall}) 强支撑带`);
      }
      if (callWall && Math.abs(currentPrice - callWall) / callWall <= 0.015) {
        gexScore += 10;
        gexObs.push(`标的现价 ${currentPrice} 紧贴自身 GEX Call Wall (${callWall}) 阻力带`);
      }
    }

    if (macroGex && macroGex.king?.strike) {
      gexScore = Math.min(25, gexScore + 10);
      gexObs.push(`大盘 GEX 处于基准对冲区 (SPY Put Wall: ${macroGex.king.strike})`);
    }

    report.dimensions.d1_gex_structure.score = Math.min(25, gexScore || 10);
    report.dimensions.d1_gex_structure.details = gexObs.join('; ');
  }

  // --- 维度 2: 赵哥大盘与标的多模态走势预判 (0 ~ 25分) ---
  let bestLevel = null;
  let isGoldenPlaybook = false;
  let goldenMeta = null;

  try {
    // 2.1 优先检索黄金战法提纯库 (Golden Playbook，经过历史胜率实测筛选)
    if (fs.existsSync(GOLDEN_PLAYBOOK_PATH)) {
      try {
        const goldenCards = JSON.parse(fs.readFileSync(GOLDEN_PLAYBOOK_PATH, 'utf8'));
        // 匹配当前标的或者关联标的 (例如 TSLA ↔ TSLL)
        const relevantGolden = goldenCards.filter((c) => {
          const cTicker = (c.ticker || '').toUpperCase();
          if (cTicker === t) return true;
          if (t === 'TSLA' && cTicker === 'TSLL') return true;
          if (t === 'TSLL' && cTicker === 'TSLA') return true;
          return false;
        });

        let minGoldenDist = Infinity;
        let bestGoldenCard = null;
        let bestGoldenLvl = null;

        for (const gc of relevantGolden) {
          const lvls = [
            ...(gc.trigger_levels?.support || []),
            ...(gc.trigger_levels?.resistance || []),
          ];
          for (const lvl of lvls) {
            if (typeof lvl === 'number' && lvl > 0) {
              const dist = Math.abs(currentPrice - lvl) / lvl;
              if (dist < minGoldenDist) {
                minGoldenDist = dist;
                bestGoldenLvl = lvl;
                bestGoldenCard = gc;
              }
            }
          }
        }

        /**
         * 空间偏差计算规范（Spatial Tolerance Specification - CHG-046 / Grok 审阅对齐）：
         * 1. 基准现价（currentPrice）：标的当前最新市场成交价或买卖中间价（Mid-price = (Bid + Ask) / 2）；
         * 2. 战法点位（level）：卡片中声明的显式支撑位（support）或阻力位（resistance）；
         * 3. 偏差比率公式：dist = Math.abs(currentPrice - level) / level；
         * 4. 门禁阈值：dist <= 0.03（即相对偏差绝对值在 ±3.00% 空间窗口内）；
         * 5. 杠杆 ETF（如 TSLA -> TSLL）空间对齐：
         *    若直接评测 TSLL，则 currentPrice 与 level 均为 TSLL 自身价格；
         *    若从正股 TSLA 投影，必须先经 projectLeveragedEtfLevels() 动态 Beta 折算到杠杆 ETF 价格空间后再计算偏差。
         */
        if (bestGoldenLvl && minGoldenDist <= 0.03) {
          const isStrictLevel = !bestGoldenCard.tier || bestGoldenCard.tier === 'golden_level';

          if (isStrictLevel) {
            // 纯血高精点位黄金战法：顶格加权 25 分
            isGoldenPlaybook = true;
            bestLevel = bestGoldenLvl;
            goldenMeta = bestGoldenCard;
            report.dimensions.d2_zhao_outlook.score = 25;
            report.dimensions.d2_zhao_outlook.is_golden_playbook = true;
            report.dimensions.d2_zhao_outlook.tier = 'golden_level';
            report.dimensions.d2_zhao_outlook.golden_stats = {
              card_id: bestGoldenCard.card_id,
              tier: 'golden_level',
              hit_rate_3d: bestGoldenCard.hit_rate_3d,
              hit_rate_5d: bestGoldenCard.hit_rate_5d,
              confidence: bestGoldenCard.confidence,
            };
            const hit3dStr = (bestGoldenCard.hit_rate_3d * 100).toFixed(0);
            const hit5dStr = (bestGoldenCard.hit_rate_5d * 100).toFixed(0);
            const confStr = ((bestGoldenCard.confidence || 0) * 100).toFixed(1);
            report.dimensions.d2_zhao_outlook.details = `🌟【高胜率黄金战法认证 · golden_level】[${bestGoldenCard.card_id}] 点位 $${bestGoldenLvl} (空间偏差 ${(minGoldenDist * 100).toFixed(2)}% | 3D胜率 ${hit3dStr}% | 5D胜率 ${hit5dStr}% | 置信度 ${confStr}%)`;
            report.observations.push(report.dimensions.d2_zhao_outlook.details);
          } else {
            // 方向观点战法 (golden_direction)：仅做观点印证参考，维度严格封顶 15 分，禁给 25 分顶格加权，禁多条叠加
            report.dimensions.d2_zhao_outlook.score = 15;
            report.dimensions.d2_zhao_outlook.tier = 'golden_direction';
            report.dimensions.d2_zhao_outlook.details = `💡【大V宏观方向参考 · golden_direction】[${bestGoldenCard.card_id}] 参考入场 $${bestGoldenLvl} (多空方向印证，非显式点位，D2封顶15分)`;
            report.observations.push(report.dimensions.d2_zhao_outlook.details);
            isGoldenPlaybook = true; // 锁定已命中战法，防止后续普通卡片覆盖或叠加
          }
        }
      } catch (_) {}
    }

    // 2.2 若未命中黄金战法（既无 level 也无 direction），平滑降级至全库 4,218 张卡片检索
    if (!isGoldenPlaybook) {
      const cards = dbInstance.prepare(`
        SELECT id, title, trigger_text, action_text, schema_json, created_at 
        FROM ontology_card 
        WHERE tickers_json LIKE ? OR title LIKE ?
        ORDER BY created_at DESC 
        LIMIT 15
      `).all(`%"${t}"%`, `%${t}%`);

      let bestDist = Infinity;
      let matchedCard = null;

      for (const card of cards) {
        let sr = null;
        try {
          if (card.schema_json) {
            const parsed = JSON.parse(card.schema_json);
            sr = parsed.support_resistance;
            if (!sr && parsed.support_resistance_json) {
              sr = typeof parsed.support_resistance_json === 'string'
                ? JSON.parse(parsed.support_resistance_json)
                : parsed.support_resistance_json;
            }
          }
        } catch (_) {}

        const levels = [...(sr?.support || []), ...(sr?.resistance || [])];
        for (const lvl of levels) {
          if (typeof lvl === 'number' && lvl > 0) {
            const dist = Math.abs(currentPrice - lvl) / lvl;
            if (dist < bestDist) {
              bestDist = dist;
              bestLevel = lvl;
              matchedCard = card;
            }
          }
        }
      }

      if (bestLevel && bestDist <= 0.03) {
        const outlookScore = bestDist <= 0.01 ? 25 : (bestDist <= 0.02 ? 20 : 15);
        report.dimensions.d2_zhao_outlook.score = outlookScore;
        report.dimensions.d2_zhao_outlook.details = `命中大V多模态战法卡 [${matchedCard.id}] 预测点位 ${bestLevel} (空间偏差 ${(bestDist * 100).toFixed(2)}%)`;
        report.observations.push(report.dimensions.d2_zhao_outlook.details);
      } else if (cards.length > 0) {
        report.dimensions.d2_zhao_outlook.score = 12;
        report.dimensions.d2_zhao_outlook.details = `命中大V该标的相关卡片 ${cards.length} 张 (形态跟踪中)`;
      }
    }
  } catch (_) {}

  // --- 维度 3: 赵哥 457 笔真实成交单历史点位佐证 (0 ~ 25分) ---
  try {
    const signals = dbInstance.prepare(`
      SELECT signal_id, action, price, quantity, created_at, channel_id 
      FROM trade_signals 
      WHERE ticker = ? AND (channel_id IS NULL OR channel_id IN ('forum_feed_1CTr7SqVMzFfuFiiRJLEHN', 'chat_feed_1CTrCEx44dP13jW3RVkYiS'))
      ORDER BY created_at DESC 
      LIMIT 20
    `).all(t);

    if (signals.length > 0) {
      // 计算历史买入均价或最近成交价
      const buySignals = signals.filter((s) => s.action === 'BUY' && s.price > 0);
      let closestSignal = null;
      let minSigDist = Infinity;

      for (const s of buySignals) {
        const dist = Math.abs(currentPrice - s.price) / s.price;
        if (dist < minSigDist) {
          minSigDist = dist;
          closestSignal = s;
        }
      }

      if (closestSignal && minSigDist <= 0.05) {
        const sigScore = minSigDist <= 0.02 ? 25 : (minSigDist <= 0.035 ? 20 : 15);
        report.dimensions.d3_trade_signals_proof.score = sigScore;
        report.dimensions.d3_trade_signals_proof.details = `与赵哥历史真实 BUY 成交单 [${closestSignal.signal_id}] 点位 $${closestSignal.price} 偏差仅 ${(minSigDist * 100).toFixed(2)}% (真实资金佐证)`;
        report.observations.push(report.dimensions.d3_trade_signals_proof.details);
      } else {
        report.dimensions.d3_trade_signals_proof.score = 12;
        report.dimensions.d3_trade_signals_proof.details = `历史存在赵哥 ${signals.length} 笔真金白银交易记录 (最高频活跃标的)`;
      }
    }
  } catch (_) {}

  // --- 维度 4: 盘口微观超级大单与期权扫盘检测 (0 ~ 25分) ---
  const d4Result = evaluateTapeBlockFlow(tapeEvent);
  report.dimensions.d4_tape_block_flow = {
    score: d4Result.score,
    max: 25,
    matched_patterns: d4Result.matched_patterns,
    flow_sentiment: d4Result.flow_sentiment,
    total_flow_usd: d4Result.total_flow_usd,
    details: d4Result.details
  };

  if (d4Result.observations && d4Result.observations.length && d4Result.score > 10) {
    report.observations.push(...d4Result.observations);
  }

  // 计算总置信度 (0 ~ 100)
  const total =
    report.dimensions.d1_gex_structure.score +
    report.dimensions.d2_zhao_outlook.score +
    report.dimensions.d3_trade_signals_proof.score +
    report.dimensions.d4_tape_block_flow.score;

  report.total_confluence_score = total;

  if (total >= 75) {
    report.confluence_level = 'WANGZHA_CONFLUENCE'; // 王炸共振
    report.observations.unshift('🔥【同花顺与王炸共振触发】大盘GEX支撑 + 大V多模态预判 + 真实交割单锚定 + 盘口超级大单通吃！');
  } else if (total >= 50) {
    report.confluence_level = 'HIGH';
    report.observations.unshift('⚡【高置信度多维共振】多维度结构高度重合');
  }

  // --- 折算 2倍/多倍 做多杠杆 ETF 点位 ---
  const collectedLevels = {
    support: [],
    resistance: [],
  };
  // 注入 GEX 墙点位
  if (gex) {
    const targetGex = gex.zero_dte?.[t] || gex.matrix?.[t];
    if (targetGex?.king?.strike) collectedLevels.support.push(targetGex.king.strike);
    if (targetGex?.floor?.strike) collectedLevels.resistance.push(targetGex.floor.strike);
  }
  // 注入已提取的预判点位
  if (bestLevel) {
    if (bestLevel < currentPrice) collectedLevels.support.push(bestLevel);
    else collectedLevels.resistance.push(bestLevel);
  }

  const etfProjection = projectLeveragedEtfLevels(t, collectedLevels, currentPrice);
  if (etfProjection) {
    report.leveraged_etf_projection = etfProjection;
    let projMsg = `💡 [${etfProjection.name} ${etfProjection.etf} (${etfProjection.leverage}x)] 正股锚点 $${currentPrice}`;
    if (etfProjection.projected_support.length) {
      projMsg += ` | 折算做多支撑: $${etfProjection.projected_support.join(', $')}`;
    }
    if (etfProjection.projected_resistance.length) {
      projMsg += ` | 折算做多阻力: $${etfProjection.projected_resistance.join(', $')}`;
    }
    report.observations.push(projMsg);
  }

  // --- 挂载周哥自研美股工具箱量化参考信号 (日内波段信号检测) ---
  try {
    const zhouSig = dbInstance
      .prepare(`
        SELECT content, created_at 
        FROM messages 
        WHERE sender_id = ? AND channel_id = ? AND content LIKE ?
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(ZHOU_QUANT_SENDER_ID, ZHOU_QUANT_CHANNEL_ID, `%标的: ${t}%`);

    if (zhouSig) {
      const comboMatch = zhouSig.content.match(/命中信号组合:\s*([^\n\r]+)/);
      const priceMatch = zhouSig.content.match(/(?:卖出价\*|买入价\*|价格):\s*([0-9.]+)/);
      report.external_quant_reference = {
        author: 'Mrzhoulucky (周哥美股工具箱)',
        channel: '日内波段信号检测',
        signal_combo: comboMatch ? comboMatch[1].trim() : '量化监控中',
        reference_price: priceMatch ? Number(priceMatch[1]) : null,
        created_at: new Date(zhouSig.created_at).toISOString(),
      };
      report.observations.push(
        `🤖 [周哥量化工具箱印证] 最新信号: [${report.external_quant_reference.signal_combo}] | 量化参考点位: $${report.external_quant_reference.reference_price || 'N/A'}`
      );
    }
  } catch (_) {}

  return report;
}

/**
 * 批量扫描云光存核心标的四维共振
 */
export function scanSectorsConfluence(options = {}) {
  const {
    dbInstance = getDb(),
    watchlist = ['IREN', 'CRWV', 'LITE', 'DRAM', 'MU', 'TSLL'],
    gexPath = GEX_PATH,
  } = options;

  console.log('===========================================================');
  console.log('🔍 [REQ-041] 云·光·存 核心标的盘口微观大单与四维共振扫描');
  console.log('===========================================================');

  let gexData = null;
  if (fs.existsSync(gexPath)) {
    try {
      gexData = JSON.parse(fs.readFileSync(gexPath, 'utf8'));
    } catch (_) {}
  }

  const results = [];

  for (const ticker of watchlist) {
    // 获取该标的最新真实交易记录价格作为参考现价
    let refPrice = 100;
    try {
      const lastSig = dbInstance.prepare(`SELECT price FROM trade_signals WHERE ticker = ? ORDER BY created_at DESC LIMIT 1`).get(ticker);
      if (lastSig && lastSig.price > 0) refPrice = lastSig.price;
    } catch (_) {}

    // 模拟盘口事件: 尾盘 15:35 触发大单扫单
    const mockTape = {
      block_buy_usd: 2800000,
      is_sweep: true,
      retail_panic: true,
      time_et: '15:35',
    };

    const res = detectTapeConfluence({
      ticker,
      currentPrice: refPrice,
      tapeEvent: mockTape,
      gexSnapshot: gexData,
      dbInstance,
    });

    console.log(`\n🎯 标的: ${res.ticker} [${res.sector}] | 总共振分: ${res.total_confluence_score} | 等级: ${res.confluence_level}`);
    console.log(`   - GEX 结构: ${res.dimensions.d1_gex_structure.score}分 (${res.dimensions.d1_gex_structure.details || '无'})`);
    console.log(`   - 大V预判: ${res.dimensions.d2_zhao_outlook.score}分 (${res.dimensions.d2_zhao_outlook.details || '无'})`);
    console.log(`   - 历史真单: ${res.dimensions.d3_trade_signals_proof.score}分 (${res.dimensions.d3_trade_signals_proof.details || '无'})`);
    console.log(`   - 盘口大单: ${res.dimensions.d4_tape_block_flow.score}分 (${res.dimensions.d4_tape_block_flow.details || '无'})`);
    if (res.observations.length) {
      console.log(`   💡 核心观察: ${res.observations[0]}`);
    }

    results.push(res);
  }

  return results;
}

/**
 * [DEBT-020] 初始化微观盘口大单持久化表结构
 */
export function initTapeBlockTable(db) {
  if (!db) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tape_block_events (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      event_time INTEGER NOT NULL,
      time_et TEXT,
      price REAL,
      size INTEGER,
      premium_usd REAL,
      sentiment TEXT,
      pattern TEXT,
      source TEXT DEFAULT 'realtime',
      raw_json TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tape_block_ticker_time 
    ON tape_block_events (ticker, event_time DESC)
  `).run();
}

/**
 * [DEBT-020] 微观盘口超级大单与扫盘流幂等持久化落盘
 */
export function persistTapeBlockEvent(db, event) {
  if (!db || !event || !event.ticker) return { ok: false, error: 'invalid args' };
  initTapeBlockTable(db);
  const now = Date.now();
  const id = event.id || `tape_${event.ticker}_${event.event_time || now}_${Math.random().toString(36).slice(2, 8)}`;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tape_block_events (
      id, ticker, event_time, time_et, price, size, premium_usd, sentiment, pattern, source, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    id,
    event.ticker.toUpperCase(),
    event.event_time || now,
    event.time_et || null,
    Number(event.price) || null,
    Number(event.size) || null,
    Number(event.premium_usd || event.block_buy_usd || 0),
    event.sentiment || event.flow_sentiment || 'NEUTRAL',
    event.pattern || null,
    event.source || 'realtime',
    typeof event.raw_json === 'string' ? event.raw_json : JSON.stringify(event),
    now
  );
  return { ok: true, id, changes: res.changes };
}

/**
 * [DEBT-020] 查询标的历史持久化盘口大单记录
 */
export function queryRecentTapeBlocks(db, ticker, limit = 20) {
  if (!db || !ticker) return [];
  try {
    initTapeBlockTable(db);
    return db.prepare(`
      SELECT * FROM tape_block_events 
      WHERE ticker = ? 
      ORDER BY event_time DESC 
      LIMIT ?
    `).all(ticker.toUpperCase(), limit);
  } catch (_) {
    return [];
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  scanSectorsConfluence();
}

