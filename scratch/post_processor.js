/**
 * post_processor.js - 确定性语义抽取后处理清洗管道
 * 
 * 核心功能：
 * 1. Ticker 别名映射与无效值剔除 (CFIR->CIFR, 奈飞双倍->NFXL, 剔除未指定股票代码)
 * 2. speech_act 5个硬枚举兜底归一化
 * 3. 止损/止盈动词精准归一 (STOP_LOSS, TAKE_PROFIT)
 * 4. 价格区间与相邻相近拆单合并 (价差 < 2% 合并取左端点)
 */

const TICKER_ALIAS_MAP = {
  'CFIR': 'CIFR',
  'NFLX': 'NFXL',
  '奈飞双倍': 'NFXL',
  '特斯拉两倍': 'TSLL',
  '英伟达两倍': 'NVDL',
  '微策略两倍': 'MSTX',
  'COIN两倍': 'CONL',
  'BRKB': 'BRK.B'
};

const VALID_SPEECH_ACTS = new Set(['trade_action', 'market_view', 'qa_guidance', 'risk_control', 'noise']);
const VALID_ACTIONS = new Set(['BUY', 'SELL', 'HOLD', 'STOP_LOSS', 'TAKE_PROFIT']);

export function cleanAndNormalizeEnvelope(rawEnvelope, rawTextContext = '') {
  if (!rawEnvelope || typeof rawEnvelope !== 'object') return null;

  const env = JSON.parse(JSON.stringify(rawEnvelope)); // Deep copy

  // 1. 规范化 speech_act
  if (!VALID_SPEECH_ACTS.has(env.speech_act)) {
    if (env.actions && env.actions.length > 0) {
      env.speech_act = 'trade_action';
    } else if (rawTextContext.includes('?') || rawTextContext.includes('？') || rawTextContext.includes('怎么看')) {
      env.speech_act = 'qa_guidance';
    } else if (/仓位|止损|风控|风险/i.test(rawTextContext)) {
      env.speech_act = 'risk_control';
    } else {
      env.speech_act = 'market_view';
    }
  }

  // 2. 清洗 actions 列表
  if (Array.isArray(env.actions)) {
    const cleanedActions = [];

    for (let i = 0; i < env.actions.length; i++) {
      const act = env.actions[i];
      if (!act) continue;

      let sym = (act.ticker || '').trim().toUpperCase();
      if (TICKER_ALIAS_MAP[sym]) sym = TICKER_ALIAS_MAP[sym];

      // 剔除无代码或无效占位符
      if (!sym || sym.includes('未指定') || sym === 'NULL' || sym === 'UNKNOWN') {
        continue;
      }

      // 规范化 action 动词
      let actionVerb = (act.action || '').toUpperCase();
      if (!VALID_ACTIONS.has(actionVerb)) {
        if (/止损|损/i.test(act.condition || '') || /止损/i.test(rawTextContext)) actionVerb = 'STOP_LOSS';
        else if (/止盈|翻倍出/i.test(act.condition || '') || /止盈/i.test(rawTextContext)) actionVerb = 'TAKE_PROFIT';
        else if (/吸|加|买|接/i.test(actionVerb)) actionVerb = 'BUY';
        else if (/出|卖|减|清|抛/i.test(actionVerb)) actionVerb = 'SELL';
        else actionVerb = 'BUY';
      }

      // 价格规范化
      let priceVal = act.price;
      if (typeof priceVal === 'string') {
        const pNum = parseFloat(priceVal);
        priceVal = isNaN(pNum) ? null : pNum;
      }

      // 状态规范化
      let statusVal = act.status || 'planned';
      if (/加了|出了|成了|买了|减了|回吸了|清了/i.test(act.condition || rawTextContext)) {
        if (!/可以|注意|准备|挂/i.test(act.condition || rawTextContext)) {
          statusVal = 'filled';
        }
      }

      cleanedActions.push({
        ...act,
        ticker: sym,
        action: actionVerb,
        price: priceVal,
        status: statusVal,
        instrument: act.instrument || (sym.endsWith('C') || sym.endsWith('P') ? 'option' : 'stock')
      });
    }

    // 3. 区间拆单合并：相邻且价差 < 2% 同方向标的合并取左端点
    const mergedActions = [];
    for (let i = 0; i < cleanedActions.length; i++) {
      const cur = cleanedActions[i];
      if (mergedActions.length > 0) {
        const prev = mergedActions[mergedActions.length - 1];
        if (
          prev.ticker === cur.ticker &&
          prev.action === cur.action &&
          prev.price !== null &&
          cur.price !== null &&
          Math.abs(prev.price - cur.price) / Math.max(prev.price, cur.price) < 0.02
        ) {
          // 合并，保留左端点（较小值或首个值）
          prev.price = Math.min(prev.price, cur.price);
          continue;
        }
      }
      mergedActions.push(cur);
    }

    env.actions = mergedActions;
  }

  // 4. claims 标的别名清洗
  if (Array.isArray(env.claims)) {
    for (const c of env.claims) {
      if (c.ticker) {
        let sym = c.ticker.trim().toUpperCase();
        if (TICKER_ALIAS_MAP[sym]) sym = TICKER_ALIAS_MAP[sym];
        c.ticker = sym;
      }
    }
  }

  return env;
}
