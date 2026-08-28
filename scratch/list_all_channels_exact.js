import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('📺 全库频道名与消息量精确打点列表');
console.log('====================================================\n');

const channels = db.prepare(`
  SELECT channel_id, channel_name, COUNT(*) as count
  FROM messages
  GROUP BY channel_id, channel_name
  ORDER BY count DESC
`).all();

console.table(channels);
