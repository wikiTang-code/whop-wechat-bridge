import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { evaluatePredictions } from '../data/eval/eval_harness.js';

dotenv.config();

console.log('====================================================');
console.log('🚀 在 VM 生产环境执行 50 条 Benchmark 真实推理 (断点续跑 + 180s超时)');
console.log('====================================================\n');

// 1. 读取 Prompt v2 和 V2 评测样本
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

// 读取已存在的预测文件实现断点续跑
const outPath = 'data/eval/preds_35b_50.jsonl';
const existingMap = new Map();
if (fs.existsSync(outPath)) {
  const exLines = fs.readFileSync(outPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const line of exLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.parse_ok === true) {
        existingMap.set(obj.cu_id, obj);
      }
    } catch (e) {}
  }
}
console.log(`🔄 已成功复用历史有效预测: ${existingMap.size} 条，继续补跑剩余样本...\n`);

// 2. 真实模型调用函数 (temperature=0, timeout=180s)
async function callRealModel(cu, idx) {
  if (existingMap.has(cu.cu_id)) {
    const cached = existingMap.get(cu.cu_id);
    console.log(`[${idx + 1}/50] [${cu.cu_id}] (复用已完成) 耗时: ${cached.latency_ms}ms | Parse: ✅ OK`);
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
      signal: AbortSignal.timeout(180000) // 提升至 3 分钟超时
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    rawText = resJson.choices?.[0]?.message?.content || '';

    // 去除 thinking 标签
    rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  } catch (err) {
    console.error(`❌ [${cu.cu_id}] 推理异常:`, err.message);
    rawText = `ERROR: ${err.message}`;
  }

  const latencyMs = Date.now() - tStart;

  // 尝试解析 JSON
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
  // 实时增量持久化
  fs.writeFileSync(outPath, Array.from(existingMap.values()).map(r => JSON.stringify(r)).join('\n'), 'utf-8');

  return resultObj;
}

// 3. 逐条执行
async function main() {
  const results = [];
  for (let i = 0; i < samples.length; i++) {
    const res = await callRealModel(samples[i], i);
    results.push(res);
  }

  console.log(`\n✅ 50 条真实大模型推理已全部完成并持久化至 ${outPath}！`);

  // 4. 运行 Harness 评测打分
  console.log('\n📊 正在执行 Benchmark 自动化对齐评估...');
  const validPreds = results.filter(r => r.parsed !== null).map(r => r.parsed);
  const report = evaluatePredictions(validPreds);

  // 5. 保存评测报告
  const reportPath = 'data/eval/harness_report_50.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✅ 最新评测报告已保存至 ${reportPath}！`);
}

main();
