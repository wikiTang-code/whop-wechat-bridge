import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 6 档 (4001~5000 条) 精修：双底*0.98细则 + 节前三天/春节赎回/周五普涨/指数大缺口');
console.log('========================================================================================\n');

// 1. 读取第 4001 ~ 5000 条消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 4000
`).all();

const goldLessons = JSON.parse(fs.readFileSync('data/l2b/gold/l2b_gold_lessons.json', 'utf-8'));
const treeInstancesMap = new Map();
goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));

const gapSubdivision = {
  rule_replays: [],
  point_memos: []
};

const skippedAuditLog = [];
const seenContentSet = new Set();
const seen70PctDays = new Set();

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|首阴|首阳|MSCI|低吸三种|0DTE|1.5倍|腰斩|翻倍|100跌50|春节赎回|大缺口)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 4001 + i;
  const msg = zhaoMessages[i];
  let text = msg.content || '';
  text = text.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
  if (text.length < 6) continue;

  const match = text.match(BOOKMARK_REGEX);
  if (!match) continue;

  bookmarkedCount++;
  const triggerWord = match[0];
  const etDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(msg.created_at));

  // 跨频道去重
  const contentKey = text.replace(/\s+/g, '');
  const isDuplicate = seenContentSet.has(contentKey);
  seenContentSet.add(contentKey);

  if (isDuplicate) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'duplicate_post',
      reason: '跨频道完全重复发布，不重复记账',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 1. prop_016: 指数大缺口隔月回补与个股低位大仓位吸筹
  if (text.includes('指数大缺口') || (text.includes('大缺口回补') && text.includes('大仓位'))) {
    treeInstancesMap.get('prop_016_index_macro_gap_heavy_dip').push({
      index: globalIdx,
      tree_id: 'prop_016_index_macro_gap_heavy_dip',
      tree_name: '指数大缺口隔月回补与个股低位大仓位吸筹法',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 2. prop_002: 腰斩 50% 迎翻倍 (含 100跌50 50去买)
  if (text.includes('100跌50') || (text.includes('腰斩') && text.includes('50%'))) {
    treeInstancesMap.get('prop_002_cut_in_half_100_percent').push({
      index: globalIdx,
      tree_id: 'prop_002_cut_in_half_100_percent',
      tree_name: '事件腰斩50%迎翻倍100%机会',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 3. gold_007: 靴子落地与周五结算走普涨
  if (text.includes('周五') && (text.includes('结算普涨') || text.includes('走结算普涨') || text.includes('靴子落地'))) {
    treeInstancesMap.get('gold_007_shoe_drops_settlement').push({
      index: globalIdx,
      tree_id: 'gold_007_shoe_drops_settlement',
      tree_name: '重大事件靴子落地走普涨',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 4. gold_006: 节前被动减 (含双底极限*0.98细则、节前三天、春节赎回、被动减最后一天)
  if (text.includes('节前被动减') || text.includes('节前三天') || text.includes('春节赎回') || (text.includes('被动减') && (text.includes('最后一天') || text.includes('0.98') || text.includes('双底')))) {
    const isRefinement = text.includes('0.98') || text.includes('极限');
    treeInstancesMap.get('gold_006_passive_redeem_holiday').push({
      index: globalIdx,
      tree_id: 'gold_006_passive_redeem_holiday',
      tree_name: '节前基金被动减持与赎回',
      subtype: isRefinement ? 'double_bottom_098_refinement' : 'holiday_passive_redeem',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 5. gold_005: 反弹一半公式 (HOOD / TSLL 派息 / NVDL)
  if (text.includes('反弹一半') || (text.includes('/2=') && text.includes('+'))) {
    treeInstancesMap.get('gold_005_half_retrace_watch').push({
      index: globalIdx,
      tree_id: 'gold_005_half_retrace_watch',
      tree_name: '反弹一半公式空间测算',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 6. gold_001: 二次握手
  if (text.includes('二次握手') || text.includes('两次握手') || (text.includes('握手') && (text.includes('低点') || text.includes('探底')))) {
    treeInstancesMap.get('gold_001_second_handshake').push({
      index: globalIdx,
      tree_id: 'gold_001_second_handshake',
      tree_name: '二次握手不破低点低吸',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 7. 纯点位成交
  const isPureFill = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i.test(text) && text.length < 40;
  if (isPureFill) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'pure_fill_order',
      reason: '点位成交/减持口播，不进策略树',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 8. 其余弱点评与备忘
  skippedAuditLog.push({
    index: globalIdx,
    message_id: msg.id,
    et_date: etDate,
    channel: msg.channel_name,
    trigger: triggerWord,
    category: 'weak_commentary_or_single_event',
    reason: '单日事件点评或弱语义描述，未达到树节点标准',
    raw_text: text.slice(0, 150)
  });
}

// 统计
const instanceSummary = {};
for (const [tId, insts] of treeInstancesMap.entries()) {
  if (insts.length > 0) {
    const lessonObj = goldLessons.find(g => g.gold_id === tId);
    instanceSummary[tId] = {
      name: lessonObj?.name || tId,
      status: lessonObj?.status || 'proposed',
      instances_count: insts.length,
      sample_spans: insts.slice(0, 3).map(s => s.evidence_span)
    };
  }
}

const skipStats = {};
skippedAuditLog.forEach(s => skipStats[s.category] = (skipStats[s.category] || 0) + 1);

const resultData = {
  metadata: {
    segment: '第 6 档 (4001~5000 条消息) 精修定版',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_4001_5000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出精修定版第 6 档 (4001~5000 条) 时序总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] (${info.status}) ${info.name}: 挂接 ${info.instances_count} 条实战实例`);
});
