import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行 11001~12687 消息段严格精修：修正文件名/日期 + 捞回四巫日/一半死拿一半做T/二次探底');
console.log('========================================================================================\n');

// 1. 读取 11001 ~ 12687 条赵哥时序消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 2000 OFFSET 11000
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

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|财报|四巫日|一半死拿|二次探底|调仓)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 11001 + i;
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

  // 1. gold_004: 一半死拿、一半做 T / 6-7成留3成防6月底再压 (仓位细则)
  if (text.includes('一半死拿') || (text.includes('6成') && text.includes('7成') && text.includes('3成')) || (text.includes('7成') && text.includes('防'))) {
    tryAddInstance('gold_004_position_control_70_pct', '7成底仓与3成做T机动', text.slice(0, 150), text.slice(0, 250), 'half_hold_half_t_refinement');
    continue;
  }

  // 2. gold_001 & gold_003: 二次探底探缺口是基础
  if (text.includes('二次探底') && text.includes('缺口')) {
    tryAddInstance('gold_001_second_handshake', '二次握手不破低点低吸', text.slice(0, 150), text.slice(0, 250), 'double_bottom_gap_test_refinement');
    continue;
  }

  // 3. gold_006: 被动减+美联储+四巫日 (11607 尾盘先开大盘收盘常是最低 / 12114 MU调仓)
  if ((text.includes('被动减') && (text.includes('美联储') || text.includes('四巫日') || text.includes('二次探底') || text.includes('MU'))) || (text.includes('四巫日') && text.includes('收盘'))) {
    tryAddInstance('gold_006_passive_redeem_holiday', '节前基金被动减持与赎回', text.slice(0, 150), text.slice(0, 250), 'triple_event_passive_redeem_clock');
    continue;
  }

  // 4. 纯点位成交
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

  // 5. 其余弱点评与问答
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
    segment: '11001~12687 消息段 (2026-06-10 ~ 2026-06-26)',
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

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_chronological_ledger_11001_12687.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

// 清理旧命名的 11001_12124.json 防止混淆
if (fs.existsSync('data/l2b/gold/zhao_chronological_ledger_11001_12124.json')) {
  fs.unlinkSync('data/l2b/gold/zhao_chronological_ledger_11001_12124.json');
}

console.log(`========================================================================================`);
console.log(`✅ 成功输出 11001~12687 精准收官总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] (${info.status}) ${info.name}: 挂接 ${info.instances_count} 条实战实例`);
});
