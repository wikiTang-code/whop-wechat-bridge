import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行严格整改版：前 500 条时序动态账本流水线 (四门过关校验 + 停靠跳过清单审计)');
console.log('========================================================================================\n');

// 1. 读取前 500 条消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 500
`).all();

// 2. 强书签正则 (只负责停下)
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|总仓位不要超过|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值)/;

// 纯跟单口播正则 (门槛 2：含成交动词的点位减持/出掉直接剔除)
const PURE_FILL_REGEX = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i;
const PROTECTED_LESSON_REGEX = /(二次握手|不破第一轮低点|缺口只做一次|磨损值|相当于第一轮|大单入场|总仓位不要超过|被动减持留现金)/;

// 3. 动态账本结构
const ledger = new Map();
const skippedStopsAudit = []; // 门槛 4: 停了但不开账的清单
const seenContentSet = new Set(); // 门槛 3: 跨频道内容去重

let bookmarkedCount = 0;
let validLessonCount = 0;

for (let i = 0; i < zhaoMessages.length; i++) {
  const msg = zhaoMessages[i];
  let text = msg.content || '';
  text = text.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
  if (text.length < 8) continue;

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

  // 门槛 2：纯点位减仓/出货口播，且无教学硬锚，直接归入跳过清单
  const isPureFill = PURE_FILL_REGEX.test(text) && !PROTECTED_LESSON_REGEX.test(text) && text.length < 35;
  if (isPureFill) {
    skippedStopsAudit.push({
      index: i + 1,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      reason: 'pure_fill_order (点位减仓/买卖口播，不进机制账)',
      raw_text: text
    });
    continue;
  }

  // 门槛 3：跨频道内容完全重复去重
  const contentKey = text.replace(/\s+/g, '');
  const isDuplicate = seenContentSet.has(contentKey);
  seenContentSet.add(contentKey);

  // 门槛 1：提炼真正的【语义战法短语】，严禁使用单字做机制名
  let mechanismName = null;
  let ledgerKey = null;

  if (text.includes('二次握手') || (text.includes('握手') && text.includes('低点'))) {
    ledgerKey = 'mech_second_handshake';
    mechanismName = '二次握手不破低点低吸';
  } else if (text.includes('磨损值') || (text.includes('相当于') && text.includes('第一轮'))) {
    ledgerKey = 'mech_decay_equivalent_calc';
    mechanismName = '期权/杠杆磨损值折算上一轮价格';
  } else if (text.includes('大单入场') || text.includes('大单检测')) {
    ledgerKey = 'mech_block_print_reentry';
    mechanismName = '支撑位大单入场再回买';
  } else if (text.includes('缺口') && (text.includes('回吸') || text.includes('补'))) {
    ledgerKey = 'mech_gap_rebound_dip';
    mechanismName = '跳空缺口回踩吸筹';
  } else if (text.includes('被动减') || (text.includes('减持') && (text.includes('公告') || text.includes('被动') || text.includes('留现金')))) {
    ledgerKey = 'mech_passive_redeem_supply';
    mechanismName = '基金被动减持与公告供给释放';
  } else {
    // 停了但属于弱语义/日常点评，不盲目开账
    skippedStopsAudit.push({
      index: i + 1,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      reason: 'weak_semantics_or_market_commentary (弱语义或单日盘面点评，不开新账)',
      raw_text: text
    });
    continue;
  }

  validLessonCount++;

  // 提取核心 span
  const matchIdx = text.indexOf(triggerWord);
  const start = Math.max(0, matchIdx - 15);
  const end = Math.min(text.length, matchIdx + triggerWord.length + 45);
  const localSpan = text.substring(start, end).replace(/\n+/g, ' ').trim();

  if (!ledger.has(ledgerKey)) {
    // 首次入账
    ledger.set(ledgerKey, {
      ledger_id: ledgerKey,
      mechanism_name: mechanismName,
      first_discovered: {
        index: i + 1,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: localSpan,
        raw_text: text.slice(0, 200).replace(/\n+/g, ' ')
      },
      instances: []
    });
  } else {
    // 追加实例 (若跨频道重复则不重复追加)
    if (!isDuplicate) {
      const entry = ledger.get(ledgerKey);
      entry.instances.push({
        index: i + 1,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: localSpan,
        raw_text: text.slice(0, 200).replace(/\n+/g, ' ')
      });
    }
  }
}

// 4. 格式化账本输出
const formattedLedger = Array.from(ledger.values()).map(entry => ({
  ledger_id: entry.ledger_id,
  mechanism_name: entry.mechanism_name,
  first_date: entry.first_discovered.et_date,
  first_message_id: entry.first_discovered.message_id,
  first_evidence: entry.first_discovered.evidence_span,
  total_distinct_instances: 1 + entry.instances.length,
  instances: entry.instances
}));

const resultData = {
  metadata: {
    dataset: '赵哥时序前 500 条消息 (2025-10-06 ~ 2025-10-17)',
    total_scanned: 500,
    bookmarked_stops: bookmarkedCount,
    valid_mechanism_entries: ledger.size,
    valid_lessons_count: validLessonCount,
    skipped_stops_count: skippedStopsAudit.length
  },
  clean_ledger: formattedLedger,
  skipped_stops_audit: skippedStopsAudit
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_ledger_v0_500_clean.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出严格整改版前 500 条账本: ${outPath}`);
console.log(`   - 扫描消息总数: 500 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 严格入账机制: ${ledger.size} 个 (纯净战法短语)`);
console.log(`   - 停靠但跳过审计清单: ${skippedStopsAudit.length} 条 (全量透明记录)\n`);

formattedLedger.forEach(l => {
  console.log(`📘 [${l.ledger_id}] ${l.mechanism_name}`);
  console.log(`    首次提出: (${l.first_date}) [${l.first_message_id}]`);
  console.log(`    首发证据: "${l.first_evidence}"`);
  console.log(`    后续独立实例: ${l.total_distinct_instances - 1} 个\n`);
});
