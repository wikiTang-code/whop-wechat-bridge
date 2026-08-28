import fs from 'fs';

console.log('====================================================');
console.log('🎯 Tier 2 (148条) 赵哥 L2b 知识原子纯撞表匹配引擎');
console.log('====================================================\n');

const tier2Path = 'data/runs/l2a_empty_tier2_planned_hints.jsonl';
const registryPath = 'data/specs/known_kids_registry.json';
const outHitsPath = 'data/runs/l2b_zhao_kid_hits.jsonl';
const outPendingPath = 'data/runs/candidates_kids.json';

if (!fs.existsSync(tier2Path) || !fs.existsSync(registryPath)) {
  console.error('❌ 缺少输入文件');
  process.exit(1);
}

const tier2Items = fs.readFileSync(tier2Path, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
const registryKidSet = new Set(registry.map(r => r.kid));

console.log(`📦 载入 Tier 2 口诀候选: ${tier2Items.length} 条 | 官方标准战法注册表: ${registryKidSet.size} 个 kid\n`);

// 确定性关键词撞表规则 (严格基于已知 30 个 kid)
const KID_MATCH_RULES = [
  { kid: 'k_friday_last_hour_v', keywords: ['周五', '最后一小时', '尾盘急跌', 'v反', '尾盘v'] },
  { kid: 'k_second_handshake_entry', keywords: ['二次握手', '二次确认', '双底确认', '回踩不破'] },
  { kid: 'k_stagger_adds_use_close', keywords: ['分批加', '错开加', '一天不要加完', '收盘看点位', '收盘决定'] },
  { kid: 'k_dont_waste_bullets_on_drop', keywords: ['不要急着抄底', '子弹', '浪费子弹', '急跌不要加'] },
  { kid: 'k_look_turns_not_news', keywords: ['到处找新闻', '看新闻', '看打仗', '看网站评论', '看点位看转弯'] },
  { kid: 'k_rubber_ball_after_gap_fill', keywords: ['皮球理论', '补缺口', '回均线减一半', '急弹止盈'] },
  { kid: 'k_option_premium_burn_june', keywords: ['期权磨损', '吃磨损', '别做期权', '权利金杀'] },
  { kid: 'k_tier2_bonds_debt_equity_swap', keywords: ['债', '龙二', '发股还债', '转债'] },
  { kid: 'k_msci_delete_cascade', keywords: ['msci', '剔除', '被动资金', '踩踏'] },
  { kid: 'k_first_drop_bounce_gap', keywords: ['首跌', '第一次跌', '反弹补缺', '回抽均线'] },
  { kid: 'k_hold_cash_on_uncertainty', keywords: ['留现金', '持币', '不确定', '观望为主', '多看少动'] },
  { kid: 'k_dont_frontrun_data', keywords: ['不要抢跑', '等数据', '等cpi', '等非农', '靴子落地'] },
  { kid: 'k_morning_flush_afternoon_reversal', keywords: ['早盘跳水', '下午拉升', '探底回升', '早杀午拉'] },
  { kid: 'k_options_expiry_pinning', keywords: ['末日期权', '行权价压制', '最大痛点', '交割日'] },
  { kid: 'k_fed_meeting_chop', keywords: ['议息会议', '美联储', '鲍威尔', '加息', '降息震荡'] },
  { kid: 'k_trailing_stop_lock_profit', keywords: ['移动止损', '推止损', '保住利润', '成本位止损'] }
];

const hits = [];
const pendingCandidates = [];

for (const it of tier2Items) {
  const text = it.source_text || '';
  let matchedKid = null;
  let matchedKeyword = null;

  for (const rule of KID_MATCH_RULES) {
    for (const kw of rule.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        matchedKid = rule.kid;
        matchedKeyword = kw;
        break;
      }
    }
    if (matchedKid) break;
  }

  if (matchedKid && registryKidSet.has(matchedKid)) {
    hits.push({
      cu_id: it.cu_id,
      kid: matchedKid,
      evidence_span: `命中关键词 [${matchedKeyword}] 于对话`,
      source_text_snippet: text.slice(0, 120),
      status: "asserted",
      do_not_use_as_order: true
    });
  } else {
    pendingCandidates.push({
      cu_id: it.cu_id,
      source_text_snippet: text.slice(0, 150),
      reason: "未命中 30 个已知标准 kid，作为候选留存人工审核"
    });
  }
}

fs.writeFileSync(outHitsPath, hits.map(h => JSON.stringify(h)).join('\n'), 'utf-8');
fs.writeFileSync(outPendingPath, JSON.stringify(pendingCandidates, null, 2), 'utf-8');

console.log('====================================================');
console.log('📊 Tier 2 纯撞表匹配结果看板 (L2b Hit Scorecard)');
console.log('====================================================');
console.log(`1. Tier 2 待测总数:              ${tier2Items.length} 条`);
console.log(`2. 成功撞中官方标准 kid:          ${hits.length} 条 (${((hits.length / tier2Items.length) * 100).toFixed(1)}%)`);
console.log(`3. 留存待人工审核新候选:          ${pendingCandidates.length} 条`);
console.log(`4. 官方 kid 命中文档落盘:         ${outHitsPath}`);
console.log(`5. 待审新候选文档落盘:           ${outPendingPath}`);
console.log('====================================================\n');
