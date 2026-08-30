import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 8 档 (6001~7000 条) 严格精修：握手图注降备忘 + 树增量如实记 0 + 细则分流');
console.log('========================================================================================\n');

// 1. 读取第 6001 ~ 7000 条赵哥时序消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 6000
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
let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|主动规避|躲月末|就近原则|就近)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 6001 + i;
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

  // 1. 二次握手图注 (post_1CayBCYC2ndSCnGhEpBvbi) -> 降为配图说明备忘，不进 gold_001
  if (text.includes('二次握手') && (text.includes('图') || text.includes('比较精确'))) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'image_caption_memo',
      reason: '二次握手配图说明（非不破低点低吸操作规则复述），降为图注备忘',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 2. gold_006: 节前被动减与日历算法细则 (节日被动减才会买多 / 三四五主动规避 / 节后叠月末多等一周)
  if (text.includes('节日被动减才会买多') || text.includes('主动规避回调') || (text.includes('节后') && text.includes('月末减持'))) {
    treeInstancesMap.get('gold_006_passive_redeem_holiday').push({
      index: globalIdx,
      tree_id: 'gold_006_passive_redeem_holiday',
      tree_name: '节前基金被动减持与赎回',
      subtype: 'passive_redeem_calendar_refinement',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 3. 缺口精细分流 (分批缺口做日内为主 -> 靠 gold_003 细则备忘)
  if (text.includes('缺口')) {
    gapSubdivision.point_memos.push({
      index: globalIdx,
      type: 'point_memo_watch',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      memo_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'weak_commentary_or_single_event',
      reason: '单日缺口讨论或点位备忘，未达到独立规则标准',
      raw_text: text.slice(0, 150)
    });
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

  // 5. 其余弱点评
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
    segment: '第 8 档 (6001~7000 条消息) 精修定版',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.values(instanceSummary).filter(x => x.instances_count > 0).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

const outPath = 'data/l2b/gold/zhao_chronological_ledger_6001_7000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出精修定版第 8 档 (6001~7000 条) 时序总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.values(instanceSummary).filter(x => x.instances_count > 0).length} 个 (严格如实记 0)`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条 (weak: ${skipStats.weak_commentary_or_single_event || 0}, pure_fill: ${skipStats.pure_fill_order || 0}, dup: ${skipStats.duplicate_post || 0}, image_caption: ${skipStats.image_caption_memo || 0})\n`);
