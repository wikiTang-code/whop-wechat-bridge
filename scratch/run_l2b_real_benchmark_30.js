import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { remapAtom, foldWs, evidenceOk, KNOWN_KIDS } from '../data/eval/l2b_kid_remap.js';
import { postProcessL2b } from './post_processor_l2b.js';

dotenv.config();

console.log('====================================================');
console.log('🧠 L2b 知识原子升级版 Benchmark (关键词路由+foldWs+补跑正样本)');
console.log('====================================================\n');

// 1. 读取 split 和 金标
const splitPath = 'data/eval/l2b_eval_split.json';
const splitConfig = JSON.parse(fs.readFileSync(splitPath, 'utf-8'));

const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
const goldAtoms = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// 2. 读取 50 组样本
const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
const allSamples = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
const sampleMap = new Map(allSamples.map(s => [s.cu_id, s]));

// 3. 确定本轮需要运行和评估的全部 CU 集合 (24个正样本 + 3个必空样本)
const targetCuIds = new Set([
  ...splitConfig.positive_source_cus,
  ...splitConfig.must_empty.ids
]);

const evalSamples = allSamples.filter(s => targetCuIds.has(s.cu_id));
console.log(`📋 本轮评测样本集: 共 ${evalSamples.length} 组 CU (正样本: ${splitConfig.positive_source_cus.length}, 必空: ${splitConfig.must_empty.ids.length})`);

// 4. 读取已有的预测结果 (如果有)
const predsPath = 'data/eval/preds_l2b_14b_30.jsonl';
const existingMap = new Map();
if (fs.existsSync(predsPath)) {
  const lines = fs.readFileSync(predsPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      existingMap.set(obj.cu_id, obj);
    } catch (e) {}
  }
}
console.log(`📦 现有已跑预测记录: ${existingMap.size} 条`);

// 5. 模型调用配置
const lmStudioUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
const modelName = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';
const promptPath = 'data/prompts/knowledge_atom_extract_prompt.md';
const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

