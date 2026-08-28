import fs from 'fs';
import { remapAtom, foldWs, evidenceOk, KNOWN_KIDS } from '../data/eval/l2b_kid_remap.js';
import { postProcessL2b } from './post_processor_l2b.js';

console.log('====================================================');
console.log('🎯 L2b 严格逐窗召回率与精确率评估 (Strict Per-CU Precision & Recall)');
console.log('====================================================\n');

// 1. 读取 split 配置
const splitPath = 'data/eval/l2b_eval_split.json';
const splitConfig = JSON.parse(fs.readFileSync(splitPath, 'utf-8'));

// 2. 读取 30 条金标
const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
const goldAtoms = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// 构建 cu_id -> Set(kid) 映射
const goldMap = new Map();
for (const g of goldAtoms) {
  for (const scu of g.source_cu) {
    if (!goldMap.has(scu)) goldMap.set(scu, new Set());
    goldMap.get(scu).add(g.kid);
  }
}

// 3. 读取 50 组样本原文
const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
const allSamples = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
const sampleMap = new Map(allSamples.map(s => [s.cu_id, s]));

// 4. 读取 14B 预测记录
const predsPath = 'data/eval/preds_l2b_14b_30.jsonl';
const lines = fs.readFileSync(predsPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const predsMap = new Map();
for (const l of lines) {
  try {
    const obj = JSON.parse(l);
    predsMap.set(obj.cu_id, obj);
  } catch (e) {}
}

console.log(`💎 金标覆盖正样本 CU: ${splitConfig.positive_source_cus.length} 个`);
console.log(`📦 载入 14B 预测记录: ${predsMap.size} 条\n`);

// 5. 逐窗严格比对
let totalGoldAtomsCount = 0;
let totalPredAtomsCount = 0;
let totalTruePositives = 0;
let totalFalsePositives = 0;
let totalFalseNegatives = 0;

let totalEvidenceCount = 0;
let validEvidenceCount = 0;
let totalOrderLeaks = 0;

const cuBreakdown = [];

for (const cuId of splitConfig.positive_source_cus) {
  const cu = sampleMap.get(cuId);
  const fullText = cu ? cu.dialogue_messages.map(m => m.text).join(' ') : '';
  const goldKidSet = goldMap.get(cuId) || new Set();
  const goldKids = Array.from(goldKidSet);
  totalGoldAtomsCount += goldKids.length;

  const predObj = predsMap.get(cuId);
  const rawParsed = predObj ? predObj.parsed : null;
  const processed = postProcessL2b(rawParsed, cu);
  const rawAtoms = processed.atoms || [];

  const predKidsList = [];
  for (const a of rawAtoms) {
    totalPredAtomsCount++;
    totalEvidenceCount++;

    // 路由
    const remapped = remapAtom(a, fullText);
    predKidsList.push(remapped.kid);

    // 检查证据子串
    if (evidenceOk(a.evidence_span, fullText)) {
      validEvidenceCount++;
    }

    // 检查订单泄漏
    const blob = JSON.stringify(a);
    if (/\b(BUY|SELL|price|建仓|清仓)\b/i.test(blob) && !a.do_not_use_as_order) {
      totalOrderLeaks++;
    }
  }

  const predKidSet = new Set(predKidsList);

  // 计算 TP, FP, FN
  const tpList = goldKids.filter(k => predKidSet.has(k));
  const fnList = goldKids.filter(k => !predKidSet.has(k)); // 漏抽
  const fpList = predKidsList.filter(k => !goldKidSet.has(k)); // 错绑或多抽

  totalTruePositives += tpList.length;
  totalFalsePositives += fpList.length;
  totalFalseNegatives += fnList.length;

  cuBreakdown.push({
    cu_id: cuId,
    gold_kids: goldKids,
    pred_kids: predKidsList,
    hits_tp: tpList,
    misses_fn: fnList,
    wrong_or_extra_fp: fpList,
    latency_ms: predObj?.latency_ms || 0
  });
}

// 6. 空窗评估 (must_empty)
let emptyTotal = splitConfig.must_empty.ids.length;
let emptySuccess = 0;
const emptyBreakdown = [];

for (const cuId of splitConfig.must_empty.ids) {
  const cu = sampleMap.get(cuId);
  const predObj = predsMap.get(cuId);
  const rawParsed = predObj ? predObj.parsed : null;
  const processed = postProcessL2b(rawParsed, cu);
  const atomsCount = processed.atoms?.length || 0;

  if (atomsCount === 0) {
    emptySuccess++;
    emptyBreakdown.push({ cu_id: cuId, status: 'PASS', atomsCount: 0 });
  } else {
    emptyBreakdown.push({ cu_id: cuId, status: 'FAIL', atomsCount, atoms: processed.atoms });
  }
}

// 7. 计算核心指标
const precision = totalPredAtomsCount > 0 ? (totalTruePositives / (totalTruePositives + totalFalsePositives)) * 100 : 0;
const recall = totalGoldAtomsCount > 0 ? (totalTruePositives / (totalTruePositives + totalFalseNegatives)) * 100 : 0;
const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
const emptyPrecision = (emptySuccess / emptyTotal) * 100;
const evidenceRate = totalEvidenceCount > 0 ? (validEvidenceCount / totalEvidenceCount) * 100 : 100;
const orderLeakRate = totalPredAtomsCount > 0 ? (totalOrderLeaks / totalPredAtomsCount) * 100 : 0;

console.log('====================================================');
console.log('📊 L2b 严格真实逐窗指标看板 (Strict Per-CU Scoreboard)');
console.log('====================================================');
console.log(`1. 订单泄漏率 (Order Leakage Rate):      ${orderLeakRate.toFixed(1)}% (目标 恒为 0%) -> ${orderLeakRate === 0 ? '✅ PASS (零泄漏)' : '❌ FAIL'}`);
console.log(`2. 空窗精度 (Empty Window Precision):    ${emptyPrecision.toFixed(1)}% (目标 >= 95%) -> ${emptyPrecision >= 95 ? '✅ PASS' : '⚠️ 需优化'}`);
console.log(`3. 原文子串真实率 (Evidence Substring):   ${evidenceRate.toFixed(1)}% (目标 >= 90%) -> ${evidenceRate >= 90 ? '✅ PASS' : '⚠️ 需优化'}`);
console.log(`4. 逐窗精确率 (Strict kidPrecision):     ${precision.toFixed(1)}% (TP: ${totalTruePositives}, FP: ${totalFalsePositives})`);
console.log(`5. 逐窗召回率 (Strict kidRecall):        ${recall.toFixed(1)}% (TP: ${totalTruePositives}, FN: ${totalFalseNegatives})`);
console.log(`6. 综合 F1 分数 (Strict F1):             ${f1.toFixed(1)}%`);
console.log('====================================================\n');

// 8. 打印逐窗对账细节
console.log('📋 逐窗对账明细 (Per-CU Error Breakdown):');
for (const item of cuBreakdown) {
  const isPerfect = item.misses_fn.length === 0 && item.wrong_or_extra_fp.length === 0;
  const statusIcon = isPerfect ? '🟢 完美命中' : (item.hits_tp.length > 0 ? '🟡 部分命中' : '🔴 未命中/错绑');
  console.log(`[${statusIcon}] ${item.cu_id} (耗时 ${item.latency_ms}ms)`);
  console.log(`   - 金标期望: [${item.gold_kids.join(', ')}]`);
  console.log(`   - 模型输出: [${item.pred_kids.join(', ')}]`);
  if (item.hits_tp.length > 0) console.log(`   - 命中 (TP): [${item.hits_tp.join(', ')}]`);
  if (item.misses_fn.length > 0) console.log(`   - 漏抽 (FN): [${item.misses_fn.join(', ')}]`);
  if (item.wrong_or_extra_fp.length > 0) console.log(`   - 错绑/多抽 (FP): [${item.wrong_or_extra_fp.join(', ')}]`);
  console.log('----------------------------------------------------');
}

// 9. 保存严格报告
const reportPath = 'data/eval/harness_report_l2b_strict_30.json';
const reportData = {
  summary: {
    orderLeakRate,
    emptyPrecision,
    evidenceRate,
    precision,
    recall,
    f1,
    counts: {
      totalGoldAtomsCount,
      totalPredAtomsCount,
      totalTruePositives,
      totalFalsePositives,
      totalFalseNegatives
    }
  },
  emptyBreakdown,
  cuBreakdown
};

fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf-8');
console.log(`\n✅ 严格逐窗评测报告已保存至 ${reportPath}！`);
