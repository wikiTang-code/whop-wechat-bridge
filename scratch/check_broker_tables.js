import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 检查数据库中已有的实盘/流水数据表结构');
console.log('====================================================\n');

const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
`).all();

console.log('📋 现有数据表列表:');
for (const t of tables) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get().c;
  console.log(`- ${t.name} (共 ${count} 行)`);
}

// 检查可能包含长桥流水的表
const candidateTables = ['trades', 'portfolio_transactions', 'orders', 'order_records', 'lots'];
for (const ct of candidateTables) {
  if (tables.some(t => t.name === ct)) {
    console.log(`\n📌 检查表结构: ${ct}`);
    const cols = db.prepare(`PRAGMA table_info(${ct})`).all();
    console.log(cols.map(c => `${c.name} (${c.type})`).join(', '));
    const sample = db.prepare(`SELECT * FROM ${ct} LIMIT 2`).all();
    console.log('样例数据:', JSON.stringify(sample, null, 2));
  }
}
