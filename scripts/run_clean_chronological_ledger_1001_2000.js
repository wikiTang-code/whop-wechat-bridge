import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 启动第 3 档 (1001~2000 条) 时序动态账本流水线：回链 5 大旧账 + 抽象新账审定 + 全量 Skip 审计');
console.log('========================================================================================\n');

// 1. 读取第 1001 ~ 2000 条赵哥时序消息 (LIMIT 1000 OFFSET 1000)
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1000 OFFSET 1000
`).all();

console.log(`👤 载入 1001~2000 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[zhaoMessages.length - 1].created_at).toISOString().slice(0, 10)})\n`);

// 2. 5 大已核准旧账本白名单
const INHERITED_LEDGER = {
  mech_second_handshake: { name: '二次握手不破低点低吸', instances: [] },
  mech_decay_equivalent_calc: { name: '期权/杠杆磨损值折算上一轮价格', instances: [] },
  mech_block_print_reentry: { name: '支撑位大单入场再回买', instances: [] },
  mech_gap_rebound_dip: { name: '跳空缺口回踩吸筹', rule_instances: [], point_memos: [] },
  mech_supply_unlock_ndays: { name: '减持过一段天数、靠近支撑再回吸', instances: [] }
};

// 3. 强书签正则 (停靠点)
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|高低切|两段式|靴子|结算|利润垫)/;

const newLedgerEntries = new Map();
const skippedStopsAudit = [];
const seenContentSet = new Set();

let bookmarkedCount = 0;

for (let i = 0; i < zhaoMessages.length; i++) {
  const globalIdx = 1001 + i;
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

  // 跨频道内容完全去重
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

  // A. 回链旧账 1: 二次握手
  if (text.includes('二次握手') || text.includes('两次握手') || (text.includes('握手') && text.includes('探底'))) {
    INHERITED_LEDGER.mech_second_handshake.instances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // A. 回链旧账 2: 磨损值折算
  if (text.includes('磨损值') || (text.includes('相当于') && text.includes('第一轮'))) {
    INHERITED_LEDGER.mech_decay_equivalent_calc.instances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // A. 回链旧账 3: 大单入场/回买
  if (text.includes('大单入场') || text.includes('大单检测') || (text.includes('大单') && text.includes('回买'))) {
    INHERITED_LEDGER.mech_block_print_reentry.instances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // A. 回链旧账 4: 缺口双轨分流 (规则复述 vs 点位备忘)
  if (text.includes('缺口')) {
    const isGapRule = text.includes('回踩') || text.includes('低吸') || text.includes('只做一次') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸');
    if (isGapRule) {
      INHERITED_LEDGER.mech_gap_rebound_dip.rule_instances.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        type: 'rule_replay',
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      });
    } else {
      INHERITED_LEDGER.mech_gap_rebound_dip.point_memos.push({
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

  // A. 回链旧账 5: 减持天数靠近支撑回吸 (含 3+1 天与天数规律)
  if (text.includes('减持') && (text.includes('天后') || text.includes('天左右') || text.includes('被动减持留现金') || text.includes('持续减持到横盘'))) {
    INHERITED_LEDGER.mech_supply_unlock_ndays.instances.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: text.slice(0, 150),
      raw_text: text.slice(0, 250)
    });
    continue;
  }

  // B. 尝试开新账 (必须是可脱离单票复述的通用规则整句)
  let newKey = null;
  let newName = null;

  if (text.includes('没利润垫') && (text.includes('财报') || text.includes('博弈'))) {
    newKey = 'mech_profit_cushion_earnings';
    newName = '无利润垫严禁重仓博弈财报';
  } else if (text.includes('成本出') && (text.includes('最后补') || text.includes('分批'))) {
    newKey = 'mech_cost_exit_last_batch';
    newName = '反弹先成本出最后补仓头寸';
  } else if (text.includes('急跌筹码便宜') && text.includes('量化')) {
    newKey = 'mech_quant_v_plunge_rebound';
    newName = '急跌两天筹码便宜量化夜盘V吸筹';
  }

  if (newKey) {
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
    continue;
  }

  // C. 纯点位口播与日常仓位操作过滤
  const isPureFillOrPositionRhythm = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半)|主要减持为主|配置点)/i.test(text) && text.length < 40;
  if (isPureFillOrPositionRhythm) {
    skippedStopsAudit.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'pure_fill_or_single_ticker_memo',
      reason: '单票买卖减持口播或点位计划，不作为通用战法规则',
      raw_text: text.slice(0, 150)
    });
    continue;
  }

  // D. 其余单日点评与弱语义
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
    segment: '第 3 档 (1001~2000 条消息)',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
    total_scanned: zhaoMessages.length,
    bookmarked_stops: bookmarkedCount,
    new_ledger_entries_created: newLedgerEntries.size,
    skipped_stops_total: skippedStopsAudit.length,
    skipped_breakdown: skipStats
  },
  inherited_ledger_instance_counts: {
    mech_second_handshake: INHERITED_LEDGER.mech_second_handshake.instances.length,
    mech_decay_equivalent_calc: INHERITED_LEDGER.mech_decay_equivalent_calc.instances.length,
    mech_block_print_reentry: INHERITED_LEDGER.mech_block_print_reentry.instances.length,
    mech_gap_rebound_dip: {
      rule_replays: INHERITED_LEDGER.mech_gap_rebound_dip.rule_instances.length,
      point_memos: INHERITED_LEDGER.mech_gap_rebound_dip.point_memos.length
    },
    mech_supply_unlock_ndays: INHERITED_LEDGER.mech_supply_unlock_ndays.instances.length
  },
  new_ledger_entries: Array.from(newLedgerEntries.values()),
  inherited_ledger_instances: {
    mech_second_handshake: INHERITED_LEDGER.mech_second_handshake.instances,
    mech_decay_equivalent_calc: INHERITED_LEDGER.mech_decay_equivalent_calc.instances,
    mech_block_print_reentry: INHERITED_LEDGER.mech_block_print_reentry.instances,
    mech_gap_rebound_dip: INHERITED_LEDGER.mech_gap_rebound_dip,
    mech_supply_unlock_ndays: INHERITED_LEDGER.mech_supply_unlock_ndays.instances
  },
  skipped_stops_audit: skippedStopsAudit
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_ledger_1001_2000.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出第 3 档 (1001~2000 条) 时序账本: ${outPath}`);
console.log(`   - 扫描消息总数: ${zhaoMessages.length} 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 新开核心账目: ${newLedgerEntries.size} 个`);
console.log(`   - 全量真实 Skip 审计: ${skippedStopsAudit.length} 条\n`);

