/**
 * REQ-037 Phase 3 — stub ontology card extractor (no 14B / no VL).
 * Keyword heuristics only; provider=stub, status=draft|pending_llm.
 */

const RULES = [
  {
    card_type: 'risk_rule',
    title: '止损/降仓纪律',
    re: /止损|降仓|砍仓|无条件|风控|踩踏/,
    trigger_text: '出现止损/降仓类纪律表述',
    action_text: '按纪律减仓或离场（stub）',
    theory_text: '风险优先于预测',
  },
  {
    card_type: 'pattern',
    title: '形态/缺口战法',
    re: /缺口|回补|突破|回踩|箱体|喇叭口|做T|降本/,
    trigger_text: '出现形态/缺口/做T类表述',
    action_text: '按形态条件执行（stub）',
    theory_text: '价格结构与资金博弈',
  },
  {
    card_type: 'macro',
    title: '宏观传导逻辑',
    re: /降息|加息|美联储|估值|传导|宏观|流动性/,
    trigger_text: '出现宏观/利率/估值传导表述',
    action_text: '纳入宏观偏置（stub）',
    theory_text: '宏观决定风险偏好',
  },
  {
    card_type: 'asset_memory',
    title: '标的股性记忆',
    re: /股性|关键位|机构|控盘|筹码|支撑|阻力/,
    trigger_text: '出现个股股性/关键位记忆',
    action_text: '写入标的画像（stub）',
    theory_text: '标的历史行为可复用',
  },
];

function parseTickers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).toUpperCase()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t).toUpperCase()).filter(Boolean);
  } catch (_) {}
  return [];
}

/**
 * @param {{ id?: string, content?: string, tickers?: any, cu_id?: string }} msg
 * @returns {Array<object>} cards ready for saveOntologyCard
 */
export function buildStubOntologyCards(msg = {}) {
  const content = String(msg.content || '');
  const tickers = parseTickers(msg.tickers);
  const cards = [];
  for (const rule of RULES) {
    if (!rule.re.test(content)) continue;
    const idBase = msg.id || 'anon';
    cards.push({
      id: `ocard_stub_${rule.card_type}_${idBase}`,
      card_type: rule.card_type,
      title: rule.title,
      trigger_text: rule.trigger_text,
      action_text: rule.action_text,
      theory_text: rule.theory_text,
      tickers,
      source_cu_id: msg.cu_id || null,
      source_message_ids: msg.id ? [msg.id] : [],
      provider: 'stub',
      status: 'pending_llm',
      schema: {
        card_type: rule.card_type,
        title: rule.title,
        trigger: rule.trigger_text,
        action: rule.action_text,
        theory: rule.theory_text,
        tickers,
        stub: true,
      },
    });
  }
  return cards;
}
