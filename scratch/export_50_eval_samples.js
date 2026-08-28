import { getDb, initDb } from '../database.js';
import fs from 'fs';
import path from 'path';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📦 导出 50 组真实 Context Unit 样本至 data/samples/');
console.log('====================================================\n');

const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

// 确保目录存在
const outDir = 'data/samples';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 获取大V在【历史股票期权记录区】与【美股讨论区】中的代表性发言
const kolMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  WHERE sender_id = ?
    AND length(content) > 10
  ORDER BY created_at ASC
`).all(TARGET_SPEAKER);

console.log(`📚 命中大V有效发言数: ${kolMsgs.length} 条\n`);

function getContextWindow(msg, idx) {
  const timeMs = msg.created_at < 9999999999 ? msg.created_at * 1000 : msg.created_at;

  const beforeMsgs = db.prepare(`
    SELECT id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE channel_id = ? AND created_at < ?
    ORDER BY created_at DESC
    LIMIT 8
  `).all(msg.channel_id, msg.created_at).reverse();

  const afterMsgs = db.prepare(`
    SELECT id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE channel_id = ? AND created_at > ?
    ORDER BY created_at ASC
    LIMIT 3
  `).all(msg.channel_id, msg.created_at);

  const fullList = [...beforeMsgs, msg, ...afterMsgs];

  return {
    cu_id: `cu_sample_${String(idx + 1).padStart(3, '0')}`,
    channel: msg.channel_name || msg.channel_id,
    et_timestamp: new Date(timeMs).toLocaleString('zh-CN', { timeZone: 'America/New_York' }) + ' (ET)',
    anchor_speaker: '赵哥',
    dialogue_messages: fullList.map(m => {
      const isKol = m.sender_id === TARGET_SPEAKER;
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      return {
        id: m.id,
        role: isKol ? 'kol' : 'peer',
        speaker: isKol ? '赵哥' : (m.sender_name || '群友'),
        time: new Date(mTime).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        text: m.content.replace(/\[IMAGE:.*?\]/gi, '[图片]').trim()
      };
    })
  };
}

// 均匀抽样 50 组样本
const step = Math.max(1, Math.floor(kolMsgs.length / 50));
const samples = [];

for (let i = 0; i < kolMsgs.length && samples.length < 50; i += step) {
  samples.push(getContextWindow(kolMsgs[i], samples.length));
}

const jsonlPath = path.join(outDir, 'context_units_eval_50.jsonl');
const lines = samples.map(s => JSON.stringify(s)).join('\n');
fs.writeFileSync(jsonlPath, lines, 'utf-8');

console.log(`✅ 成功导出 ${samples.length} 组 Context Unit 样本至 ${jsonlPath}！`);
