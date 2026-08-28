import fs from 'fs';

console.log('====================================================');
console.log('🎯 严格遵循 Grok 审计 C 节：L2b 高精度正则短语匹配器');
console.log('====================================================\n');

const tier2Path = 'data/runs/l2a_empty_tier2_planned_hints.jsonl';
const sourceCuPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const outHitsPath = 'data/runs/l2b_zhao_kid_hits.jsonl';

const tier2Items = fs.readFileSync(tier2Path, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// 载入源对话文本
const sourceTextMap = new Map();
if (fs.existsSync(sourceCuPath)) {
  const sLines = fs.readFileSync(sourceCuPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const sl of sLines) {
    const sObj = JSON.parse(sl);
    const msgs = sObj.dialogue_messages || [];
    const fullText = msgs.map(m => m.text).filter(Boolean).join('\n');
    sourceTextMap.set(sObj.cu_id, fullText);
  }
}

// 严格按照 Grok 审计 C 节定义的正则表
const REGEX_RULES = [
  {
    kid: 'k_second_handshake',
    type: 'playbook',
    regex: /二次握手|二次回踩|二次确认/i
  },
  {
    kid: 'k_friday_last_hour_v',
    type: 'playbook',
    regex: /最后一小时.{0,12}找?V|尾盘强平.{0,20}V/i
  },
  {
    kid: 'k_friday_long_then_short',
    type: 'calendar_rule',
    regex: /周五.{0,20}双杀|周五.{0,20}先多后空|周五.{0,20}多空|多空双杀|空方先开上半场/i
  },
  {
    kid: 'k_a_share_red_then_cut_us_overnight',
    type: 'calendar_rule',
    regex: /上证.{0,30}翻红.{0,30}夜盘.{0,20}减|A股港股.{0,30}夜盘/i
  },
  {
    kid: 'k_half_retrace_watch',
    type: 'formula',
    regex: /\(高[\s\S]+低\).{0,8}\/\s*2|一半位置|\([0-9\.]+\+[0-9\.]+\)\/2/i
  },
  {
    kid: 'k_earnings_fade_batch',
    type: 'risk_rule',
    regex: /财报.{0,20}(先出|杀多|分批出|最高点)/i
  },
  {
    kid: 'k_passive_redeem_then_rebuy',
    type: 'playbook',
    regex: /被动减/i
  }
];

function extractEvidenceSpan(fullText, matchStr) {
  const idx = fullText.indexOf(matchStr);
  if (idx === -1) return matchStr;
  const start = Math.max(0, idx - 30);
  const end = Math.min(fullText.length, idx + matchStr.length + 45);
  return fullText.slice(start, end).replace(/\n/g, ' ').trim();
}

const hits = [];

for (const it of tier2Items) {
  const text = sourceTextMap.get(it.cu_id) || it.source_text || '';
  
  for (const rule of REGEX_RULES) {
    const match = text.match(rule.regex);
    if (match) {
      hits.push({
        cu_id: it.cu_id,
        kid: rule.kid,
        type: rule.type,
        matched_phrase: match[0],
        evidence_span: extractEvidenceSpan(text, match[0]),
        status: "asserted",
        do_not_use_as_order: true
      });
      break; // 单窗优先取第一个强规则
    }
  }
}

fs.writeFileSync(outHitsPath, hits.map(h => JSON.stringify(h)).join('\n'), 'utf-8');

console.log('====================================================');
console.log('📊 Grok C 节规范短语命中结果看板');
console.log('====================================================');
console.log(`1. Tier 2 输入记录数:             ${tier2Items.length} 条`);
console.log(`2. 严格命中标准 kid 记录数:       ${hits.length} 条`);
for (const r of hits) {
  console.log(`   👉 [${r.cu_id}] -> ${r.kid} | 证据: "${r.evidence_span.slice(0, 60)}..."`);
}
console.log(`----------------------------------------------------`);
console.log(`💾 严格命中产物已写入: ${outHitsPath}`);
console.log('====================================================\n');
