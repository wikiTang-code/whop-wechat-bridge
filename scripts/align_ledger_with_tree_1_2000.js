import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🏛️ 执行 1~2000 条消息时序动态账本与标签树精准对齐（同日多发合并）');
console.log('========================================================================================\n');

const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 2000
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

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|前四|倒数)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = i + 1;
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

  // 1. prop_007: 夜盘普跌盘前干预买入法
  if (text.includes('夜盘') && text.includes('买入法') && (text.includes('干预') || text.includes('普跌'))) {
    treeInstancesMap.get('prop_007_night_plunge_premarket_intervention').push({
      index: globalIdx,
      tree_id: 'prop_007_night_plunge_premarket_intervention',
      tree_name: '夜盘普跌盘前干预买入法',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 2. prop_009: 磨损值折算
  if (text.includes('磨损值') || (text.includes('相当于') && text.includes('第一轮'))) {
    treeInstancesMap.get('prop_009_decay_equivalent_calc').push({
      index: globalIdx,
      tree_id: 'prop_009_decay_equivalent_calc',
      tree_name: '期权/杠杆磨损值折算上一轮价格',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 3. gold_008b: 支撑位大单入场再回买
  if (text.includes('大单入场') || text.includes('大单检测') || (text.includes('大单') && text.includes('回买'))) {
    treeInstancesMap.get('gold_008b_block_print_reentry').push({
      index: globalIdx,
      tree_id: 'gold_008b_block_print_reentry',
      tree_name: '支撑位大单入场再回买',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 4. prop_010: 减持约 9 天靠近支撑回吸
  if (text.includes('减持') && (text.includes('9天左右') || text.includes('天左右') || text.includes('接近支撑可以回吸'))) {
    treeInstancesMap.get('prop_010_supply_unlock_ndays_dip').push({
      index: globalIdx,
      tree_id: 'prop_010_supply_unlock_ndays_dip',
      tree_name: '减持过一段天数靠近支撑回吸',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 5. gold_013: 减持 3+1 天
  if (text.includes('减持') && (text.includes('3天后第4天') || text.includes('3天'))) {
    treeInstancesMap.get('gold_013_supply_unlock_3_plus_1').push({
      index: globalIdx,
      tree_id: 'gold_013_supply_unlock_3_plus_1',
      tree_name: '减持3天后第4天看',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 6. gold_004: 7/3 仓位风控 (同日去重)
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

  // 7. gold_001: 二次握手
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

  // 8. gold_009: 成本出最后补仓
  if (text.includes('成本出') && text.includes('最后补的那笔')) {
    treeInstancesMap.get('gold_009_cost_exit_last_batch').push({
      index: globalIdx,
      tree_id: 'gold_009_cost_exit_last_batch',
      tree_name: '分批只减最后补的一笔成本出',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 9. 缺口精细分流
  if (text.includes('缺口')) {
    if (text.includes('没有回踩缺口一说') || text.includes('指数没有回踩缺口')) {
      gapSubdivision.boundary_negative_cases.push({
        index: globalIdx,
        type: 'negative_boundary_case',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        memo_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else if (text.includes('只做一次日内') || text.includes('只做一次')) {
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

  // 10. 口播成交
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

  // 11. 其余弱点评与备忘
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
    dataset: '赵哥前 2000 条消息 (树键精准对齐与分流版)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[1999].created_at))}`,
    total_scanned: 2000,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    gold_003_intraday_once_count: treeInstancesMap.get('gold_003_gap_intraday_once').length,
    prop_008_retrace_fill_count: treeInstancesMap.get('prop_008_gap_retrace_fill_dip').length,
    boundary_negative_cases_count: gapSubdivision.boundary_negative_cases.length,
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_1_2000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');
console.log(`✅ 成功输出 1~2000 档无虚增总账: ${outPath}\n`);
