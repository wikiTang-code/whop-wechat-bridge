/**
 * tools/knowledge/ontology_query_engine.js
 * REQ-037 Layer 4: 交易体系策略本体知识图谱智能检索与匹配引擎
 * 
 * 核心功能：
 * 1. 根据标的 (Ticker)、交易意图或盘中事件文本，精准召回历史策略本体卡片
 * 2. 多维综合加权打分 (标的命中 + 意图关键词 + 规则置信度 + 时效性)
 * 3. 支持四大策略卡片筛选 (risk_rule, pattern, macro, asset_memory)
 * 4. 为实盘参谋、盘后复盘及移动端推演卡提供底层高性能只读支撑
 */

import { initDb, getDb, ensureOntologyCardTable } from '../../database.js';

/**
 * 意图关键词特征映射表
 */
const INTENT_KEYWORD_MAP = {
  risk: ['止损', '降仓', '砍仓', '破位', '防踩踏', '底仓不盲动', '资金安全', '无条件', '不加大仓'],
  pattern: ['缺口', '突破', '回踩', '箱体', '做T', '喇叭口', '双底', '头肩', '均线', '形态'],
  macro: ['降息', '加息', '美联储', '鲍威尔', 'CPI', 'PMI', '通胀', '流动性', '宏观', '非农', '财政部'],
  asset: ['股性', '主力', '庄家', '洗盘', '做市商', '关键位', '支撑点', '阻力位', '筹码']
};

/**
 * 计算文本中命中关键词的个数
 */
function countKeywordHits(text, keywords) {
  if (!text) return 0;
  const str = String(text).toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (str.includes(kw.toLowerCase())) {
      hits++;
    }
  }
  return hits;
}

/**
 * 核心检索与打分函数
 * @param {object} params
 * @param {string} [params.ticker] 目标标的代码 (如 QQQ, NVDA, TSLA)
 * @param {string} [params.text] 盘中事件或查询文本 (如 "跌破支撑位考虑止损")
 * @param {string} [params.cardType] 指定卡片类型 (risk_rule | pattern | macro | asset_memory)
 * @param {number} [params.minConfidence=0.0] 最小置信度过滤阈值 (0.0 ~ 1.0)
 * @param {number} [params.limit=5] 返回前 N 条结果
 * @param {object} [params.dbInstance] 可选的数据库连接
 * @returns {Array<object>} 排序后的策略卡片列表 (含 score 与 match_reason)
 */
