import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

console.log('========================================================================================');
console.log('📖 启动 7~8 月增量时序动态账本流水线 (2026-07-01 ~ 2026-08-28)');
console.log('========================================================================================\n');

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

const julyTs = new Date('2026-07-01T00:00:00Z').getTime();

const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND created_at >= ?
    AND content IS NOT NULL
  ORDER BY created_at ASC
`).all(julyTs);

console.log(`👤 载入 7~8 月增量消息: ${zhaoMessages.length} 条 (起始: ${zhaoMessages.length > 0 ? new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10) : 'N/A'} -> 结束: ${zhaoMessages.length > 0 ? new Date(zhaoMessages[zhaoMessages.length - 1].created_at).toISOString().slice(0, 10) : 'N/A'})\n`);

// 载入受控代码本（严格保持 21/8 结构，不改动）
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

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|同花顺|王炸|出牌|手牌|指数低什么都不敢买|7640的极限点)/;

const additionalAugustPosts = [
  {
    id: 'post_1CeCKdpCkT1joyax4kvBgR',
    channel_name: '不用翻墙美股发布',
    sender_name: 'xiaozhaolucky',
    created_at: 1787144400000,
    content: '抄底买入各个板块明星股 就如同打牌 当你凑出同花顺和王炸 让别人无路可走'
  },
  {
    id: 'post_1CeEbZwT8wfyy3STU37dFe',
    channel_name: '不用翻墙美股发布',
    sender_name: 'xiaozhaolucky',
    created_at: 1787232000000,
    content: '当你手里就只拿着同花顺和王炸时候 基本就是躺平 之前一直防范着7700-60=7640的恐慌波动 实际上却是以不跌反涨去抗压 今天spx也是以冷门股的跌 硬性去卡到7640这个低点'
  },
  {
    id: 'post_1CeRTijPRPNANc8dQB97VY',
    channel_name: '不用翻墙美股讨论区',
    sender_name: 'xiaozhaolucky',
    created_at: 1787750400000,
    content: '增持还减持都要看 当你信息收集是全部时候 掌握最全信息检测才是稳定出牌的人 手里都是炸弹同花顺王炸让对面怎么赢'
  },
  {
    id: 'post_1CeRUdRXh7jC5Db9wo5seD',
    channel_name: '不用翻墙美股讨论区',
    sender_name: 'xiaozhaolucky',
    created_at: 1787751200000,
    content: '无论是估值低估买入法、meta 的事件低位买入法、大单检测法、散户止损单被一笔全吃之类的，当你掌握的机制越多，你的手牌更能凑出同花顺和王炸'
  },
  {
    id: 'post_1CeVMWfa7s3SwVLxrSg3X9',
    channel_name: '不用翻墙美股发布',
    sender_name: 'xiaozhaolucky',
    created_at: 1787923200000,
    content: '36.5出掉34.75剩下一半spyu 指数低什么都不敢买时候就可以买指数 指数前瞻预测知道要上去指数的杠杆是必然涨'
  },
  {
    id: 'post_1CeVM9uP2Fo3WyWmQxnLvr',
    channel_name: '不用翻墙美股发布',
    sender_name: 'xiaozhaolucky',
    created_at: 1787923500000,
    content: '7640的极限点一直是每天反复说极限点位去低吸低吸低吸 因为指数的话7700 7760 7820按60的波动值会往上波'
  },
  {
    id: 'post_1CeVTnVgH2fcvx5zHmRhJC',
    channel_name: '不用翻墙美股发布',
    sender_name: 'xiaozhaolucky',
    created_at: 1787924000000,
    content: '英伟达财报后的高点一直卖卖卖 就是为了应对杰克逊霍尔沃什的讲话 一个反弹了 后手讲话就会偏鹰让指数和盘面上下波动好让回流'
  }
];

const allCombined = [...zhaoMessages];
for (const p of additionalAugustPosts) {
  if (!allCombined.some(m => m.id === p.id)) {
    allCombined.push(p);
  }
}
allCombined.sort((a, b) => a.created_at - b.created_at);

for (let i = 0; i < allCombined.length; i++) {
  const globalIdx = 12688 + i;
  const msg = allCombined[i];
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

  // 1. post_1CeRUdRXh7jC5Db9wo5seD: 四手牌并列总纲备忘（四个手法均指向此哲学总纲，prop_003~006 保持空壳）
  if (msg.id === 'post_1CeRUdRXh7jC5Db9wo5seD' || (text.includes('估值低估买入法') && text.includes('大单检测法') && text.includes('散户止损单被一笔全吃'))) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'four_hands_philosophy_memo',
      reason: '四种手法并列总纲备忘（估值低估、事件低位、大单检测、散户止损一笔全吃），四个手法均指向此哲学总纲，prop_003~006 保持空壳待各手法独立微观操作句',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 2. 8 月打牌三帖 (8-19, 8-20, 8-26) 记为多板块龙头组合持仓结构与增减持信息备忘
  if (text.includes('同花顺') || text.includes('王炸') || text.includes('打牌')) {
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'macro_philosophy_memo',
      reason: '多板块龙头组合持仓结构 + 增减持信息收全再动打牌比喻，暂不占用 prop_003~006 四手牌空壳',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 3. gold_008: 指数低买指数杠杆 / 7640 极限点位低吸 (8-28 发布区教案)
  if (text.includes('指数低什么都不敢买时候就可以买指数') || text.includes('7640的极限点')) {
    tryAddInstance('gold_008_index_turn_gate', '入场扫描：指数转弯再看个股', text.slice(0, 150), text.slice(0, 250), 'index_extreme_low_and_leveraged_etf_refinement');
    continue;
  }

  // 4. gold_007: 杰克逊霍尔讲话防守与反弹后手 (8-28 宏观事件)
  if (text.includes('杰克逊霍尔') || (text.includes('讲话') && text.includes('后手'))) {
    tryAddInstance('gold_007_shoe_drops_settlement', '重大事件靴子落地走普涨', text.slice(0, 150), text.slice(0, 250), 'macro_speech_hawkish_dip_refinement');
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
    segment: 'incr 时序增量档 (2026-07-01 ~ 2026-08-28)',
    date_range: '2026-07-01 ~ 2026-08-28',
    total_scanned: allCombined.length,
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

const outPath = 'data/l2b/gold/zhao_chronological_ledger_incr_20260701_20260828.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出 7~8 月 incr 增量时序总账 (已升级四手牌总纲备忘): ${outPath}`);
console.log(`   - 扫描消息总数: ${allCombined.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

console.log('📊 Skip 审计分类统计:');
console.log(JSON.stringify(skipStats, null, 2));
