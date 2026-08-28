import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 INTC（英特尔）历史股票期权记录区全量发言与交易核对台账');
console.log('====================================================\n');

// 1. 查找频道中所有提及 intc 或 英特尔 的原始发言
const msgs = db.prepare(`
  SELECT id, content, created_at
  FROM messages
  WHERE channel_id = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
    AND (content LIKE '%intc%' OR content LIKE '%英特尔%')
  ORDER BY created_at ASC
`).all();

console.log(`📚 频道中包含 INTC 关键字的总发言数: ${msgs.length} 条\n`);

// 2. 从 trade_review_pool 中获取当前 INTC 的所有记录
const reviews = db.prepare(`
  SELECT * FROM trade_review_pool
  WHERE ticker = 'INTC'
  ORDER BY created_at ASC
`).all();

let bCount = 0;
let sCount = 0;
let cCount = 0;

for (const r of reviews) {
  const timeStr = new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let code = '';
  if (r.status === 'confirmed') {
    code = r.action === 'BUY' ? `INTC_B${++bCount}` : `INTC_S${++sCount}`;
    console.log(`🟢 [${code}] [${timeStr}] 动作: ${r.action} @ $${r.price} (${r.fraction_name}) | 状态: 已入账持仓`);
  } else {
    code = `INTC_C${++cCount}`;
    console.log(`📥 [${code}] [${timeStr}] 预估动作: ${r.action} @ $${r.price} (${r.fraction_name}) | 置信度: ${r.confidence}% | 状态: 待复核候选池`);
  }
  console.log(`   原文: ${r.raw_content}\n`);
}

// 3. 检查是否有未进入 trade_review_pool 的 INTC 消息
const reviewedMsgIds = new Set(reviews.map(r => r.message_id));
const unparsed = msgs.filter(m => !reviewedMsgIds.has(m.id));

if (unparsed.length > 0) {
  console.log(`\n⚠️ 发现 ${unparsed.length} 条包含 INTC 关键字但未入池的原始发言 (通常因为无动作动词或无价格):`);
  unparsed.forEach((u, idx) => {
    const timeMs = u.created_at < 9999999999 ? u.created_at * 1000 : u.created_at;
    const timeStr = new Date(timeMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[未入池 #${idx+1}] [${timeStr}] ${u.content}`);
  });
} else {
  console.log('\n✅ 所有的 INTC 消息均已完全进入已确认流水或候选消息池！');
}