export function queryKnowledgeCards(params = {}) {
  const {
    ticker = '',
    text = '',
    cardType = null,
    minConfidence = 0.0,
    limit = 5,
    dbInstance = null
  } = params;

  initDb();
  const db = dbInstance || getDb();
  ensureOntologyCardTable(db);

  const cleanTicker = String(ticker || '').trim().toUpperCase();
  const cleanText = String(text || '').trim();

  // 1. 构建基础 SQL 查询
  let sql = `SELECT * FROM ontology_card WHERE 1=1`;
  const sqlParams = [];

  if (cardType) {
    sql += ` AND card_type = ?`;
    sqlParams.push(cardType);
  }

  // 初步快速初筛
  if (cleanTicker) {
    sql += ` AND (tickers_json LIKE ? OR title LIKE ? OR trigger_text LIKE ?)`;
    const tickerPattern = `%${cleanTicker}%`;
    sqlParams.push(tickerPattern, tickerPattern, tickerPattern);
  }

  sql += ` ORDER BY updated_at DESC LIMIT 150`;

  const candidates = db.prepare(sql).all(...sqlParams);

  // 2. 内存综合相关度评分机制 (Score: 0 ~ 100)
  const scored = [];

  for (const c of candidates) {
    let score = 0;
    const matchReasons = [];

    let tickers = [];
    try {
      tickers = JSON.parse(c.tickers_json || '[]');
    } catch (_) {}

    let schema = {};
    try {
      schema = JSON.parse(c.schema_json || '{}');
    } catch (_) {}

    const confidence = Number(schema.confidence) || 0.85;
    if (confidence < minConfidence) {
      continue;
    }

    // 维度 1: 标的匹配评分 (最高 40 分)
    if (cleanTicker) {
      if (tickers.includes(cleanTicker)) {
        score += 40;
        matchReasons.push(`精确匹配标的 [${cleanTicker}] (+40)`);
      } else if (c.title?.includes(cleanTicker) || c.trigger_text?.includes(cleanTicker)) {
        score += 25;
        matchReasons.push(`文本涉及标的 [${cleanTicker}] (+25)`);
      }
    }

    // 维度 2: 事件/意图语义关键词评分 (最高 35 分)
    if (cleanText) {
      const fullCardText = `${c.title || ''} ${c.trigger_text || ''} ${c.action_text || ''} ${c.theory_text || ''}`;
      
      // 直接文本重合
      const directHits = countKeywordHits(fullCardText, cleanText.split(/[\s,，。]+/));
      if (directHits > 0) {
        const textScore = Math.min(25, directHits * 8);
        score += textScore;
        matchReasons.push(`命中查询词 ${directHits} 处 (+${textScore})`);
      }

      // 意图维度匹配
      for (const [intent, kws] of Object.entries(INTENT_KEYWORD_MAP)) {
        const queryIntentHits = countKeywordHits(cleanText, kws);
        const cardIntentHits = countKeywordHits(fullCardText, kws);
        if (queryIntentHits > 0 && cardIntentHits > 0) {
          score += 10;
          matchReasons.push(`意图领域 [${intent}] 对齐 (+10)`);
          break;
        }
      }
    }

    // 维度 3: 规则质量与置信度权重 (最高 15 分)
    const confScore = Math.round(confidence * 15);
    score += confScore;
    matchReasons.push(`置信度权重 ${(confidence * 100).toFixed(0)}% (+${confScore})`);

    // 维度 4: 基础基准分 (10 分)
    score += 10;

    scored.push({
      card: {
        id: c.id,
        card_type: c.card_type,
        title: c.title,
        trigger_text: c.trigger_text,
        action_text: c.action_text,
        theory_text: c.theory_text,
        tickers,
        provider: c.provider,
        updated_at: c.updated_at
      },
      score: Math.min(100, score),
      match_reasons: matchReasons
    });
  }

  // 按得分降序排序
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

// 供 CLI 调试使用
const isDirectCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/knowledge/ontology_query_engine.js');
if (isDirectCli) {
  const args = process.argv.slice(2);
  let ticker = '';
  let text = '';
  let cardType = null;
  let limit = 3;
  let minConfidence = 0.0;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--ticker' || a === '-t') {
      ticker = args[++i];
    } else if (a === '--query' || a === '-q') {
      text = args[++i];
    } else if (a === '--type') {
      cardType = args[++i];
    } else if (a === '--limit' || a === '-l') {
      limit = parseInt(args[++i], 10) || 3;
    } else if (a === '--min-conf' || a === '--min-confidence') {
      minConfidence = parseFloat(args[++i]) || 0.0;
    } else if (a === '--json') {
      jsonOutput = true;
    } else if (!a.startsWith('-')) {
      if (!ticker) ticker = a;
      else if (!text) text = a;
    }
  }

  if (!ticker && !text) {
    ticker = 'QQQ';
    text = '突破回踩加仓';
  }

  console.log('===========================================================');
  console.log(`🔍 策略本体检索查询: Ticker="${ticker || '(全部)'}", Query="${text || '(无)'}", Type="${cardType || '(全类型)'}", minConf=${minConfidence}`);
  console.log('===========================================================');

  const results = queryKnowledgeCards({ ticker, text, cardType, limit, minConfidence });

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log('未找到符合条件的策略卡片。');
    } else {
      results.forEach((r, idx) => {
        const c = r.card;
        const icon = c.card_type === 'risk_rule' ? '🛡️' : c.card_type === 'pattern' ? '📈' : c.card_type === 'macro' ? '🌐' : '🎯';
        console.log(`\n#${idx + 1} [匹配度: ${r.score}分] ${icon} 【${c.title}】 (${c.card_type})`);
        console.log(`   - 关联标的: [${(c.tickers || []).join(', ') || '通用'}]`);
        console.log(`   - 触发条件: ${c.trigger_text}`);
        console.log(`   - 应对战术: ${c.action_text}`);
        console.log(`   - 底层因果: ${c.theory_text}`);
        console.log(`   - 匹配理由: ${r.match_reasons.join(' | ')}`);
      });
      console.log('\n===========================================================');
    }
  }
}
