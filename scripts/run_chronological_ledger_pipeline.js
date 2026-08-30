import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('📖 启动时序动态账本流水线 (Chronological Ledger Pipeline) 原型测试：前 500 条赵哥消息');
console.log('========================================================================================\n');

// 1. 读取按时间顺序排列的前 500 条赵哥消息
const zhaoMessages = db.prepare(`
  SELECT id, channel_name, channel_id, sender_name, content, created_at
  FROM messages
  WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
    AND content IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 500
`).all();

console.log(`👤 载入按时间排序的赵哥前 500 条消息 (起始: ${new Date(zhaoMessages[0].created_at).toISOString().slice(0, 10)} -> 结束: ${new Date(zhaoMessages[499].created_at).toISOString().slice(0, 10)})\n`);

// 2. 动态账本结构 (Ledger State)
const ledger = new Map();

// 3. 强特征书签 (Bookmark Triggers: 必须停下记账的信号)
const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|被动减|减持|总仓位不要超过|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出)/;

let bookmarkedCount = 0;
let skippedCount = 0;
let newMechanismCount = 0;
let instanceAppendedCount = 0;

for (let i = 0; i < zhaoMessages.length; i++) {
  const msg = zhaoMessages[i];
  let text = msg.content || '';
  text = text.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
  if (text.length < 8) {
    skippedCount++;
    continue;
  }

  const match = text.match(BOOKMARK_REGEX);
  if (!match) {
    skippedCount++;
    continue;
  }

  bookmarkedCount++;
  const triggerWord = match[0];
  const etDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(msg.created_at));

  // 提取关键词所在的局部原句 span
  const matchIdx = text.indexOf(triggerWord);
  const start = Math.max(0, matchIdx - 20);
  const end = Math.min(text.length, matchIdx + triggerWord.length + 50);
  const localSpan = text.substring(start, end).replace(/\n+/g, ' ').trim();

  // 判定是否属于已有账目还是新账目
  let matchedLedgerKey = null;
  for (const [key, entry] of ledger.entries()) {
    if (entry.keywords.some(kw => text.includes(kw))) {
      matchedLedgerKey = key;
      break;
    }
  }

  if (matchedLedgerKey) {
    // 动作 2: 记到已有名下 (追加实例)
    const entry = ledger.get(matchedLedgerKey);
    entry.instances.push({
      index: i + 1,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      evidence_span: localSpan,
      raw_text: text.slice(0, 200).replace(/\n+/g, ' ')
    });
    instanceAppendedCount++;
  } else {
    // 动作 1: 入账新名 (建立新条目)
    const ledgerKey = `mech_${triggerWord}_${ledger.size + 1}`;
    ledger.set(ledgerKey, {
      ledger_id: ledgerKey,
      mechanism_name: `机制/规则 [${triggerWord}]`,
      keywords: [triggerWord],
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
    newMechanismCount++;
  }
}

// 4. 格式化账本输出
const ledgerArray = Array.from(ledger.values()).map(entry => ({
  ledger_id: entry.ledger_id,
  mechanism_name: entry.mechanism_name,
  first_date: entry.first_discovered.et_date,
  first_message_id: entry.first_discovered.message_id,
  first_evidence: entry.first_discovered.evidence_span,
  total_appearances: 1 + entry.instances.length,
  later_instances_count: entry.instances.length,
  instances_samples: entry.instances.slice(0, 3)
}));

const resultData = {
  metadata: {
    dataset_range: '前 500 条赵哥时序发言',
    start_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at)),
    end_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[499].created_at)),
    total_scanned: 500,
    bookmarked_stops: bookmarkedCount,
    skipped_messages: skippedCount,
    ledger_entries_created: ledger.size,
    instances_linked: instanceAppendedCount
  },
  ledger: ledgerArray
};

fs.mkdirSync('data/l2b/gold', { recursive: true });
const outPath = 'data/l2b/gold/zhao_ledger_v0_500.json';
fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');

console.log(`========================================================================================`);
console.log(`✅ 成功输出前 500 条时序动态账本: ${outPath}`);
console.log(`   - 扫描消息总数: 500 条`);
console.log(`   - 书签停靠分析数: ${bookmarkedCount} 条`);
console.log(`   - 跳过非策略/闲聊数: ${skippedCount} 条 (${((skippedCount/500)*100).toFixed(1)}%)`);
console.log(`   - 入账核心机制数: ${ledger.size} 个`);
console.log(`   - 跨时间追加实例数: ${instanceAppendedCount} 次\n`);

ledgerArray.forEach(l => {
  console.log(`📘 [${l.ledger_id}] ${l.mechanism_name} (首次提出: ${l.first_date}, 累计出现: ${l.total_appearances} 次)`);
  console.log(`    首发证据: "${l.first_evidence}"`);
});
