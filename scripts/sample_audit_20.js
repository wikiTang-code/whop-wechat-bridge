import fs from 'fs';

const lines = fs.readFileSync('data/runs/ticker_timeline/merged/TSLL.jsonl', 'utf-8').trim().split('\n').filter(Boolean);
const questionOnly = lines.map(l => JSON.parse(l)).filter(e => e.ticker_origin === 'question');

console.log('TSLL ticker_origin=question 总数:', questionOnly.length);

// 均匀抽样 20 条
const step = Math.floor(questionOnly.length / 20);
const samples = [];
for (let i = 0; i < 20; i++) {
  samples.push(questionOnly[i * step]);
}

console.log('=== 抽查 20 条 TSLL ticker_origin=question 样本 ===\n');
samples.forEach((s, idx) => {
  console.log(`[${idx + 1}] [${s.et_date} ${s.et_time}] [${s.feed_id}]`);
  console.log(`  ❓ 问句 (${s.question_post_id}): ${s.prompt_span}`);
  console.log(`  🗣️ 回句 (${s.answer_post_id}): ${s.evidence_span}`);
  console.log(`  🏷️ 挂票: ${s.canonical} | kind: ${s.kind}`);
  console.log('--------------------------------------------------------------------------------');
});
