import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 5 档 (3001~4000 条) 精修：打油诗总纲 + 节前被动减10%与1.5倍回流 + MSCI错杀');
console.log('========================================================================================\n');

// 1. 读取第 3001 ~ 4000 条消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 3000
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
const seenPoemDays = new Set();

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|首阴|首阳|MSCI|低吸三种|0DTE|1.5倍)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 3001 + i;
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

  // 1. gold_011: 赵哥打油诗官方原帖 (2026-01-04 post_1CWoRBJvkuBQgdN2Cq7Mci)
  if (text.includes('普跌同沉不用慌') || (text.includes('口诀') && text.includes('白话文') && text.includes('普涨我跌'))) {
    if (!seenPoemDays.has(etDate)) {
      seenPoemDays.add(etDate);
      treeInstancesMap.get('gold_011_zhao_poem_official').push({
        index: globalIdx,
        tree_id: 'gold_011_zhao_poem_official',
        tree_name: '赵哥主观交易总诀 (打油诗全文本尊)',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 350)
      });
    } else {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'daily_duplicate_poem',
        reason: '同日打油诗官方帖已完整收录，不重复计账',
        raw_text: text.slice(0, 150)
      });
    }
    continue;
  }

  // 2. prop_013: 低吸三大模式 (支撑/元旦前缺口/双底)
  if (text.includes('低吸') && text.includes('支撑') && text.includes('缺口') && text.includes('双底')) {
    treeInstancesMap.get('prop_013_three_dip_types_selection').push({
      index: globalIdx,
      tree_id: 'prop_013_three_dip_types_selection',
      tree_name: '低吸三大模式：支撑位/节前缺口/双底形态',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 3. prop_014: MSCI 剔除被动清仓与同板块非成分股错杀低吸
  if (text.includes('MSCI') || (text.includes('被动清仓') && text.includes('非成分股'))) {
    treeInstancesMap.get('prop_014_msci_exclusion_sector_sympathy_dip').push({
      index: globalIdx,
      tree_id: 'prop_014_msci_exclusion_sector_sympathy_dip',
      tree_name: 'MSCI剔除被动清仓与同板块非成分股错杀低吸',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 4. prop_015: 跨交易时段节奏与 0DTE 尾盘配合
  if ((text.includes('0DTE') && text.includes('尾盘')) || (text.includes('收盘附近吸') && text.includes('夜盘/盘前短出'))) {
    treeInstancesMap.get('prop_015_intraday_session_rhythm_0dte').push({
      index: globalIdx,
      tree_id: 'prop_015_intraday_session_rhythm_0dte',
      tree_name: '跨交易时段节奏与0DTE尾盘配合',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 5. gold_006: 节前被动减 (含一年10个节前被动减、10%比例与1.5倍回流细则)
  if (text.includes('节前被动减') || (text.includes('被动减') && (text.includes('10%') || text.includes('1.5倍') || text.includes('留现金')))) {
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

  // 6. gold_007: 靴子落地 (严格只收宏观通用规则，单票利空降为备忘)
  if (text.includes('靴子落地') || (text.includes('日本加息') && text.includes('结算') && text.includes('普涨'))) {
    if (text.includes('tsll') || text.includes('特斯拉') || text.includes('销量')) {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'single_ticker_event_memo',
        reason: 'TSLL单票利空销量靴子落地，作为个股事件备忘，不进宏观通用规则',
        raw_text: text.slice(0, 150)
      });
    } else {
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
    }
    continue;
  }

  // 7. prop_008: 缺口回踩低吸 (只收“补完缺口没怎么跌的布局节后”，单票与口播降备忘)
  if (text.includes('缺口')) {
    if (text.includes('补完缺口') && (text.includes('布局') || text.includes('没怎么跌'))) {
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

  // 8. 纯点位成交
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

  // 9. 其余弱点评
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
    segment: '第 5 档 (3001~4000 条消息) 精修定版',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    prop_008_retrace_fill_count: treeInstancesMap.get('prop_008_gap_retrace_fill_dip').length,
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_3001_4000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出精修定版第 5 档 (3001~4000 条) 时序总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] (${info.status}) ${info.name}: 挂接 ${info.instances_count} 条实战实例`);
});
