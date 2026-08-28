import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { evaluatePredictions } from '../data/eval/eval_harness.js';

dotenv.config();

console.log('====================================================');
console.log('🚀 全新执行 50 条 Benchmark 真实大模型推理 (Qwen2.5-14B)');
console.log('====================================================\n');

const promptPath = 'data/prompts/semantic_extract_prompt_v2.md';
const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

const samplePath = 'data/samples/context_units_eval_50_v2.jsonl';
if (!fs.existsSync(samplePath)) {
  console.error(`❌ 缺少样本文件: ${samplePath}`);
  process.exit(1);
}

const sampleLines = fs.readFileSync(samplePath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const samples = sampleLines.map(l => JSON.parse(l));
console.log(`📚 成功载入评测样本: ${samples.length} 组`);

const lmStudioUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
const modelName = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';

console.log(`🤖 目标模型服务: ${lmStudioUrl}`);
console.log(`🧠 当前加载模型: ${modelName}\n`);

const outPath = 'data/eval/preds_35b_50.jsonl';
const existingMap = new Map();

// 读取已有但仅保留真实耗时 > 100ms 的记录（过滤掉旧的 0ms 假数据）
if (fs.existsSync(outPath)) {
  const exLines = fs.readFileSync(outPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const line of exLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.parse_ok === true && obj.latency_ms > 100) {
        existingMap.set(obj.cu_id, obj);
      }
    } catch (e) {}
  }
}
console.log(`🔄 已保留真实历史推理记录: ${existingMap.size} 条，开始全新逐条推理...\n`);

async function callRealModel(cu, idx) {
  if (existingMap.has(cu.cu_id)) {
    const cached = existingMap.get(cu.cu_id);
    console.log(`[${idx + 1}/50] [${cu.cu_id}] (已完成) 耗时: ${cached.latency_ms}ms | Parse: ✅ OK`);
    return cached;
  }

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

  console.log(`[${idx + 1}/50] [${cu.cu_id}] 真实耗时: ${latencyMs}ms | Parse: ${parseOk ? '✅ OK' : '❌ Failed'}`);

  const resultObj = {
    cu_id: cu.cu_id,
    model: modelName,
    prompt_version: 'semantic_extract_prompt_v2.md@v2',
    raw_text: rawText,
    parsed: parsed,
    parse_ok: parseOk,
    latency_ms: latencyMs
  };

  existingMap.set(cu.cu_id, resultObj);
  fs.writeFileSync(outPath, Array.from(existingMap.values()).map(r => JSON.stringify(r)).join('\n'), 'utf-8');

  return resultObj;
}

async function main() {
  const results = [];
  for (let i = 0; i < samples.length; i++) {
    const res = await callRealModel(samples[i], i);
    results.push(res);
  }

  console.log(`\n✅ 50 条真实大模型推理已全部完成并持久化至 ${outPath}！`);

  console.log('\n📊 正在执行 Benchmark 自动化对齐评估...');
  const validPreds = results.filter(r => r.parsed !== null).map(r => r.parsed);
  const report = evaluatePredictions(validPreds);

  const reportPath = 'data/eval/harness_report_50.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✅ 最新评测报告已保存至 ${reportPath}！`);
}

main();
