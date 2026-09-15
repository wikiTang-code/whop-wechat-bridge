/**
 * slm-extractor.js
 * 大V交易语义专有提取器 (SLM / Local 14B / Edge Engine)
 * 
 * 职责：
 * 1. 结构化抽取口语化交易要素 (Symbol, Action, Price, SourceLotPrice, Fraction, StopLoss)
 * 2. 对接本地反代 LM Studio (默认 http://127.0.0.1:8080，qwen2.5-14b-instruct)
 * 3. 具备极低延迟、零外部 API 开销、双重确定性兜底 (LLM JSON -> Tokenizer Fallback)
 */

import { extractSemanticPrice } from './price_extractor.js';
import { LOCAL_LM_DEFAULT_BASE, LOCAL_LM_DEFAULT_MODEL, resolveLocalModel } from './ai-router-policy.js';

const SYSTEM_PROMPT = `你是一个顶级美股量化交易信号提取器，专门解析交易大V的中文口语喊单和调仓发言。
你的任务是严格从用户文本中提取交易动作要素并输出纯 JSON 对象，禁止输出任何解释或 Markdown 代码块外的内容。

【提取规范】
1. has_trade: 布尔值。如果文本仅为大盘宏观点评、闲聊、新闻转发、无具体标的调仓，必须为 false。
2. trades: 交易动作数组（可为空）。每个元素包含：
   - symbol: 标的大写代码 (如 TSLL, LITE, CONL, IREN, CIFR, CRWV, NVDL, QQQ, NVDA 等)。
   - action: "BUY" (买入/加仓/加回/建仓/接回/开仓) 或 "SELL" (卖出/减仓/出掉/平本出/止损)。
   - price_type: "LIMIT" (限价/指定价) 或 "MARKET" (市价) 或 "RANGE" (区间价格)。
   - price: 本次执行价格数字 (浮点数)。若是区间 (如 930-931) 则取均值 930.5。
   - source_lot_price: 若为做T买回原先卖出批次 (如 "7.67买回7.99卖出的")，则 price=7.67, source_lot_price=7.99；若为指定批次卖出 (如 "866出一半 855的lite")，则 price=866, source_lot_price=855；若无指定批次则为 null。
   - fraction_desc: 仓位描述 (如 "三分之一常规仓", "半仓", "出剩下一半", "全部")。
   - fraction_ratio: 数字化比例 (如三分之一为 0.333，一半为 0.5，全部为 1.0)。
   - stop_loss: 明确指定的止损价数字，未提及则为 null。
   - is_day_trade: 是否明确标注日内交易 (如 "做日内", "日内出")。

【输出示例】
输入: "866出一半 855的lite"
输出: {"has_trade":true,"trades":[{"symbol":"LITE","action":"SELL","price_type":"LIMIT","price":866,"source_lot_price":855,"fraction_desc":"出剩下一半","fraction_ratio":0.5,"stop_loss":null,"is_day_trade":false}]}

输入: "7.67在买回 7.99卖出的部分conl 就是不断套利降本"
输出: {"has_trade":true,"trades":[{"symbol":"CONL","action":"BUY","price_type":"LIMIT","price":7.67,"source_lot_price":7.99,"fraction_desc":"部分","fraction_ratio":0.333,"stop_loss":null,"is_day_trade":false}]}

输入: "指数在7450压力后选择往下补7200缺口，大家控制风险"
输出: {"has_trade":false,"trades":[]}`;

/**
 * 清洗模型返回的内容，提取纯 JSON 字符串
 */
function cleanJsonOutput(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }
  return text;
}

/**
 * 结构化解析单条交易发言
 * @param {string} rawContent 原始发言
 * @param {object} options 选项 { baseUrl, model, timeoutMs }
 */
export async function extractTradeWithSLM(rawContent, options = {}) {
  const baseUrl = options.baseUrl || process.env.LM_STUDIO_BASE_URL || LOCAL_LM_DEFAULT_BASE;
  const model = resolveLocalModel('trade', options.model);
  const timeoutMs = options.timeoutMs || 8000;

  if (!rawContent || !rawContent.trim()) {
    return { has_trade: false, trades: [], source: 'empty_input' };
  }

  const cleanText = rawContent.replace(/\[IMAGE:.*?\]/gi, '').trim();
  if (!cleanText) {
    return { has_trade: false, trades: [], source: 'empty_clean' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: cleanText }
        ],
        temperature: 0.1
      })
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[SLM Extractor] HTTP ${res.status}: ${errText.substring(0, 100)} - fallback to tokenizer`);
      return fallbackToTokenizer(cleanText);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    const jsonStr = cleanJsonOutput(content);
    const parsed = JSON.parse(jsonStr);

    return {
      has_trade: Boolean(parsed.has_trade && Array.isArray(parsed.trades) && parsed.trades.length > 0),
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      source: 'slm_qwen14b',
      raw_text: cleanText
    };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[SLM Extractor] Warning (${err.name || err.message}), falling back to local tokenizer`);
    return fallbackToTokenizer(cleanText);
  }
}

function fallbackToTokenizer(text) {
  // 简易探测标的与动作
  const tickerMatch = text.match(/\b([A-Za-z]{2,5})\b/);
  const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : null;
  let action = null;
  // 0. 特殊高优：做T买回/接回模式 (如 "7.67在买回 7.99卖出的部分conl")
  if (/(?:买回|加回|接回|回买|回吸)/.test(text)) {
    action = 'BUY';
  } else if (/(\d+(?:\.\d+)?)\s*(?:附近|左右|元|刀|\$)?\s*(?:也是|先|直接|可以|准备)?\s*(?:出了|卖了|出掉|平仓|先出|出完|止损|出|卖|减|平)/.test(text)) {
    action = 'SELL';
  } else if (/(\d+(?:\.\d+)?)\s*(?:附近|左右|元|刀|\$)?\s*(?:也是|先|直接|可以|准备)?\s*(?:开了|加了|买了|建仓|接了|补了|买|加|开)/.test(text)) {
    action = 'BUY';
  } else {
    // 2. 备选：根据首个核心交易动作的位置判断
    const buyIdx = text.search(/(?:买入|加仓|建仓|买回|加回|接回|开仓|开了|买了|加了)/);
    const sellIdx = text.search(/(?:卖出|减仓|出掉|平仓|平本出|止损|出了|卖了)/);
    if (buyIdx !== -1 && sellIdx !== -1) {
      action = buyIdx < sellIdx ? 'BUY' : 'SELL';
    } else if (buyIdx !== -1) {
      action = 'BUY';
    } else if (sellIdx !== -1) {
      action = 'SELL';
    } else if (/(?:买|加|接|开)/.test(text)) {
      action = 'BUY';
    } else if (/(?:出|卖|减|平)/.test(text)) {
      action = 'SELL';
    }
  }

  if (!ticker || !action) {
    return { has_trade: false, trades: [], source: 'fallback_tokenizer_notrade' };
  }

  const slot = extractSemanticPrice(text, ticker, action);
  if (slot.price === null) {
    return { has_trade: false, trades: [], source: 'fallback_tokenizer_noprice' };
  }

  return {
    has_trade: true,
    trades: [{
      symbol: ticker,
      action,
      price_type: 'LIMIT',
      price: slot.price,
      source_lot_price: slot.sourceLotPrice || null,
      fraction_desc: '兜底推断',
      fraction_ratio: 0.333,
      stop_loss: null,
      is_day_trade: text.includes('日内')
    }],
    source: 'fallback_tokenizer',
    raw_text: text
  };
}
