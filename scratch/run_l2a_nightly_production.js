import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { cleanAndNormalizeEnvelope } from './post_processor.js';
import { getDb, initDb } from '../database.js';

dotenv.config();
initDb();
const db = getDb();

console.log('====================================================');
console.log('🌙 L2a 广播频道 1195 组真实夜跑生产流水线 (Nightly Pipeline)');
console.log('====================================================\n');

// 1. 读取 Prompt v3
const promptPath = 'data/prompts/semantic_extract_prompt_v3.md';
if (!fs.existsSync(promptPath)) {
  console.error(`❌ 缺少 Prompt v3 文件: ${promptPath}`);
  process.exit(1);
}
const systemPrompt = fs.readFileSync(promptPath, 'utf-8');
const PROMPT_VERSION = 'semantic_extract_prompt_v3.md@v1';

// 2. 读取 1195 组数据集
const cuDatasetPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
if (!fs.existsSync(cuDatasetPath)) {
  console.error(`❌ 缺少 CU 数据集: ${cuDatasetPath}`);
  process.exit(1);
}
const allCus = fs.readFileSync(cuDatasetPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
console.log(`📦 成功载入广播频道 CU 总量: ${allCus.length} 组`);

// 3. 读取断点已跑记录
const outDir = 'data/runs';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outJsonlPath = path.join(outDir, 'l2a_broadcast_candidates_1195.jsonl');

const completedMap = new Map();
if (fs.existsSync(outJsonlPath)) {
  const lines = fs.readFileSync(outJsonlPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      if (obj.parse_ok) completedMap.set(obj.cu_id, obj);
    } catch (e) {}
  }
}
console.log(`🔄 断点检测: 已完成并保存记录 ${completedMap.size} 条，剩余 ${allCus.length - completedMap.size} 条待跑\n`);

// 4. 模型配置
const lmStudioUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
const modelName = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';

console.log(`🤖 推理目标服务: ${lmStudioUrl}`);
console.log(`🧠 生产加载模型: ${modelName}\n`);

// 确保候选表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS l2a_order_candidates (
    cu_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    channel_id TEXT,
    et_session TEXT,
    et_date TEXT,
    speech_act TEXT,
    actions_json TEXT,
    claims_json TEXT,
    raw_text TEXT,
    parse_ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_speech_act ON l2a_order_candidates(speech_act);
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_date ON l2a_order_candidates(et_date);
`);

// 数据库插入语句
const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO l2a_order_candidates (
    cu_id, model, prompt_version, channel_id, et_session, et_date,
    speech_act, actions_json, claims_json, raw_text, parse_ok, latency_ms, created_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

async function ensureModelWarm() {
  try {
    await fetch(`${lmStudioUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (e) {}
}

async function inferSingleCu(cu, idx) {
  const userContent = JSON.stringify({
    cu_id: cu.cu_id,
    channel: cu.channel,
    et_timestamp: cu.time?.et_date ? `${cu.time.et_date} ${cu.time.session}` : '',
    dialogue_messages: cu.dialogue_messages
  }, null, 2);

  const fullText = cu.dialogue_messages.map(m => m.text).join(' ');

  let rawText = '';
  let parsed = null;
  let parseOk = false;
  let latencyMs = 0;

  for (let retry = 0; retry < 3; retry++) {
    await ensureModelWarm();
    const tStart = Date.now();
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

      latencyMs = Date.now() - tStart;

      let jsonStr = rawText.trim();
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
      }

      const rawParsed = JSON.parse(jsonStr);
      // 经过确定性后处理清洗
      parsed = cleanAndNormalizeEnvelope(rawParsed, fullText);
      parseOk = true;
      break;

    } catch (err) {
      latencyMs = Date.now() - tStart;
      console.warn(`⚠️ [${cu.cu_id}] 推理尝试 ${retry + 1}/3 异常:`, err.message);
      rawText = `ERROR: ${err.message}`;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const resultRecord = {
    cu_id: cu.cu_id,
    model: modelName,
    prompt_version: PROMPT_VERSION,
    channel: cu.channel,
    et_date: cu.time?.et_date || '',
    et_session: cu.time?.session || '',
    raw_text: rawText,
    parsed: parsed,
    parse_ok: parseOk,
    latency_ms: latencyMs,
    created_at: Date.now()
  };

  // 1. 落盘追加写入 JSONL
  fs.appendFileSync(outJsonlPath, JSON.stringify(resultRecord) + '\n', 'utf-8');

  // 2. 写入数据库候选表
  try {
    insertStmt.run(
      cu.cu_id,
      modelName,
      PROMPT_VERSION,
      cu.channel,
      cu.time?.session || '',
      cu.time?.et_date || '',
      parsed?.speech_act || 'noise',
      JSON.stringify(parsed?.actions || []),
      JSON.stringify(parsed?.claims || []),
      rawText,
      parseOk ? 1 : 0,
      latencyMs,
      Date.now()
    );
  } catch (e) {
    console.error(`❌ DB 写入失败 [${cu.cu_id}]:`, e.message);
  }

  completedMap.set(cu.cu_id, resultRecord);
  return resultRecord;
}

// 5. 主流水线循环
async function main() {
  const startTime = Date.now();
  let processedInThisRun = 0;

  for (let i = 0; i < allCus.length; i++) {
    const cu = allCus[i];
    if (completedMap.has(cu.cu_id)) {
      continue;
    }

    const res = await inferSingleCu(cu, i);
    processedInThisRun++;

    const numActions = res.parsed?.actions?.length || 0;
    const speechAct = res.parsed?.speech_act || 'unknown';

    if (processedInThisRun % 10 === 0 || processedInThisRun === 1) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const avgSec = elapsedSec / processedInThisRun;
      const remainingCus = allCus.length - completedMap.size;
      const etaMin = ((remainingCus * avgSec) / 60).toFixed(1);

      console.log(`🚀 [进度: ${completedMap.size}/${allCus.length}] [${cu.cu_id}] 耗时: ${res.latency_ms}ms | act: ${speechAct} | actions: ${numActions} | ETA: ~${etaMin} 分钟`);
    }

    if (completedMap.size % 100 === 0) {
      console.log(`\n📌 === CHECKPOINT: 已稳定入库 ${completedMap.size} / ${allCus.length} 组 CU ===\n`);
    }
  }

  console.log(`\n🎉 L2a 全量 1195 组夜跑已圆满完成！总入库记录: ${completedMap.size} 条！`);
}

main().catch(err => {
  console.error('💥 夜跑主进程异常中断:', err);
  process.exit(1);
});
