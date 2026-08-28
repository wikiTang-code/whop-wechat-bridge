import fs from 'fs';
import path from 'path';

// 1. 同步覆盖 Prompt 至 data/prompts/
const srcPrompt = 'data/eval/knowledge_atom_extract_prompt.md';
const dstPrompt = 'data/prompts/knowledge_atom_extract_prompt.md';
if (fs.existsSync(srcPrompt)) {
  fs.mkdirSync(path.dirname(dstPrompt), { recursive: true });
  fs.copyFileSync(srcPrompt, dstPrompt);
  console.log(`✅ 已同步覆盖: ${srcPrompt} -> ${dstPrompt}`);
}

// 2. 载入金标知识原子
const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
const goldLines = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const goldAtoms = goldLines.map(l => JSON.parse(l));

// 提取 30 个源 CU ID 集合
const targetCuIds = new Set(goldAtoms.flatMap(g => g.source_cu));
console.log(`💎 30 条金标覆盖的源 CU 集合: 共 ${targetCuIds.size} 个上下文窗口`);

// 3. 读取评测样本
const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
const sampleLines = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const allSamples = sampleLines.map(l => JSON.parse(l));

const evalSamples = allSamples.filter(s => targetCuIds.has(s.cu_id));
console.log(`📚 筛选出对应 L2b 知识原子评测样本: 共 ${evalSamples.length} 组 CU\n`);
