import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 执行第 2 档 (501~1000 条) 供给减持账极致纯化：精确首发证据 + 彻底剔除杂质');
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

// 3. 干净回链容器
const handshakeInstances = [];
const gapRuleInstances = [];
const gapPointMemos = [];
const skippedStopsAudit = [];
const seenContentSet = new Set();

let supplyUnlockEntry = null;
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

  // 3. 供给减持机制严格开账：首发证据必须是“减持约9天接近支撑回吸”
  if (text.includes('减持') && (text.includes('9天左右') || text.includes('天左右') || text.includes('接近支撑可以回吸'))) {
    supplyUnlockEntry = {
      ledger_id: 'mech_supply_unlock_ndays',
      mechanism_name: '减持约9天接近支撑再回吸',
      first_discovered: {
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        evidence_span: text.slice(0, 150),
        raw_text: text.slice(0, 250)
      },
      instances: []
    };
    continue;
  }

  // 4. 纯点位下单口播过滤 (含“今天盘中反弹主要减持为主/前妻减持”)
  const isPureFillOrPositionRhythm = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半)|主要减持为主|前妻减持|配置点)/i.test(text);
  if (isPureFillOrPositionRhythm) {
    skippedStopsAudit.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'pure_fill_or_single_ticker_memo',
      reason: '单票减持备忘、日常仓位减持口播或单票配置计划，不作为通用机制规则',
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
    segment: '第 2 档 (501~1000 条消息) 精细修补版 v2.1',
    date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[499].created_at))}`,
    total_scanned: 500,
    bookmarked_stops: bookmarkedCount,
    new_ledger_entries_created: supplyUnlockEntry ? 1 : 0,
    handshake_instances_count: handshakeInstances.length,
    gap_rule_instances_count: gapRuleInstances.length,
    gap_point_memos_count: gapPointMemos.length,
    skipped_stops_total: skippedStopsAudit.length,
    skipped_breakdown: skipStats
  },
  new_ledger_entries: supplyUnlockEntry ? [supplyUnlockEntry] : [],
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
console.log(`✅ 成功输出供给减持极致纯化版 501~1000 账本: ${outPath}`);
console.log(`   - 扫描消息总数: 500 条`);
console.log(`   - 书签触发停靠: ${bookmarkedCount} 条`);
console.log(`   - 真正开账机制: ${supplyUnlockEntry ? 1 : 0} 个 (减持约9天接近支撑再回吸)`);
if (supplyUnlockEntry) {
  console.log(`     首发证据: "${supplyUnlockEntry.first_discovered.evidence_span}"`);
}
console.log(`   - 二次握手有效复述实例: ${handshakeInstances.length} 条`);
console.log(`   - 缺口双轨分流: 规则复述 ${gapRuleInstances.length} 条 | 点位备忘 ${gapPointMemos.length} 条`);
console.log(`   - 全量真实 Skip 审计: ${skippedStopsAudit.length} 条\n`);
