import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

console.log('====================================================');
console.log('🧠 执行 L2b 知识原子 Benchmark 评测 (4大指标校验)');
console.log('====================================================\n');

// 1. 读取 Prompt 和金标
const promptPath = 'data/prompts/knowledge_atom_extract_prompt.md';
const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
const goldAtoms = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
const validKidSet = new Set(goldAtoms.map(g => g.kid));

// 2. 读取 50 组样本
const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
const allSamples = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// 3. 评测执行函数
export function evaluateL2bPredictions(predictions, cuMap) {
  let emptyWindowTotal = 0;
  let emptyWindowSuccess = 0;

  let totalExtractedAtoms = 0;
  let kidMatchedCount = 0;
  let evidenceValidCount = 0;
  let orderLeakedCount = 0;

  const errorReport = [];

  for (const pred of predictions) {
    const cu = cuMap.get(pred.cu_id);
    const fullText = cu ? cu.dialogue_messages.map(m => m.text).join(' ') : '';
    const atoms = pred.atoms || [];

    // 空窗检验：如果该 CU 在金标中没有任何原子，则期望 atoms 为空
    const goldMatches = goldAtoms.filter(g => g.source_cu.includes(pred.cu_id));
    if (goldMatches.length === 0) {
      emptyWindowTotal++;
      if (atoms.length === 0) {
        emptyWindowSuccess++;
      } else {
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'FALSE_POSITIVE_ON_EMPTY_WINDOW',
          detail: `纯订单/闲聊空窗，但模型输出了 ${atoms.length} 个知识原子`
        });
      }
    }

    // 逐个原子检验
    for (const a of atoms) {
      totalExtractedAtoms++;

      // 1. 检查订单泄漏 (禁止包含 BUY, SELL, 或 price)
      const rawStr = JSON.stringify(a);
      if (/\b(BUY|SELL|price|建仓|清仓)\b/i.test(rawStr) && !a.do_not_use_as_order) {
        orderLeakedCount++;
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'ORDER_LEAKAGE',
          detail: `知识原子中检测到订单字段泄漏: ${rawStr.slice(0, 80)}`
        });
      }

      // 2. 检查 kid 复用率
      if (validKidSet.has(a.kid)) {
        kidMatchedCount++;
      } else {
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'UNKNOWN_KID',
          detail: `输出了未在已知 30 个表内的 kid: ${a.kid}`
        });
      }

      // 3. 检查 evidence_span 是否为原文子串
      if (a.evidence_span && fullText.includes(a.evidence_span)) {
        evidenceValidCount++;
      } else {
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'INVALID_EVIDENCE_SUBSTRING',
          detail: `evidence_span 未能在原 CU 对话中精确匹配: "${a.evidence_span}"`
        });
      }
    }
  }

  const emptyPrecision = emptyWindowTotal > 0 ? (emptyWindowSuccess / emptyWindowTotal) * 100 : 100;
  const kidMatchRate = totalExtractedAtoms > 0 ? (kidMatchedCount / totalExtractedAtoms) * 100 : 100;
  const evidenceSubstringRate = totalExtractedAtoms > 0 ? (evidenceValidCount / totalExtractedAtoms) * 100 : 100;
  const orderLeakageRate = totalExtractedAtoms > 0 ? (orderLeakedCount / totalExtractedAtoms) * 100 : 0;

  console.log('====================================================');
  console.log('📊 L2b 知识原子 4 大核心指标评测看板 (L2b Scoreboard)');
  console.log('====================================================');
  console.log(`1. 空窗精度 (Empty Window Precision):   ${emptyPrecision.toFixed(1)}% (目标 >= 95%) -> ${emptyPrecision >= 95 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`2. kid 表内复用率 (KID Hit Rate):      ${kidMatchRate.toFixed(1)}% (目标 >= 80%) -> ${kidMatchRate >= 80 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`3. 原文子串真实率 (Evidence Substring):  ${evidenceSubstringRate.toFixed(1)}% (目标 >= 95%) -> ${evidenceSubstringRate >= 95 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`4. 订单泄漏率 (Order Leakage Rate):     ${orderLeakageRate.toFixed(1)}% (目标 恒为 0%) -> ${orderLeakageRate === 0 ? '✅ PASS (零泄漏)' : '❌ FAIL'}`);
  console.log('====================================================\n');

  return {
    metrics: {
      emptyPrecision,
      kidMatchRate,
      evidenceSubstringRate,
      orderLeakageRate
    },
    errorReport
  };
}

// 金标自检
const cuMap = new Map(allSamples.map(s => [s.cu_id, s]));
const goldPredictions = allSamples.map(cu => {
  const matches = goldAtoms.filter(g => g.source_cu.includes(cu.cu_id));
  return {
    cu_id: cu.cu_id,
    atoms: matches
  };
});

evaluateL2bPredictions(goldPredictions, cuMap);
