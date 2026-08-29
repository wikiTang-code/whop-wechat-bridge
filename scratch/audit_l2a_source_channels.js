import { getDb } from '../database.js';

const db = getDb();

console.log('========================================================================================');
console.log('🔍 深度审计: 之前 L2a 成交抽取到底抽取了哪些频道？');
console.log('========================================================================================\n');

// 1. 分析 l2a_order_candidates 表（L2a 抽取的成交单来源消息）
const candidates = db.prepare(`
  SELECT m.channel_id, COUNT(*) as trade_count
  FROM l2a_order_candidates c
  LEFT JOIN messages m ON c.message_id = m.id
  GROUP BY m.channel_id
`).all();

console.log('📊 L2a 1,195 笔成交候选单的来源频道分布:');
candidates.forEach((r, i) => {
  console.log(`  [${i+1}] 频道 ID: ${r.channel_id} -> 提取成交单数: ${r.trade_count} 笔`);
});

// 2. 分析全库所有频道的详细信息与赵哥发言占比
console.log('\n----------------------------------------------------------------------------------------');
console.log('🔍 全库频道赵哥发言统计:');
const channels = db.prepare(`
  SELECT channel_id, 
         COUNT(*) as total_msgs,
         SUM(CASE WHEN sender_name LIKE '%xiaozhaolucky%' OR sender_name LIKE '%赵%' OR sender_name LIKE '%Mrzhoulucky%' THEN 1 ELSE 0 END) as zhao_msgs,
         MIN(created_at) as min_date,
         MAX(created_at) as max_date
  FROM messages
  GROUP BY channel_id
`).all();

channels.forEach((c, i) => {
  console.log(`\n[${i+1}] 频道 ID: ${c.channel_id}`);
  console.log(`    总消息数: ${c.total_msgs} 条 | 赵哥发言: ${c.zhao_msgs} 条 (${((c.zhao_msgs/c.total_msgs)*100).toFixed(1)}%)`);
  console.log(`    时间跨度: ${new Date(c.min_date).toISOString().slice(0,10)} ~ ${new Date(c.max_date).toISOString().slice(0,10)}`);
});
