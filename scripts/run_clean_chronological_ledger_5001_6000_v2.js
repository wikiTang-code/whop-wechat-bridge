import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 7 档 (5001~6000 条) 严格精修（确保无 Skip 污染）');
console.log('========================================================================================\n');

const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 5000
`).all();

const goldLessons = JSON.parse(fs.readFileSync('data/l2b/gold/l2b_gold_lessons.json', 'utf-8'));
const treeInstancesMap = new Map();
goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));

const gapSubdivision = {
  rule_replays: [],
  boundary_negative_cases: [],
  point_memos: []
};

const skippedAuditLog = [];
const seenContentSet = new Set();
const seen70PctDays = new Set();

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|转弯|指数门|QQQ等转弯|到处找新闻|看到点位看转弯|3–3:30|3点强平)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 5001 + i;
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

  // 1. prop_017: 盘口转弯优先于新闻小作文 (优先匹配主频道)
  if (text.includes('到处找新闻') || text.includes('看到点位看转弯')) {
    treeInstancesMap.get('prop_017_price_level_turn_over_news').push({
      index: globalIdx,
      tree_id: 'prop_017_price_level_turn_over_news',
      tree_name: '盘口转弯优先于新闻小作文纪律',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue; // 必须直接 continue 绝不进 skip
  }

  // 2. prop_015: 跨时段操作 (3~3:30 V买、盘后 4~4:15 卖)
  if (text.includes('3–3:30') || (text.includes('3点') && text.includes('盘后') && text.includes('卖'))) {
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
    continue; // 必须直接 continue
  }

  // 3. gold_008: 入场扫描：指数转弯再看个股 (post_1CaFCe6NUnN9AtgCH4nh93)
  if (text.includes('QQQ等转弯往上再看科技股') || (text.includes('QQQ') && text.includes('转弯往上') && text.includes('回吸'))) {
    treeInstancesMap.get('gold_008_index_turn_gate').push({
      index: globalIdx,
      tree_id: 'gold_008_index_turn_gate',
      tree_name: '入场扫描：指数转弯再看个股',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue; // 必须直接 continue
  }

  // 4. gold_006: 节前被动减 (包含操作时钟 + 5天规避/3天被动减/先加密后科技 核心规则)
  if (text.includes('被动减') || text.includes('节前前5天') || (text.includes('劳动节') && text.includes('科技')) || (text.includes('大陆') && text.includes('被动减')) || text.includes('韩国指数') || text.includes('韩指') || text.includes('3点强平')) {
    const isCoreRule = text.includes('夜盘出一半') || text.includes('韩指') || text.includes('3点强平') || text.includes('前5天') || text.includes('先加密') || text.includes('分三天回踩') || text.includes('韩国指数');
    if (isCoreRule) {
      treeInstancesMap.get('gold_006_passive_redeem_holiday').push({
        index: globalIdx,
        tree_id: 'gold_006_passive_redeem_holiday',
        tree_name: '节前基金被动减持与赎回',
        subtype: 'passive_redeem_clock_and_calendar_rules',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
      continue; // 核心规则挂入后直接 continue，绝不进 skip
    } else {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'single_ticker_memo',
        reason: '个股劳动节点位备忘，不作为通用机制规则',
        raw_text: text.slice(0, 150)
      });
      continue;
    }
  }

  // 5. gold_004: 7/3 仓位风控
  if (text.includes('7成') && (text.includes('3成') || text.includes('死拿') || text.includes('做T') || text.includes('总仓位不要超过'))) {
    if (!seen70PctDays.has(etDate)) {
      seen70PctDays.add(etDate);
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
    } else {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'daily_duplicate_rule_footer',
        reason: `同日 (${etDate}) 7成总仓位规则已计账 1 次，不虚增规则计数`,
        raw_text: text.slice(0, 150)
      });
    }
    continue;
  }

  // 6. 缺口精细分流
  if (text.includes('缺口')) {
    if (text.includes('不会回补') || text.includes('最多摸上沿')) {
      gapSubdivision.boundary_negative_cases.push({
        index: globalIdx,
        type: 'negative_boundary_case',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        memo_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else if (text.includes('普涨隔天回踩') || text.includes('每天小幅回补') || text.includes('分三次回买') || (text.includes('回踩缺口') && text.includes('下沿'))) {
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

  // 8. 其余弱点评
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
    segment: '第 7 档 (5001~6000 条消息) 严密对账精修版',
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
    boundary_negative_cases_count: gapSubdivision.boundary_negative_cases.length,
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_5001_6000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');
console.log(`✅ 成功输出第 7 档无残留精修总账: ${outPath}\n`);
