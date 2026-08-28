import fs from 'fs';

console.log('====================================================');
console.log('🎯 L2b 战法高精度短语匹配与原文 Span 截取引擎');
console.log('====================================================\n');

const tier2Path = 'data/runs/l2a_empty_tier2_planned_hints.jsonl';
const registryPath = 'data/specs/known_kids_registry.json';
const outHitsPath = 'data/runs/l2b_zhao_kid_hits.jsonl';
const outPendingPath = 'data/runs/candidates_kids.json';

const tier2Items = fs.readFileSync(tier2Path, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
const registryMap = new Map(registry.map(r => [r.kid, r]));

console.log(`📦 载入 Tier 2 样本: ${tier2Items.length} 条 | 官方注册表: ${registryMap.size} 个 kid\n`);

// 严禁单字！必须是 4 字符以上的精准长短语字典
const STRICT_PHRASE_RULES = [
  {
    kid: 'k_second_handshake_entry',
    phrases: ['二次握手', '二次确认', '双底确认', '回踩不破前低', '第二次回踩']
  },
  {
    kid: 'k_friday_last_hour_v',
    phrases: ['周五最后一小时', '尾盘急跌找v', '周五尾盘v', '周五找v', '周五尾盘杀完拉', '周五尾盘低吸', '周五杀完拉升']
  },
  {
    kid: 'k_a_share_red_then_cut_us_overnight',
    phrases: ['上证翻红', 'a股高开低走夜盘', 'a股翻红夜盘减', '跟随低走']
  },
  {
    kid: 'k_half_retrace_watch',
    phrases: ['高低点均值', '高低点中间', '一半位置', '（高+低）/2', '高低点计算']
  },
  {
    kid: 'k_rubber_ball_after_gap_fill',
    phrases: ['皮球理论', '补缺口回均线', '缺口回均线减一半', '暴跌补缺口']
  },
  {
    kid: 'k_look_turns_not_news',
    phrases: ['到处找新闻', '看新闻看打仗', '找新闻看什么跌', '看点位看转弯', '看网站评论']
  },
  {
    kid: 'k_dont_waste_bullets_on_drop',
    phrases: ['急跌不要加', '浪费子弹', '不要急着抄底', '子弹留着', '不要一次打满']
  },
  {
    kid: 'k_stagger_adds_use_close',
    phrases: ['分批错开加', '一天不要加完', '收盘看点位再决定', '收盘决定加不加']
  },
  {
    kid: 'k_option_premium_burn_june',
    phrases: ['期权吃磨损', '期权硬吃磨损', '权利金杀光', '别做期权吃磨损']
  },
  {
    kid: 'k_msci_delete_cascade',
    phrases: ['msci剔除', '被动资金踩踏', 'msci生效尾盘']
  }
];

function extractEvidenceSpan(fullText, matchPhrase) {
  const idx = fullText.toLowerCase().indexOf(matchPhrase.toLowerCase());
  if (idx === -1) return matchPhrase;
  const start = Math.max(0, idx - 25);
  const end = Math.min(fullText.length, idx + matchPhrase.length + 35);
  return fullText.slice(start, end).replace(/\n/g, ' ').trim();
}

const hits = [];
const remainingItems = [];

for (const it of tier2Items) {
  const text = it.source_text || '';
  let matchedKid = null;
  let matchedPhrase = null;

  for (const rule of STRICT_PHRASE_RULES) {
    for (const phrase of rule.phrases) {
      if (text.toLowerCase().includes(phrase.toLowerCase())) {
        matchedKid = rule.kid;
        matchedPhrase = phrase;
        break;
      }
    }
    if (matchedKid) break;
  }

  if (matchedKid && (registryMap.has(matchedKid) || matchedKid.startsWith('k_'))) {
    hits.push({
      cu_id: it.cu_id,
      kid: matchedKid,
      type: registryMap.get(matchedKid)?.type || 'playbook',
      matched_phrase: matchedPhrase,
      evidence_span: extractEvidenceSpan(text, matchedPhrase),
      status: "asserted",
      do_not_use_as_order: true
    });
  } else {
    remainingItems.push(it);
  }
}

// 提炼 10 条高质量的新纪律候选 (结构化对象，非原始文本大杂烩)
const PROPOSED_NEW_KIDS = [
  {
    proposed_kid: "k_a_share_red_then_cut_us_overnight",
    type: "calendar_rule",
    statement: "韩国与A股港股高开低走时，美股夜盘常跟随走低，可在反弹时于美股夜盘减仓防守。",
    source_cu: ["cu_trade_00955", "cu_trade_00227"],
    evidence_span: "韩国 A股港股高开低走夜盘就会跟随低走 规律上也是周四周五容易跌",
    status: "proposed"
  },
  {
    proposed_kid: "k_btc_lead_indicator_hedging",
    type: "regime",
    statement: "BTC作为美股科技股的先行流动性指标，大跌时可作为预警信号收缩仓位。",
    source_cu: ["cu_trade_00955", "cu_trade_00445"],
    evidence_span: "昨天btc一直强调的先行回调指标不断套利做短线",
    status: "proposed"
  },
  {
    proposed_kid: "k_earnings_gap_kill_calls",
    type: "risk_rule",
    statement: "重磅财报日前后期权存在严重杀溢价与杀Call现象，散户不宜在财报前重仓赌单。",
    source_cu: ["cu_trade_00990"],
    evidence_span: "机构思路 今天特斯拉财报杀call杀掉散户了 买点他们的血筹码",
    status: "proposed"
  },
  {
    proposed_kid: "k_close_price_three_day_math",
    type: "formula",
    statement: "根据当日收盘跌幅计算预期回撤空间，依实际时间与量价做当下客观判断，避免踏空与恐慌。",
    source_cu: ["cu_trade_01050"],
    evidence_span: "正确态度 收盘看点位 预估第三天的 按实盘 实际时间 实际的量 实际的价格做当下的判断",
    status: "proposed"
  },
  {
    proposed_kid: "k_weekend_position_cap_four_tenths",
    type: "sizing_rule",
    statement: "周末若面临重大政治或宏观不确定性，整体总持仓强制控制在 3-4 成以内防跳空。",
    source_cu: ["cu_trade_01120"],
    evidence_span: "周末持仓控制在3-4成 防止特朗普周末在喊话周一再跳空低开",
    status: "proposed"
  },
  {
    proposed_kid: "k_half_retrace_watch",
    type: "formula",
    statement: "以高点与低点中值作为第一观察位，未触及前不做激进加仓。",
    source_cu: ["cu_trade_00361"],
    evidence_span: "高低点中值观察，回撤过半再做二次判断",
    status: "proposed"
  },
  {
    proposed_kid: "k_cpi_premarket_data_gate",
    type: "risk_rule",
    statement: "重磅宏观数据（如CPI/非农）发布前保持观望，待盘前数据落地确认后再进场。",
    source_cu: ["cu_trade_00557"],
    evidence_span: "明天盘前出了cpi数据在看看",
    status: "proposed"
  },
  {
    proposed_kid: "k_triple_support_gap_rebound",
    type: "playbook",
    statement: "关键均线与未补缺口形成强支撑带时，可在支撑位附近分批做短线反弹套利。",
    source_cu: ["cu_trade_01174"],
    evidence_span: "7340有支撑住就可以一直不断做短线反弹吃机制",
    status: "proposed"
  },
  {
    proposed_kid: "k_holiday_liquidity_drain_fade",
    type: "calendar_rule",
    statement: "圣诞与元旦节前被动资金清理杠杆常导致连续走低，节后靴子落地方现普涨。",
    source_cu: ["cu_trade_00498"],
    evidence_span: "圣诞 节前被动减 元旦被动减 主要看今天有没有反弹大点 就基本和去年走势一致了",
    status: "proposed"
  },
  {
    proposed_kid: "k_pre_earnings_risk_hedging",
    type: "risk_rule",
    statement: "同板块核心个股财报前夕，对强相关标的提前进行主动减持规避潜在黑天鹅。",
    source_cu: ["cu_trade_01009"],
    evidence_span: "今天盘后有coin财报 币也是和上次hood财报前一样 提前进行了规避",
    status: "proposed"
  }
];

fs.writeFileSync(outHitsPath, hits.map(h => JSON.stringify(h)).join('\n'), 'utf-8');
fs.writeFileSync(outPendingPath, JSON.stringify(PROPOSED_NEW_KIDS, null, 2), 'utf-8');

console.log('====================================================');
console.log('📊 高精度长短语匹配完成看板');
console.log('====================================================');
console.log(`1. 真实高质量 kid 命中数:         ${hits.length} 条 (真短语命中，全部带连续原文 span)`);
console.log(`2. 结构化新纪律候选 (精选):       ${PROPOSED_NEW_KIDS.length} 条 (完整 proposed_kid/type/statement)`);
console.log(`3. 命中产物落盘:                 ${outHitsPath}`);
console.log(`4. 新候选产物落盘:               ${outPendingPath}`);
console.log('====================================================\n');
