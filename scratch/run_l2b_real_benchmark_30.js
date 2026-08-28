import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { evaluateL2bPredictions } from './run_l2b_benchmark.js';

dotenv.config();

console.log('====================================================');
console.log('🧠 在 VM 生产环境执行 L2b 知识原子真实大模型评测 (30组源CU)');
console.log('====================================================\n');

// 1. 读取 Prompt 和 金标
const promptPath = 'data/prompts/knowledge_atom_extract_prompt.md';
const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

const goldPath = 'data/eval/gold_knowledge_atoms_30.jsonl';
const goldAtoms = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// 提取 30 条金标覆盖的源 CU 集合（包含纯订单空窗与含战法窗）
const goldCuSet = new Set(goldAtoms.flatMap(g => g.source_cu));
console.log(`💎 金标覆盖的目标源 CU 集合: 共 ${goldCuSet.size} 个 CU`);

// 2. 从 50 个样本中精准提取这批源 CU + 纯订单空窗
const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
const allSamples = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// 保证包含 002 等纯订单空窗作为负样本检验
const evalSamples = allSamples.filter(s => goldCuSet.has(s.cu_id) || ['cu_v2_002', 'cu_v2_024', 'cu_v2_039'].includes(s.cu_id));
console.log(`📚 最终确定的 L2b 评测样本集: 共 ${evalSamples.length} 组 CU\n`);

const lmStudioUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
const modelName = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';

console.log(`🤖 目标模型服务: ${lmStudioUrl}`);
console.log(`🧠 当前加载模型: ${modelName}\n`);

const outPath = 'data/eval/preds_l2b_14b_30.jsonl';
const existingMap = new Map();

// 3. 真实大模型调用函数 (temperature=0)
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
  fs.writeFileSync(outPath, Array.from(existingMap.values()).map(r => JSON.stringify(r)).join('\n'), 'utf-8');

  return resultObj;
}

// 4. 逐条执行并评测
async function main() {
  const results = [];
  for (let i = 0; i < evalSamples.length; i++) {
    const res = await callL2bModel(evalSamples[i], i);
    results.push(res);
  }

  console.log(`\n✅ L2b 真实大模型推理已全部完成并保存至 ${outPath}！`);

  // 5. 运行 Harness 评测打分
  console.log('\n📊 正在执行 L2b 4大指标自动化评估...');
  const validPreds = results.filter(r => r.parsed !== null).map(r => r.parsed);
  const cuMap = new Map(allSamples.map(s => [s.cu_id, s]));
  const report = evaluateL2bPredictions(validPreds, cuMap);

  // 6. 保存评测报告
  const reportPath = 'data/eval/harness_report_l2b_30.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✅ 最新 L2b 评测报告已保存至 ${reportPath}！`);
}

main();
