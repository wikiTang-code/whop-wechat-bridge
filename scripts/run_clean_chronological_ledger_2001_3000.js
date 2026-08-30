import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 启动第 4 档 (2001~3000 条) 时序动态账本流水线：受控树代码本严格对齐 + 全量 Skip 审计');
console.log('========================================================================================\n');

// 1. 读取第 2001 ~ 3000 条赵哥时序消息 (LIMIT 1000 OFFSET 2000)
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 2000
`).all();

console.log(`👤 载入 2001~3000 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[zhaoMessages.length - 1].created_at).toISOString().slice(0, 10)})\n`);

// 2. 载入金标与 Proposed 受控代码本
const goldLessons = JSON.parse(fs.readFileSync('data/l2b/gold/l2b_gold_lessons.json', 'utf-8'));
const treeInstancesMap = new Map();
goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));

const gapSubdivision = {
  rule_replays: [],
  boundary_negative_cases: [],
  point_memos: []
};

const newLedgerCandidates = [];
const skippedAuditLog = [];
const seenContentSet = new Set();

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成死拿|3成做T|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|前四|倒数|腰斩|翻倍)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 2001 + i;
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

  // --- 严格匹配已受控树节点 ---

  // gold_004: 7/3 仓位风控 (包含 12-12 的总仓位不要超过 7 成原句)
  if (text.includes('7成') && (text.includes('3成') || text.includes('死拿') || text.includes('做T') || text.includes('总仓位不要超过') || text.includes('留做T资金'))) {
    treeInstancesMap.get('gold_004_position_control_70_pct').push({
      index: globalIdx,
      tree_id: 'gold_004_position_control_70_pct',
      tree_name: '7成底仓与3成做T机动',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // gold_005: 反弹一半公式空间测算 ((高+低)/2)
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

  // prop_002: 腰斩 50% 迎翻倍 100% 机会
  if ((text.includes('腰斩') && text.includes('50%')) || (text.includes('翻倍') && text.includes('100%'))) {
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

  // gold_006: 节前基金被动减持留现金
  if (text.includes('被动减') || (text.includes('基金被动减持') && text.includes('现金'))) {
    treeInstancesMap.get('gold_006_passive_redeem_holiday').push({
      index: globalIdx,
      tree_id: 'gold_006_passive_redeem_holiday',
      tree_name: '节前基金被动减持与赎回',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // gold_007: 靴子落地结算走普涨
  if (text.includes('靴子落地') || (text.includes('靴子') && text.includes('结算'))) {
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

  // gold_001: 二次握手
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

  // 缺口双轨分流
  if (text.includes('缺口')) {
    if (text.includes('只做一次日内') || text.includes('只做一次')) {
      treeInstancesMap.get('gold_003_gap_intraday_once').push({
        index: globalIdx,
        tree_id: 'gold_003_gap_intraday_once',
        tree_name: '缺口每次只做一次日内',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else if (text.includes('回踩') || text.includes('低吸') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸')) {
      treeInstancesMap.get('prop_008_gap_retrace_fill_dip').push({
        index: globalIdx,
        tree_id: 'prop_008_gap_retrace_fill_dip',
        tree_name: '高开回踩补缺低吸法',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
      gapSubdivision.rule_replays.push({
        index: globalIdx,
        tree_id: 'prop_008_gap_retrace_fill_dip',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else {
      gapSubdivision.point_memos.push({
        index: globalIdx,
        type: 'point_memo_watch',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        memo_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    }
    continue;
  }

  // 纯点位口播
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

  // 其余弱点评与备忘
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
  const lessonObj = goldLessons.find(g => g.gold_id === tId);
  instanceSummary[tId] = {
    name: lessonObj?.name || tId,
    status: lessonObj?.status || 'proposed',
    instances_count: insts.length,
    sample_spans: insts.slice(0, 3).map(s => s.evidence_span)
  };
}

const skipStats = {};
skippedAuditLog.forEach(s => skipStats[s.category] = (skipStats[s.category] || 0) + 1);

const resultData = {
  metadata: {
    segment: '第 4 档 (2001~3000 条消息)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    gold_003_intraday_once_count: treeInstancesMap.get('gold_003_gap_intraday_once').length,
    prop_008_retrace_fill_count: treeInstancesMap.get('prop_008_gap_retrace_fill_dip').length,
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_chronological_ledger_2001_3000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出第 4 档 (2001~3000 条) 树键对齐时序账本: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

console.log('📊 本段对已受控树节点追加实例对照表 (如实呈报 0 记录):');
Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`   • [${tId.padEnd(45)}] (${info.status}) ${info.name.padEnd(25)}: +${info.instances_count} 条`);
});
