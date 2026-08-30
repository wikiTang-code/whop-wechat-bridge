import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 启动第 9 档 (7001~8000 条) 时序动态账本流水线：5-18缺口只做一次日内 + 5-20整数底部要素');
console.log('========================================================================================\n');

// 1. 读取第 7001 ~ 8000 条赵哥时序消息 (LIMIT 1000 OFFSET 7000)
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 7000
`).all();

console.log(`👤 载入 7001~8000 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[zhaoMessages.length - 1].created_at).toISOString().slice(0, 10)})\n`);

// 2. 载入受控代码本
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
const seenNodeDateMap = new Map(); // 记录 nodeId -> Set(dates) 确保所有节点同日只记 1 次

let bookmarkedCount = 0;

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|底部要素|底部几大要素|整数|小数点|电话会议|电话会|企稳反弹|企稳)/;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 7001 + i;
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

  // 通用同日挂接辅助函数（杜绝所有节点虚增）
  const tryAddInstance = (nodeId, treeName, spanText, fullText, subtype) => {
    if (!seenNodeDateMap.has(nodeId)) seenNodeDateMap.set(nodeId, new Set());
    const dateSet = seenNodeDateMap.get(nodeId);

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
        evidence_span: spanText,
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

  // 1. gold_003: 缺口每次只做一次日内 (2026-05-18 post_1CbASmAPtdCknnaHcfBcAo)
  if (text.includes('每次到缺口只做一次日内') || (text.includes('缺口') && text.includes('只做一次日内'))) {
    const span = '每次到缺口只做一次日内  跌破肯定往下继续补下面缺口';
    const actualSpan = text.includes(span) ? span : text.slice(0, 150);
    tryAddInstance('gold_003_gap_intraday_once', '缺口每次只做一次日内', actualSpan, text.slice(0, 250));
    gapSubdivision.gold_003_rule_replays.push({
      index: globalIdx,
      tree_id: 'gold_003_gap_intraday_once',
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: actualSpan,
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 2. prop_001: 底部几大要素 (急跌最低价是整数没小数点) (2026-05-20 post_1CbE4JTR7XvBrPPFqZzJZ5)
  if (text.includes('底部几大要素') || (text.includes('最低价是整数') && text.includes('小数点'))) {
    const span = '底部几大要素  缺口连续补掉上轮起涨所有的 急跌最低价是整数的没小数点 昨天 46.0 第二天最低价高于前一天46.0的';
    const actualSpan = text.includes(span) ? span : text.slice(0, 150);
    tryAddInstance('prop_001_dip_buy_integer', '急跌整数无小数点底部要素', actualSpan, text.slice(0, 250));
    continue;
  }

  // 3. prop_011: NVDA 电话会投资板块带动多空 (2026-05-21 post_1CbFr1hvfSzMc63eiEe5QS)
  if (text.includes('电话会议') || (text.includes('电话会') && text.includes('英伟达'))) {
    tryAddInstance('prop_011_earnings_call_reversal', '大盘财报电话会前后多空反转', text.slice(0, 150), text.slice(0, 250));
    continue;
  }

  // 4. prop_012: 企稳反弹底部判断 (2026-05-18 post_1CbAVWUdjvCJmcDctmxaEo)
  if (text.includes('企稳反弹了就是跌底部了') || (text.includes('每月不降低了') && text.includes('企稳反弹'))) {
    tryAddInstance('prop_012_position_leverage_ratio', '稳反弹仓位分工与做T杠杆比率', text.slice(0, 150), text.slice(0, 250));
    continue;
  }

  // 5. 缺口精细分流 (高开回踩补缺 vs 点位备忘)
  if (text.includes('缺口')) {
    if (text.includes('回踩') || text.includes('低吸') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸')) {
      const added = tryAddInstance('prop_008_gap_retrace_fill_dip', '高开回踩补缺低吸法', text.slice(0, 150), text.slice(0, 250));
      if (added) {
        gapSubdivision.prop_008_retrace_replays.push({
          index: globalIdx,
          tree_id: 'prop_008_gap_retrace_fill_dip',
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          evidence_span: text.slice(0, 150),
          raw_text: text.slice(0, 250)
        });
      }
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
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'weak_commentary_or_single_event',
        reason: '单日缺口点位备忘，未达到独立规则标准',
        raw_text: text.slice(0, 150)
      });
    }
    continue;
  }

  // 6. 纯点位成交
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

  // 7. 其余弱点评与问答
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
    segment: '第 9 档 (7001~8000 条消息)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    tree_nodes_populated_count: Object.keys(instanceSummary).length,
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
const outPath = 'data/l2b/gold/zhao_chronological_ledger_7001_8000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出第 9 档 (7001~8000 条) 树键对齐时序总账: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 命中的树节点数: ${Object.keys(instanceSummary).length} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedAuditLog.length} 条\n`);

Object.entries(instanceSummary).forEach(([tId, info]) => {
  console.log(`🌳 [${tId}] (${info.status}) ${info.name}: 挂接 ${info.instances_count} 条实战实例`);
});