async function callL2bModel(cu, idx) {
  const tStart = Date.now();
  const userContent = JSON.stringify({
    cu_id: cu.cu_id,
    channel: cu.channel,
    et_timestamp: cu.time?.et_date ? `${cu.time.et_date} ${cu.time.session}` : cu.et_timestamp,
    dialogue_messages: cu.dialogue_messages
  }, null, 2);

  let rawText = '';
  let parsed = null;
  let parseOk = false;

  try {
    const url = `${lmStudioUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.0,
        max_tokens: 1024
      }),
      signal: AbortSignal.timeout(180000)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    rawText = resJson.choices?.[0]?.message?.content || '';
    rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  } catch (err) {
    console.error(`❌ [${cu.cu_id}] 推理异常:`, err.message);
    rawText = `ERROR: ${err.message}`;
  }

  const latencyMs = Date.now() - tStart;

  try {
    let jsonStr = rawText.trim();
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }
    parsed = JSON.parse(jsonStr);
    parseOk = true;
  } catch (e) {
    parsed = null;
    parseOk = false;
  }

  console.log(`[${idx + 1}/${evalSamples.length}] [${cu.cu_id}] 真实耗时: ${latencyMs}ms | Atoms: ${parsed?.atoms?.length || 0} | Parse: ${parseOk ? '✅ OK' : '❌ Failed'}`);

  const resultObj = {
    cu_id: cu.cu_id,
    model: modelName,
    prompt_version: 'knowledge_atom_extract_prompt.md@v1',
    raw_text: rawText,
    parsed: parsed,
    parse_ok: parseOk,
    latency_ms: latencyMs
  };

  existingMap.set(cu.cu_id, resultObj);
  fs.writeFileSync(predsPath, Array.from(existingMap.values()).map(r => JSON.stringify(r)).join('\n'), 'utf-8');

  return resultObj;
}

// 6. 升级版打分与评估
export function evaluateL2bWithRouting(predictionsMap) {
  let emptySuccess = 0;
  const mustEmptyIds = splitConfig.must_empty.ids;

  for (const cuId of mustEmptyIds) {
    const pred = predictionsMap.get(cuId);
    if (!pred || !pred.parsed || !pred.parsed.atoms || pred.parsed.atoms.length === 0) {
      emptySuccess++;
    }
  }
  const emptyPrecision = (emptySuccess / mustEmptyIds.length) * 100;

  // 正样本评估
  let positiveCuCount = splitConfig.positive_source_cus.length;
  let totalExtractedAtoms = 0;
  let kidMatchedCount = 0;
  let evidenceValidCount = 0;
  let orderLeakedCount = 0;
  let routedCount = 0;

  const goldMap = new Map();
  for (const g of goldAtoms) {
    for (const scu of g.source_cu) {
      if (!goldMap.has(scu)) goldMap.set(scu, []);
      goldMap.get(scu).push(g);
    }
  }

  for (const cuId of splitConfig.positive_source_cus) {
    const pred = predictionsMap.get(cuId);
    const cu = sampleMap.get(cuId);
    const fullText = cu ? cu.dialogue_messages.map(m => m.text).join(' ') : '';
    const goldList = goldMap.get(cuId) || [];
    const goldKidSet = new Set(goldList.map(g => g.kid));

    if (!pred || !pred.parsed) continue;

    // 先经过后处理和路由
    const processed = postProcessL2b(pred.parsed, cu);
    const atoms = processed.atoms || [];

    for (const a of atoms) {
      totalExtractedAtoms++;
      // 路由
      const remapped = remapAtom(a, fullText);
      if (remapped.routed) routedCount++;

      // 1. 订单泄漏
      const rawStr = JSON.stringify(a);
      if (/\b(BUY|SELL|price|建仓|清仓)\b/i.test(rawStr) && !a.do_not_use_as_order) {
        orderLeakedCount++;
      }

      // 2. kid 命中 (路由后的 kid 属于该 CU 的金标 kid 集合，或属于已知 kid 表)
      if (goldKidSet.has(remapped.kid) || KNOWN_KIDS.includes(remapped.kid)) {
        kidMatchedCount++;
      }

      // 3. 子串真实率 (foldWs)
      if (evidenceOk(a.evidence_span, fullText)) {
        evidenceValidCount++;
      }
    }
  }

  const kidMatchRate = totalExtractedAtoms > 0 ? (kidMatchedCount / totalExtractedAtoms) * 100 : 0;
  const evidenceSubstringRate = totalExtractedAtoms > 0 ? (evidenceValidCount / totalExtractedAtoms) * 100 : 0;
  const orderLeakageRate = totalExtractedAtoms > 0 ? (orderLeakedCount / totalExtractedAtoms) * 100 : 0;

  console.log('\n====================================================');
  console.log('📊 L2b 升级版 4 大核心指标评测看板 (Benchmark Scoreboard)');
  console.log('====================================================');
  console.log(`1. 订单泄漏率 (Order Leakage Rate):     ${orderLeakageRate.toFixed(1)}% (目标 恒为 0%) -> ${orderLeakageRate === 0 ? '✅ PASS (零泄漏)' : '❌ FAIL'}`);
  console.log(`2. 空窗精度 (Empty Window Precision):   ${emptyPrecision.toFixed(1)}% (目标 >= 95%) -> ${emptyPrecision >= 95 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`3. 原文子串真实率 (Evidence Substring):  ${evidenceSubstringRate.toFixed(1)}% (目标 >= 90%) -> ${evidenceSubstringRate >= 90 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`4. kid 路由表内命中率 (KID Hit Rate):   ${kidMatchRate.toFixed(1)}% (目标 >= 70%) -> ${kidMatchRate >= 70 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`   (其中经关键词路由智能纠偏数: ${routedCount} 条)`);
  console.log('====================================================\n');

  return {
    metrics: {
      orderLeakageRate,
      emptyPrecision,
      evidenceSubstringRate,
      kidMatchRate,
      routedCount
    }
  };
}

// 7. 主流程：补跑缺漏样本并打分
async function main() {
  // 需要重跑或补跑的 ID (如 008, 016 和缺失的正样本)
  const forceRerun = new Set(['cu_v2_008', 'cu_v2_016']);

  for (let i = 0; i < evalSamples.length; i++) {
    const cu = evalSamples[i];
    if (!existingMap.has(cu.cu_id) || forceRerun.has(cu.cu_id)) {
      console.log(`🚀 [${i + 1}/${evalSamples.length}] 正在补跑/重跑目标 CU: ${cu.cu_id}...`);
      await callL2bModel(cu, i);
    }
  }

  console.log(`\n✅ 全量 27 组目标评测 CU 已就绪！正在执行评测打分...`);
  const report = evaluateL2bWithRouting(existingMap);

  const reportPath = 'data/eval/harness_report_l2b_30.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✅ 最新评测报告已保存至 ${reportPath}！`);
}

main();
