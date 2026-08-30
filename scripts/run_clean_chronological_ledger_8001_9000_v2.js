import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行 8001~9000 消息段严格精修：prop_001整数底本尊 + 细则吸收与剔除板块映射');
console.log('========================================================================================\n');

// 1. 读取 8001 ~ 9000 条赵哥时序消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 8000
`).all();

const goldLessons = JSON.parse(fs.readFileSync('data/l2b/gold/l2b_gold_lessons.json', 'utf-8'));
const treeInstancesMap = new Map();
goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));

const gapSubdivision = {
  gold_003_rule_replays: [],
  prop_008_retrace_replays: [],
  boundary_negative_cases: [],
  point_memos: []
};

const skippedAuditLog = [];
const seenContentSet = new Set();
const seenNodeDateMap = new Map();

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|底部要素|底部几大要素|整数|小数点|儿童节|九天被动减)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 8001 + i;
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

  // 通用挂接辅助函数
  const tryAddInstance = (nodeId, treeName, spanText, fullText, subtype) => {
    if (!seenNodeDateMap.has(nodeId)) seenNodeDateMap.set(nodeId, new Set());
    const dateSet = seenNodeDateMap.get(nodeId);

    let validSpan = spanText;
    if (!text.includes(validSpan)) {
      validSpan = text.slice(0, 120);
    }

    if (!dateSet.has(etDate)) {
      dateSet.add(etDate);
      treeInstancesMap.get(nodeId).push({
        index: globalIdx,
        tree_id: nodeId,
        tree_name: treeName,
        subtype: subtype || 'rule_replay',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: validSpan,
        raw_text: fullText
      });
      return true;
    } else {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'same_day_suffix',
        reason: `同日 (${etDate}) 节点 [${nodeId}] 规则已记账 1 次，同日多发作为当日 fill 宿主审计，不虚增规则计数`,
        raw_text: text.slice(0, 150)
      });
      return false;
    }
  };

  // 1. prop_001: 底部几大要素 (急跌最低价是整数没小数点) (2026-05-20 post_1CbE4JTR7XvBrPPFqZzJZ5)
  if (text.includes('底部几大要素') || (text.includes('最低价是整数') && text.includes('小数点')) || text.includes('三个都满足优先') || text.includes('抹平形成整数低点')) {
    const span = '底部几大要素  缺口连续补掉上轮起涨所有的 急跌最低价是整数的没小数点 昨天 46.0 第二天最低价高于前一天46.0的';
    const actualSpan = text.includes(span) ? span : text.slice(0, 150);
    tryAddInstance('prop_001_dip_buy_integer', '急跌整数无小数点底部要素', actualSpan, text.slice(0, 250), 'integer_bottom_and_gap_refinement');
    continue;
  }

  // 2. gold_006: 节前被动减 (九天被动减=急跌急涨做差价 / 最低不再破前一日 / 儿童节日历句)
  if (text.includes('九天被动减') || text.includes('儿童节') || (text.includes('被动减') && (text.includes('做差价') || text.includes('最低不再破')))) {
    tryAddInstance('gold_006_passive_redeem_holiday', '节前基金被动减持与赎回', text.slice(0, 150), text.slice(0, 250), 'passive_redeem_ndays_and_holiday');
    continue;
  }

  // 3. gold_001: 二次握手日内限定 (二次握手只是针对日内的低点 -> 范围限定备忘)
  if (text.includes('二次握手') && text.includes('针对日内的低点')) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'scope_refinement_memo',
      reason: '二次握手适用范围限定（针对日内低点），不作为新的买入实例',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 4. 英伟达电话会板块映射 (降为事件备忘，不进 prop_011)
  if (text.includes('电话会议') || (text.includes('电话会') && text.includes('英伟达'))) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'sector_mapping_memo',
      reason: '英伟达电话会投资板块联动（LITE/康宁/COHR/IREN），降为板块映射备忘，不占电话会反转节点',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 5. 纯点位成交
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

  // 6. 其余弱点评与问答
  skippedAuditLog.push({
    index: globalIdx,
    message_id: msg.id,
    et_date: etDate,
    channel: msg.channel_name,
    trigger: triggerWord,
    category: 'weak_commentary_or_single_event',
    reason: '单日讨论区问答或弱语义描述，未达到树节点标准',
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
    segment: '8001~9000 消息段 (2026-05-19 ~ 2026-05-28)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    gold_003_intraday_once_count: 0,
    prop_008_retrace_fill_count: 0,
    boundary_negative_cases_count: 0,
    point_memos_count: 0
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_8001_9000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出 8001~9000 消息段精准总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] (${info.status}) ${info.name}: 挂接 ${info.instances_count} 条实战实例`);
});
