import { getDb, initDb } from '../database.js';
import fs from 'fs';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📦 生成供 Grok 评测与参数调优的 Context Unit 样本包');
console.log('====================================================\n');

// 目标大V ID
const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

// 1. 抓取大V发言作为锚点
const kolMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  WHERE sender_id = ?
  ORDER BY created_at ASC
`).all(TARGET_SPEAKER);

console.log(`📚 数据库中赵哥发言总数: ${kolMsgs.length} 条\n`);

// 2. 切窗函数：抓取同频道前 8 条 + 后 3 条
function getContextWindow(msg) {
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
    anchor_id: msg.id,
    channel_name: msg.channel_name,
    created_at_str: new Date(timeMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    messages: fullList.map(m => {
      const isKol = m.sender_id === TARGET_SPEAKER;
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      return {
        id: m.id,
        role: isKol ? 'kol_zhao' : 'peer',
        name: isKol ? '赵哥' : m.sender_name,
        time: new Date(mTime).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        text: m.content.replace(/\[IMAGE:.*?\]/gi, '[图片]').trim()
      };
    })
  };
}

// 3. 挑选 5 个最具代表性的场景切片
// 场景 1: 群友提问赵哥回答 (问答型)
// 场景 2: 盘中连续加仓做T (指令型)
// 场景 3: 宏观与大盘分析 (观点型)
// 场景 4: 止盈与减仓提示 (风控型)
// 场景 5: 跨标的对比与讨论 (综合型)

const selectedIndices = [50, 200, 500, 1000, 1500, 2000, 2500, 3000];
const samplePack = [];

for (const idx of selectedIndices) {
  if (kolMsgs[idx]) {
    const cu = getContextWindow(kolMsgs[idx]);
    samplePack.push({
      sample_id: `sample_${samplePack.length + 1}`,
      category: `典型切片 #${samplePack.length + 1}`,
      channel: cu.channel_name,
      timestamp: cu.created_at_str,
      dialogue_window: cu.messages
    });
  }
}

const outputPath = 'scratch/grok_evaluation_pack.json';
fs.writeFileSync(outputPath, JSON.stringify(samplePack, null, 2), 'utf-8');

console.log(`✅ 样本包生成成功！共包含 ${samplePack.length} 组完整上下文对话切片！`);
console.log(`📁 保存路径: ${outputPath}`);
