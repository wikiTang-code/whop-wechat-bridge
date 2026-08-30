import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 2 档 (501~1000 条) 时序动态账本精细化修补：规则与单票剥离 + 缺口分栏');
console.log('========================================================================================\n');

// 1. 读取 501~1000 消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 500 OFFSET 500
`).all();

// 2. 强书签正则
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|高低切|两段式|靴子|结算)/;

// 3. 继承旧账定义
const inheritedLedgerMap = {
  mech_second_handshake: { name: '二次握手不破低点低吸', keywords: ['二次握手', '两次握手'] },
  mech_decay_equivalent_calc: { name: '期权/杠杆磨损值折算上一轮价格', keywords: ['磨损值', '相当于第一轮'] },
  mech_block_print_reentry: { name: '支撑位大单入场再回买', keywords: ['大单入场', '大单检测'] },
  mech_gap_rebound_dip: { name: '跳空缺口回踩吸筹', keywords: ['缺口'] }
};

const newLedgerEntries = new Map();
const handshakeInstances = [];
const gapRuleInstances = [];
const gapPointMemos = [];
const skippedStopsAudit = [];
const seenContentSet = new Set();

let bookmarkedCount = 0;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 501 + i;
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
    skippedStopsAudit.push({
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

  // 1. 二次握手回链 (必须有明确握手短语)
  if (text.includes('二次握手') || text.includes('两次握手') || (text.includes('握手') && text.includes('探底'))) {
    handshakeInstances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // 2. 缺口精细分流：规则复述 vs 点位备忘
  if (text.includes('缺口')) {
    const isGapRule = text.includes('回踩') || text.includes('低吸') || text.includes('只做一次') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸');
    if (isGapRule) {
      gapRuleInstances.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        type: 'rule_replay',
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else {
      gapPointMemos.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        type: 'point_memo_watch',
        memo_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    }
    continue;
  }

  // 3. 减持机制严格开账：从 skip 捞回真正的教学规则
  if (text.includes('减持') && (text.includes('天') || text.includes('周期') || text.includes('支撑') || text.includes('被动') || text.includes('留现金'))) {
    const isGenericRule = text.includes('9天左右') || text.includes('天后') || text.includes('被动减持留现金');
    const newKey = 'mech_supply_unlock_duration';
    const newName = '减持天数出清周期与支撑回吸法';

    if (!newLedgerEntries.has(newKey)) {
      newLedgerEntries.set(newKey, {
        ledger_id: newKey,
        mechanism_name: newName,
        first_discovered: {
          index: globalIdx,
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          evidence_span: text.slice(0, 150),
          raw_text: text.slice(0, 250)
        },
        rule_instances: []
      });
    } else {
      newLedgerEntries.get(newKey).rule_instances.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    }
    continue;
  }

  // 4. 纯点位下单口播过滤
  const isPureFill = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i.test(text) && text.length < 40;
  if (isPureFill) {
    skippedStopsAudit.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'pure_fill_order',
      reason: '点位成交/减持口播，不属于机制课，归入 L2a fill',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // 5. 其余弱点评
  skippedStopsAudit.push({
    index: globalIdx,
    message_id: msg.id,
    et_date: etDate,
    channel: msg.channel_name,
    trigger: triggerWord,
    category: 'weak_commentary_or_single_event',
    reason: '单日事件点评或弱语义描述，不开新账',
    raw_text: text.slice(0, 150)
  });
}

// 统计 Skip
const skipStats = {};
skippedStopsAudit.forEach(s => {
  skipStats[s.category] = (skipStats[s.category] || 0) + 1;
});

const resultData = {
  metadata: {
    segment: '第 2 档 (501~1000 条消息) 精细修补版',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[499].created_at))}`,
    total_scanned: 500,
    bookmarked_stops: bookmarkedCount,
    new_ledger_entries_created: newLedgerEntries.size,
    handshake_instances_count: handshakeInstances.length,
    gap_rule_instances_count: gapRuleInstances.length,
    gap_point_memos_count: gapPointMemos.length,
    skipped_stops_total: skippedStopsAudit.length,
    skipped_breakdown: skipStats
  },
  new_ledger_entries: Array.from(newLedgerEntries.values()),
  handshake_instances: handshakeInstances,
  gap_subdivision: {
    rule_replay_instances: gapRuleInstances,
    point_memo_watch: gapPointMemos
  },
  skipped_stops_audit: skippedStopsAudit
};

const outPath = 'data/l2b/gold/zhao_ledger_501_1000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出精细修补版 501~1000 账本: ${outPath}`);
console.log(`   - 扫描消息总数: 500 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 真正开账机制: ${newLedgerEntries.size} 个 (减持天数出清周期与支撑回吸)`);
console.log(`   - 二次握手有效复述实例: ${handshakeInstances.length} 条`);
console.log(`   - 缺口精细分流: 规则复述 ${gapRuleInstances.length} 条 | 点位备忘 ${gapPointMemos.length} 条`);
console.log(`   - 全量真实 Skip 审计: ${skippedStopsAudit.length} 条\n`);

newLedgerEntries.forEach(e => {
  console.log(`📘 [${e.ledger_id}] ${e.mechanism_name}`);
  console.log(`    首发证据: "${e.first_discovered.evidence_span}"\n`);
});
