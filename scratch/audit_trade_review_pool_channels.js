import { getDb } from '../database.js';

const db = getDb();

console.log('========================================================================================');
console.log('🔍 深度审计: trade_review_pool (L2a 1195 笔成交单) 的真实来源频道');
console.log('========================================================================================\n');

const trades = db.prepare(`
  SELECT m.channel_id, COUNT(*) as trade_count
  FROM trade_review_pool t
  LEFT JOIN messages m ON t.message_id = m.id
  GROUP BY m.channel_id
`).all();

console.log('📊 真实成交单来源频道分布:');
trades.forEach((r, idx) => {
  console.log(`  [${idx + 1}] 频道 ID: ${r.channel_id} -> 成交单数: ${r.trade_count} 笔`);
});

const totalTrades = db.prepare(`SELECT COUNT(*) as total FROM trade_review_pool`).get();
console.log(`\n📦 成交单总数: ${totalTrades.total} 笔`);
