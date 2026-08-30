import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 2 档 (501~1000 条) 时序动态账本流水线：新开账 + 链旧账 + 全量透明 Skip 审计');
console.log('========================================================================================\n');

// 1. 读取第 501 ~ 1000 条赵哥时序消息 (LIMIT 500 OFFSET 500)
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 500 OFFSET 500
`).all();

console.log(`👤 载入 501~1000 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[499].created_at).toISOString().slice(0, 10)})\n`);

// 2. 载入 1~500 档已有的 4 大基础账目 (作为跨段继承的旧账本)
const inheritedLedgerMap = {
  mech_second_handshake: { name: '二次握手不破低点低吸', keywords: ['二次握手', '两次握手', '握手'] },
  mech_decay_equivalent_calc: { name: '期权/杠杆磨损值折算上一轮价格', keywords: ['磨损值', '相当于第一轮'] },
  mech_block_print_reentry: { name: '支撑位大单入场再回买', keywords: ['大单入场', '大单检测', '大单'] },
  mech_gap_rebound_dip: { name: '跳空缺口回踩吸筹', keywords: ['缺口', '补缺口'] }
};

// 3. 强书签正则 (负责停下)
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|高低切|两段式|靴子|结算)/;

// 纯点位口播正则
const PURE_FILL_REGEX = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i;
const PROTECTED_LESSON_REGEX = /(二次握手|不破第一轮低点|缺口只做一次|磨损值|相当于第一轮|大单入场|总仓位不要超过|被动减持留现金|高低切|反弹一半|两段式)/;

const newLedgerEntries = new Map();
const linkedToOldLedger = [];
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

  // 检查是否跨频道内容完全重复
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

  // 检查是否为纯点位下单口播
  const isPureFill = PURE_FILL_REGEX.test(text) && !PROTECTED_LESSON_REGEX.test(text) && text.length < 40;
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

  // 语义分流与开账判定
  let matchedOldKey = null;
  for (const [key, def] of Object.entries(inheritedLedgerMap)) {
    if (def.keywords.some(kw => text.includes(kw))) {
      matchedOldKey = key;
      break;
    }
  }

  // A. 链到旧账
  if (matchedOldKey) {
    linkedToOldLedger.push({
      index: globalIdx,
      target_old_ledger_id: matchedOldKey,
      target_mechanism_name: inheritedLedgerMap[matchedOldKey].name,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // B. 尝试开新账 (必须是真正的战法短语)
  let newKey = null;
  let newName = null;

  if (text.includes('高低切') || text.includes('高低切换')) {
    newKey = 'mech_high_low_switch';
    newName = '高位减仓移入低位高低切';
  } else if (text.includes('反弹一半') || text.includes('/2=')) {
    newKey = 'mech_half_rebound_target';
    newName = '反弹一半空间测算与分批止盈';
  } else if (text.includes('被动减') || (text.includes('减持') && (text.includes('被动') || text.includes('留现金') || text.includes('公告')))) {
    newKey = 'mech_passive_redeem_supply';
    newName = '基金被动减持与供给释放周期';
  } else if (text.includes('两段式') || (text.includes('盘中') && text.includes('盘尾') && text.includes('开仓'))) {
    newKey = 'mech_two_stage_entry';
    newName = '大回调盘中与盘尾两段式开仓';
  } else if (text.includes('成本出') || text.includes('最后补的那笔')) {
    newKey = 'mech_cost_exit_last_batch';
    newName = '反弹先成本出最后补仓头寸';
  } else {
    // 弱语义或单日盘面点评
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
    continue;
  }

  // 记录新账
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
      instances: []
    });
  } else {
    newLedgerEntries.get(newKey).instances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
  }
}

// 4. 统计 Skip 原因分布
const skipStats = {};
skippedStopsAudit.forEach(s => {
  skipStats[s.category] = (skipStats[s.category] || 0) + 1;
});

const resultData = {
  metadata: {
    segment: '第 2 档 (501~1000 条消息)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[499].created_at))}`,
    total_scanned: 500,
    bookmarked_stops: bookmarkedCount,
    new_ledger_entries_created: newLedgerEntries.size,
    linked_to_old_ledger_count: linkedToOldLedger.length,
    skipped_stops_total: skippedStopsAudit.length,
    skipped_breakdown: skipStats
  },
  new_ledger_entries: Array.from(newLedgerEntries.values()).map(e => ({
    ledger_id: e.ledger_id,
    mechanism_name: e.mechanism_name,
    first_discovered: e.first_discovered,
    later_instances_count: e.instances.length,
    instances: e.instances
  })),
  linked_to_old_ledger_instances: linkedToOldLedger,
  skipped_stops_audit: skippedStopsAudit
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_ledger_501_1000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出 501~1000 档时序账本: ${outPath}`);
console.log(`   - 扫描消息数: 500 条`);
console.log(`   - 书签停靠数: ${bookmarkedCount} 条`);
console.log(`   - 新开核心账目: ${newLedgerEntries.size} 个 (纯净语义短语)`);
console.log(`   - 链回旧账目数: ${linkedToOldLedger.length} 条 (回链握手/缺口等)`);
console.log(`   - 全量真实 Skip 审计: ${skippedStopsAudit.length} 条\n`);

console.log('📊 Skip 停靠跳过原因真实分布:');
Object.entries(skipStats).forEach(([k, v]) => {
  console.log(`   • [${k.padEnd(35)}]: ${v} 条`);
});

console.log('\n📘 本段新开账目明细:');
newLedgerEntries.forEach(e => {
  console.log(`   * [${e.ledger_id}] ${e.mechanism_name} (首次: ${e.first_discovered.et_date} [${e.first_discovered.message_id}])`);
  console.log(`     证据: "${e.first_discovered.evidence_span}"\n`);
});
