import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📊 交易单专属频道 (L2a 消息源) 统计查询');
console.log('====================================================\n');

// 1. 查询所有带有 "记录" 或 "纪录" 或 "历史" 或 "股票" 的频道列表
const channels = db.prepare(`
  SELECT channel_id, channel_name, COUNT(*) as msg_count,
         MIN(created_at) as min_time, MAX(created_at) as max_time
  FROM messages
  GROUP BY channel_id, channel_name
  ORDER BY msg_count DESC
`).all();

console.log('📋 数据库中所有频道消息分布:');
for (const c of channels) {
  const isTarget = c.channel_name?.includes('纪录') || c.channel_name?.includes('记录') || c.channel_id === 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN';
  console.log(`[${isTarget ? '🎯 目标交易频道' : '💬 讨论/其它频道'}] ID: ${c.channel_id} | 频道名: ${c.channel_name || '未命名'} | 消息总数: ${c.msg_count} 条`);
}

// 2. 精确统计目标交易单频道中的消息数
const targetChannels = channels.filter(c => 
  c.channel_name?.includes('纪录') || c.channel_name?.includes('记录') || c.channel_id === 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN'
);

const targetChannelIds = targetChannels.map(c => c.channel_id);
const placeholders = targetChannelIds.map(() => '?').join(',');

const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

const totalTargetMsgs = db.prepare(`
  SELECT COUNT(*) as count FROM messages WHERE channel_id IN (${placeholders})
`).get(...targetChannelIds).count;

const kolTargetMsgs = db.prepare(`
  SELECT COUNT(*) as count FROM messages WHERE channel_id IN (${placeholders}) AND sender_id = ?
`).get(...targetChannelIds, TARGET_SPEAKER).count;

const nonKolMsgs = totalTargetMsgs - kolTargetMsgs;

// 获取时间跨度
const timeRange = db.prepare(`
  SELECT MIN(created_at) as min_t, MAX(created_at) as max_t FROM messages WHERE channel_id IN (${placeholders})
`).get(...targetChannelIds);

const minDate = new Date((timeRange.min_t < 9999999999 ? timeRange.min_t * 1000 : timeRange.min_t)).toISOString().split('T')[0];
const maxDate = new Date((timeRange.max_t < 9999999999 ? timeRange.max_t * 1000 : timeRange.max_t)).toISOString().split('T')[0];

console.log('\n====================================================');
console.log('🎯 交易单频道 (L2a 核心消息源) 统计汇总:');
console.log('====================================================');
console.log(`1. 交易单频道消息总数:       ${totalTargetMsgs} 条`);
console.log(`   - 其中大V (赵哥) 发言数:   ${kolTargetMsgs} 条 (${((kolTargetMsgs / totalTargetMsgs) * 100).toFixed(1)}%)`);
console.log(`   - 其余/系统/群友发言数:   ${nonKolMsgs} 条`);
console.log(`2. 历史时间跨度:             ${minDate} 至 ${maxDate}`);
console.log('====================================================\n');
