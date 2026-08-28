import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('📦 整理与分发 Grok 评测与金标资产包');
console.log('====================================================\n');

// 1. 移动/覆盖文件至标准目录
const copyMap = [
  { from: 'data/eval/lora_hyperparams.yaml', to: 'data/configs/lora_hyperparams.yaml' },
  { from: 'data/eval/SCHEMA_SPEC.md', to: 'data/specs/SCHEMA_SPEC.md' },
  { from: 'data/eval/semantic_envelope_schema.json', to: 'data/specs/semantic_envelope_schema.json' },
  { from: 'data/eval/semantic_extract_prompt.md', to: 'data/prompts/semantic_extract_prompt.md' }
];

for (const item of copyMap) {
  if (fs.existsSync(item.from)) {
    fs.mkdirSync(path.dirname(item.to), { recursive: true });
    fs.copyFileSync(item.from, item.to);
    console.log(`✅ 已同步覆盖: ${item.from} -> ${item.to}`);
  }
}

// 2. 校验 gold_envelopes_50.jsonl
const goldPath = 'data/eval/gold_envelopes_50.jsonl';
if (fs.existsSync(goldPath)) {
  const content = fs.readFileSync(goldPath, 'utf-8').trim();
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  console.log(`\n💎 成功读取 gold_envelopes_50.jsonl: 共 ${lines.length} 条金标记录！`);

  let totalActions = 0;
  let filledActions = 0;
  let plannedActions = 0;
  let verifiedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const obj = JSON.parse(lines[i]);
    if (obj.parse_status === 'human_verified') verifiedCount++;
    if (obj.parse_status === 'failed') failedCount++;
    
    if (obj.actions && Array.isArray(obj.actions)) {
      totalActions += obj.actions.length;
      for (const a of obj.actions) {
        if (a.status === 'filled') filledActions++;
        if (a.status === 'planned') plannedActions++;
      }
    }
  }

  console.log(`📊 统计结果:`);
  console.log(`   - human_verified 记录数: ${verifiedCount} 条`);
  console.log(`   - failed 记录数: ${failedCount} 条`);
  console.log(`   - 提取的明确交易动作总数 (actions): ${totalActions} 个 (filled成交: ${filledActions}, planned预警/挂单: ${plannedActions})`);
} else {
  console.error(`❌ 未找到 ${goldPath}`);
}
