import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🔍 执行 20 条 QA 答疑窗上下文展开 (Context Pad: 前4后2) 抽样质检');
console.log('========================================================================================\n');

// 1. 读取原子打标树中 acts 包含 qa 的窗
const treePath = 'data/runs/l2b_atom_tree_v0.jsonl';
const treeLines = fs.readFileSync(treePath, 'utf-8').trim().split('\n');
const qaMessageIds = [];
const seenIds = new Set();

for (const line of treeLines) {
  const item = JSON.parse(line);
  if (item.acts.includes('qa') && !seenIds.has(item.message_id)) {
    seenIds.add(item.message_id);
    qaMessageIds.push(item.message_id);
  }
}

console.log(`📋 库内 QA 候选窗总数: ${qaMessageIds.length} 窗`);

// 2. 均匀抽取 20 窗进行上下文展开比对
const step = Math.max(1, Math.floor(qaMessageIds.length / 20));
const sampledIds = [];
for (let i = 0; i < qaMessageIds.length && sampledIds.length < 20; i += step) {
  sampledIds.push(qaMessageIds[i]);
}

const auditResults = [];
let questionCapturedCount = 0;

for (let idx = 0; idx < sampledIds.length; idx++) {
  const mid = sampledIds[idx];
  const targetMsg = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(mid);
  if (!targetMsg) continue;

  const adj = db.prepare(`SELECT * FROM message_adjacency WHERE message_id = ?`).get(mid);
  let prevIds = [];
  let nextIds = [];
  if (adj) {
    prevIds = JSON.parse(adj.prev_ids || '[]');
    nextIds = JSON.parse(adj.next_ids || '[]');
  }

  // 展开前 4 后 2
  const selectedPrevIds = prevIds.slice(Math.max(0, prevIds.length - 4));
  const selectedNextIds = nextIds.slice(0, 2);
  const allIds = [...selectedPrevIds, mid, ...selectedNextIds];

  const placeholders = allIds.map(() => '?').join(',');
  const contextMsgs = db.prepare(`
    SELECT id, sender_name, content, created_at
    FROM messages
    WHERE id IN (${placeholders})
    ORDER BY created_at ASC
  `).all(...allIds);

  const contextDialog = contextMsgs.map(m => {
    const isCenter = m.id === mid;
    const prefix = isCenter ? '👉 【赵哥当前回答】' : `💬 [${m.sender_name}]`;
    return `${prefix}: "${m.content.replace(/\n+/g, ' ')}"`;
  }).join('\n   ');

  // 判断展开后是否成功捕获了前置群友提问
  const hasQuestionInPrev = contextMsgs.some(m => m.id !== mid && (m.content.includes('？') || m.content.includes('?') || m.content.includes('怎么') || m.content.includes('看下') || m.content.includes('能买') || m.content.includes('割') || m.content.includes('走')));
  if (hasQuestionInPrev) questionCapturedCount++;

  auditResults.push({
    index: idx + 1,
    message_id: mid,
    channel_name: targetMsg.channel_name,
    created_at: new Date(targetMsg.created_at).toISOString().slice(0, 10),
    original_window: targetMsg.content.replace(/\n+/g, ' '),
    expanded_dialog: contextDialog,
    question_captured: hasQuestionInPrev
  });
}

// 3. 输出抽检报告
console.log(`========================================================================================`);
console.log(`📊 QA 展开抽检结果: 20 窗中成功捕获前置群友提问数: ${questionCapturedCount} / 20 (${((questionCapturedCount/20)*100).toFixed(1)}%)`);
console.log(`========================================================================================\n`);

auditResults.slice(0, 5).forEach(r => {
  console.log(`[样例 ${r.index}] (${r.created_at}) [${r.channel_name}] 捕获问句: ${r.question_captured ? '✅ 成功' : '➖ 无前置问句'}`);
  console.log(`   原始单条: "${r.original_window}"`);
  console.log(`   展开前后 (Pad=前4后2):\n   ${r.expanded_dialog}\n`);
});

fs.writeFileSync('data/runs/l2b_qa_context_pad_audit.json', JSON.stringify(auditResults, null, 2), 'utf-8');
console.log(`💾 抽检明细已写入: data/runs/l2b_qa_context_pad_audit.json`);
