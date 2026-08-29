import fs from 'fs';

console.log('====================================================');
console.log('🔍 查看 Tier 1 18 条硬成交漏抽窗口原文');
console.log('====================================================\n');

const tier1Path = 'data/runs/l2a_empty_tier1_hard_fills.jsonl';
const lines = fs.readFileSync(tier1Path, 'utf-8').trim().split('\n').filter(Boolean);
const items = lines.map(l => JSON.parse(l));

console.log(`📋 共有 ${items.length} 条待补抽记录:`);
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  console.log(`\n📌 [${i + 1}/${items.length}] [${it.cu_id}]`);
  console.log(`   原文: ${it.source_text.replace(/\n/g, ' ')}`);
}
