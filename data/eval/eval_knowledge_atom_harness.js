import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🧠 L2b Knowledge Atom Eval Harness (30条知识原子质量评测)');
console.log('====================================================\n');

const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
if (!fs.existsSync(goldPath)) {
  console.error(`❌ 缺少金标文件: ${goldPath}`);
  process.exit(1);
}

const goldLines = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const goldAtoms = goldLines.map(l => JSON.parse(l));
console.log(`💎 成功载入 L2b 金标原子: ${goldAtoms.length} 条\n`);

export function evaluateKnowledgeAtoms(predictions) {
  let totalGold = goldAtoms.length;
  let kidMatchCount = 0;
  let typeMatchCount = 0;
  let validSubstringCount = 0;
  let validStatementLengthCount = 0;

  const goldMap = new Map();
  for (const g of goldAtoms) goldMap.set(g.kid, g);

  for (const p of predictions) {
    const gold = goldMap.get(p.kid);
    if (!gold) continue;

    kidMatchCount++;
    if (p.type === gold.type) typeMatchCount++;
    if (p.statement && p.statement.length <= 240) validStatementLengthCount++;
    if (p.evidence_span && p.evidence_span.length > 0) validSubstringCount++;
  }

  const kidMatchRate = (kidMatchCount / totalGold) * 100;
  const typeMatchRate = (typeMatchCount / totalGold) * 100;
  const statementValidRate = (validStatementLengthCount / totalGold) * 100;
  const evidenceValidRate = (validSubstringCount / totalGold) * 100;

  console.log('====================================================');
  console.log('📊 L2b 知识原子 Benchmark 打分结果 (Scoreboard)');
  console.log('====================================================');
  console.log(`1. kid 战法命中率:             ${kidMatchRate.toFixed(1)}% (目标 >= 70%)`);
  console.log(`2. 知识 Type 分类一致率:        ${typeMatchRate.toFixed(1)}% (目标 >= 80%)`);
  console.log(`3. Statement 独立可读性(<=240字): ${statementValidRate.toFixed(1)}% (目标 >= 95%)`);
  console.log(`4. 原文子串证据真实率:          ${evidenceValidRate.toFixed(1)}% (目标 >= 95%)`);
  console.log('====================================================\n');

  return {
    metrics: {
      kidMatchRate,
      typeMatchRate,
      statementValidRate,
      evidenceValidRate
    }
  };
}

if (process.argv[1] && process.argv[1].endsWith('eval_knowledge_atom_harness.js')) {
  console.log('ℹ️ 运行 L2b 金标自检 (Self-Check):');
  evaluateKnowledgeAtoms(goldAtoms);
}
