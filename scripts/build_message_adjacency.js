import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🔗 构建全库消息时序邻接指针表 (message_adjacency: prev_ids[6] / next_ids[6])');
console.log('========================================================================================\n');

// 1. 创建邻接指针表
db.prepare(`
  CREATE TABLE IF NOT EXISTS message_adjacency (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    created_at INTEGER NOT NULL,
    prev_ids TEXT NOT NULL,
    next_ids TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_adj_channel ON message_adjacency(channel_id, created_at)`).run();

// 2. 按频道分组遍历消息构建双向滑窗
const channels = db.prepare(`SELECT DISTINCT channel_id FROM messages`).all();
console.log(`📡 频道总数: ${channels.length} 个`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO message_adjacency 
  (message_id, channel_id, channel_name, created_at, prev_ids, next_ids, updated_at)
  VALUES (@message_id, @channel_id, @channel_name, @created_at, @prev_ids, @next_ids, @updated_at)
`);

const insertMany = db.transaction((records) => {
  for (const r of records) insertStmt.run(r);
});

let totalLinked = 0;
const now = Date.now();

for (const ch of channels) {
  const msgs = db.prepare(`
    SELECT id, channel_id, channel_name, created_at
    FROM messages
    WHERE channel_id = ?
    ORDER BY created_at ASC
  `).all(ch.channel_id);

  console.log(`   - 频道 [${ch.channel_id}] (${msgs[0]?.channel_name || '未命名'}): ${msgs.length} 条消息`);

  const records = [];
  for (let i = 0; i < msgs.length; i++) {
    const prevSlice = msgs.slice(Math.max(0, i - 6), i).map(m => m.id);
    const nextSlice = msgs.slice(i + 1, Math.min(msgs.length, i + 7)).map(m => m.id);

    records.push({
      message_id: msgs[i].id,
      channel_id: msgs[i].channel_id,
      channel_name: msgs[i].channel_name,
      created_at: msgs[i].created_at,
      prev_ids: JSON.stringify(prevSlice),
      next_ids: JSON.stringify(nextSlice),
      updated_at: now
    });
  }

  insertMany(records);
  totalLinked += records.length;
}

console.log(`\n========================================================================================`);
console.log(`✅ 成功构建邻接指针表: message_adjacency (总计写入 ${totalLinked} 条消息双向索引)`);
console.log(`========================================================================================\n`);
