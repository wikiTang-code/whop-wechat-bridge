import { getDb } from '../database.js';

const db = getDb();

const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const targetKey = `gemini_requests_${todayStr}`;

// 写入 1126 次真实打点
db.prepare(`
  INSERT INTO portfolio (key, value) VALUES (?, 1126)
  ON CONFLICT(key) DO UPDATE SET value = 1126
`).run(targetKey);

console.log(`✅ 成功将今日 (${targetKey}) 实际 API 消耗额度更正为 1126 次！`);
