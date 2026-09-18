/**
 * REQ-037 Phase 3 — 14B ontology card extractor (offline deep lane).
 * Uses lms-guard via prepareLocalModelForInference('deep'). No WeCom / Phase4.
 */

import {
  LOCAL_LM_DEFAULT_BASE,
  prepareLocalModelForInference,
  LOCAL_PROMPT_SAFE_CHARS,
} from '../../ai-router-policy.js';

export const ONTOLOGY_SYSTEM_PROMPT = `你是交易知识本体抽取器。从大V中文发言中提炼可复用的策略卡片，只输出 JSON，不要 Markdown。

【card_type 仅允许】
- risk_rule：止损/降仓/风控纪律
- pattern：形态/缺口/突破/做T 等战法
- macro：宏观/利率/估值传导
- asset_memory：个股股性/关键位/筹码记忆

【输出 Schema】
{"cards":[{"card_type":"...","title":"...","trigger_text":"...","action_text":"...","theory_text":"...","tickers":["TSLA"]}]}

规则：
1. 无知识含量（寒暄/纯情绪）则 {"cards":[]}
2. tickers 用大写美股代码；没有则 []
3. 每条卡片字段尽量短；不要编造原文没有的价位
4. 最多 3 张卡片`;

export function cleanJsonOutput(raw) {
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

const ALLOWED = new Set(['risk_rule', 'pattern', 'macro', 'asset_memory']);

export function normalizeOntologyLlmResult(parsed, msg = {}) {
  const cardsIn = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const out = [];
  for (const c of cardsIn.slice(0, 3)) {
    const card_type = String(c.card_type || '').trim();
    if (!ALLOWED.has(card_type)) continue;
    const tickers = Array.isArray(c.tickers)
      ? c.tickers.map((t) => String(t).toUpperCase()).filter(Boolean)
      : [];
    const idBase = msg.id || 'anon';
    out.push({
      id: `ocard_llm_${card_type}_${idBase}_${out.length}`,
      card_type,
      title: String(c.title || card_type).slice(0, 120),
      trigger_text: c.trigger_text ? String(c.trigger_text).slice(0, 400) : null,
      action_text: c.action_text ? String(c.action_text).slice(0, 400) : null,
      theory_text: c.theory_text ? String(c.theory_text).slice(0, 400) : null,
      tickers,
      source_cu_id: msg.cu_id || null,
      source_message_ids: msg.id ? [msg.id] : [],
      provider: 'llm_14b',
      status: 'draft',
      schema: {
        card_type,
        title: c.title || null,
        trigger: c.trigger_text || null,
        action: c.action_text || null,
        theory: c.theory_text || null,
        tickers,
        provider: 'llm_14b',
      },
    });
  }
  return out;
}

/**
 * @param {{ id?: string, content?: string, tickers?: any, cu_id?: string }} msg
 * @param {{ baseUrl?: string, timeoutMs?: number, model?: string }} [options]
 */
export async function extractOntologyCardsWithLlm(msg, options = {}) {
  const content = String(msg?.content || '').replace(/\[IMAGE:.*?\]/gi, '').trim();
  if (!content) return [];

  const clipped = content.length > LOCAL_PROMPT_SAFE_CHARS
    ? content.slice(0, LOCAL_PROMPT_SAFE_CHARS)
    : content;

  const model = await prepareLocalModelForInference('deep', options.model);
  const baseUrl = options.baseUrl || process.env.LM_STUDIO_BASE_URL || LOCAL_LM_DEFAULT_BASE;
  const timeoutMs = options.timeoutMs || 90000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: ONTOLOGY_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `发言原文：\n${clipped}\n\n已知 tickers 提示：${msg.tickers || '[]'}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ontology_llm HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const jsonStr = cleanJsonOutput(raw);
    const parsed = JSON.parse(jsonStr);
    return normalizeOntologyLlmResult(parsed, msg);
  } finally {
    clearTimeout(timer);
  }
}
