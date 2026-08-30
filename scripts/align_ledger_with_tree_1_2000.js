import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🏛️ 执行 1~2000 条消息时序动态账本与标签树 (Tree ID) 深度融合与标准化');
console.log('========================================================================================\n');

// 1. 读取前 2000 条赵哥时序消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 2000
`).all();

console.log(`👤 载入 1~2000 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[1999].created_at).toISOString().slice(0, 10)})\n`);

// 2. 载入金标树作为唯一受控代码本 (Codebook)
const goldLessonsPath = 'data/l2b/gold/l2b_gold_lessons.json';
const goldLessons = JSON.parse(fs.readFileSync(goldLessonsPath, 'utf-8'));
const treeCodebook = new Map();
goldLessons.forEach(g => {
  treeCodebook.set(g.gold_id, g);
});

// 补充 A 类新点名“法”候选
const A_CLASS_NEW_METHODS = [
  {
    tree_id: 'prop_007_night_plunge_premarket_intervention',
    name: '夜盘普跌盘前干预买入法',
    status: 'proposed',
    statement: '夜盘普跌遇政策/资金干预，盘前低吸买入法。'
  }
];
A_CLASS_NEW_METHODS.forEach(m => treeCodebook.set(m.tree_id, m));

// 3. 强书签正则 (停靠点)
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|7成死拿|3成做T|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|前四|倒数)/;

const treeInstancesMap = new Map();
goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));
A_CLASS_NEW_METHODS.forEach(m => treeInstancesMap.set(m.tree_id, []));

const gapSubdivision = {
  rule_replays: [],
  boundary_negative_cases: [], // 如“指数没有回踩缺口一说”
  point_memos: []
};

const skippedAuditLog = [];
const seenContentSet = new Set();

let bookmarkedCount = 0;

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

  // 跨频道完全重复去重
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

  // --- 严格匹配树节点 (Tree ID) ---

  // 1. gold_004: 7/3 仓位风控 (包含“维持7成死拿3成做T”)
  if (text.includes('7成') && (text.includes('3成') || text.includes('死拿') || text.includes('做T') || text.includes('总仓位不要超过'))) {
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

  // 2. gold_001: 二次握手 (含上下0.2%操作细则)
  if (text.includes('二次握手') || text.includes('两次握手') || (text.includes('握手') && (text.includes('低点') || text.includes('探底')))) {
    const isRefinement = text.includes('0.2%') || text.includes('细则') || text.includes('失败');
    treeInstancesMap.get('gold_001_second_handshake').push({
      index: globalIdx,
      tree_id: 'gold_001_second_handshake',
      tree_name: '二次握手不破低点低吸',
      instance_subtype: isRefinement ? 'operational_refinement' : 'rule_instantiation',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 3. gold_009: 分批成本出最后补仓
  if (text.includes('成本出') || (text.includes('只减') && text.includes('最后补的那笔'))) {
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

  // 4. gold_013: 减持 3+1 天窗口
  if (text.includes('减持') && (text.includes('3天后第4天') || text.includes('3天') || text.includes('持续减持到横盘'))) {
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

  // 5. 缺口精细分流 (含限定反例)
  if (text.includes('缺口')) {
    if (text.includes('没有回踩缺口一说') || text.includes('指数没有回踩缺口')) {
      gapSubdivision.boundary_negative_cases.push({
        index: globalIdx,
        tree_id: 'gold_003_gap_intraday_once',
        subtype: 'negative_boundary_case',
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else if (text.includes('回踩') || text.includes('低吸') || text.includes('只做一次') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸')) {
      gapSubdivision.rule_replays.push({
        index: globalIdx,
        tree_id: 'gold_003_gap_intraday_once',
        subtype: 'rule_replay',
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

  // 6. 新点名“法”：夜盘普跌盘前干预买入法
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

  // 7. gold_012: 利润垫
  if (text.includes('利润垫') && (text.includes('财报') || text.includes('博弈') || text.includes('回撤'))) {
    treeInstancesMap.get('gold_012_profit_cushion').push({
      index: globalIdx,
      tree_id: 'gold_012_profit_cushion',
      tree_name: '没利润垫不过财报',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 8. 纯口播成交
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
    instanceSummary[tId] = {
      name: treeCodebook.get(tId)?.name || tId,
      instances_count: insts.length,
      sample_spans: insts.slice(0, 3).map(s => s.evidence_span)
    };
  }
}

const skipStats = {};
skippedAuditLog.forEach(s => skipStats[s.category] = (skipStats[s.category] || 0) + 1);

const resultData = {
  metadata: {
    dataset: '赵哥全量前 2000 条消息 (1~2000 档树键深度融合版)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[1999].created_at))}`,
    total_scanned: 2000,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
    skipped_stops_total: skippedAuditLog.length,
    skipped_breakdown: skipStats
  },
  tree_instances_summary: instanceSummary,
  gap_subdivision_summary: {
    rule_replays_count: gapSubdivision.rule_replays.length,
    boundary_negative_cases_count: gapSubdivision.boundary_negative_cases.length,
    point_memos_count: gapSubdivision.point_memos.length
  },
  tree_instances_detail: Object.fromEntries(treeInstancesMap),
  gap_subdivision: gapSubdivision,
  skipped_audit_log: skippedAuditLog
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_chronological_ledger_1_2000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出 1~2000 档与标签树深度融合的时序总账本: ${outPath}`);
console.log(`   - 扫描消息总数: 2000 条`);
console.log(`   - 书签停靠分析数: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 缺口精细分流: 规则复述 ${gapSubdivision.rule_replays.length} 条 | 反例限定 ${gapSubdivision.boundary_negative_cases.length} 条 | 点位备忘 ${gapSubdivision.point_memos.length} 条`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] ${info.name}: 累计挂接 ${info.instances_count} 条实战实例`);
});