console.log('📊 5 大旧账本段追加实例对照表:');
console.log(`   • [mech_second_handshake     ] 二次握手不破低点低吸: ${INHERITED_LEDGER.mech_second_handshake.instances.length} 条`);
console.log(`   • [mech_decay_equivalent_calc ] 期权磨损值折算上一轮: ${INHERITED_LEDGER.mech_decay_equivalent_calc.instances.length} 条`);
console.log(`   • [mech_block_print_reentry   ] 支撑位大单入场再回买: ${INHERITED_LEDGER.mech_block_print_reentry.instances.length} 条`);
console.log(`   • [mech_gap_rebound_dip       ] 跳空缺口 (规则 ${INHERITED_LEDGER.mech_gap_rebound_dip.rule_instances.length} 条 | 备忘 ${INHERITED_LEDGER.mech_gap_rebound_dip.point_memos.length} 条)`);
console.log(`   • [mech_supply_unlock_ndays   ] 减持过一段天数支撑回吸: ${INHERITED_LEDGER.mech_supply_unlock_ndays.instances.length} 条\n`);

console.log('📘 本段新开账目明细:');
newLedgerEntries.forEach(e => {
  console.log(`   * [${e.ledger_id}] ${e.mechanism_name} (首次: ${e.first_discovered.et_date} [${e.first_discovered.message_id}])`);
  console.log(`     证据: "${e.first_discovered.evidence_span}"\n`);
});
