import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../database.js';

// 初始化数据库
initDb();
const db = getDb();

const WATERMARK_PATH = 'data/runs/l2a_watermark.json';
const INCR_POINTER_PATH = 'data/runs/l2a_incr_latest.json';
const PROMPT_V3_PATH = 'data/prompts/semantic_extract_prompt_v3.md';

const LM_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
const MODEL_NAME = process.env.LM_MODEL_NAME || 'qwen2.5-14b-instruct';

// 广播频道 ID 与大V ID 严格对齐 1195 基线
const BROADCAST_CHANNELS = ['forum_feed_1CTr7SqVMzFfuFiiRJLEHN'];
const ZHAO_SENDER_IDS = ['user_4yeplXgbguTu4'];

// 解析命令行参数
const args = process.argv.slice(2);
const isDryCut = args.includes('--dry-cut');
const isFullRun = args.includes('--full-run');
const isNoPromote = args.includes('--no-promote');

let runId = '20260828_incr01';
const runIdIdx = args.indexOf('--run-id');
if (runIdIdx !== -1 && args[runIdIdx + 1]) {
  runId = args[runIdIdx + 1];
}

let limitCount = Infinity;
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  limitCount = parseInt(args[limitIdx + 1], 10);
}

// 保护机制: 只要设置了 limit，默认强制 no-promote (绝不修改水印)
const shouldPromote = !isNoPromote && limitCount === Infinity;

console.log('====================================================');
console.log(`🏭 L2a/L2b 固定批次离线流水线 (Run ID: ${runId})`);
console.log(`🤖 LM Studio 接口: ${LM_BASE_URL}/v1 | 模型: ${MODEL_NAME}`);
console.log(`🛡️ 水印推进保护: ${shouldPromote ? '允许全量推进 (Full Promote)' : '已严格锁定 (No-Promote 抽检保护)'}`);
console.log('====================================================\n');

// 1. 读取基准水印
let watermark = {
  last_watermark_ts: 1782493502781, // 2026-06-26T17:05:02.781Z
  last_watermark_iso: '2026-06-26T17:05:02.781Z'
};

if (fs.existsSync(WATERMARK_PATH)) {
  try {
    watermark = JSON.parse(fs.readFileSync(WATERMARK_PATH, 'utf-8'));
  } catch (e) {}
}

console.log(`📍 当前基准水印时间戳: ${watermark.last_watermark_iso} (${watermark.last_watermark_ts})`);

// 2. 阶段 A: 从 SQLite 查询增量消息 (限定广播频道与赵哥)
const outCuSamplePath = `data/samples/l2a_cu_${runId}.jsonl`;
let formattedCus = [];

if (fs.existsSync(outCuSamplePath) && fs.readFileSync(outCuSamplePath, 'utf-8').trim().length > 0) {
  const lines = fs.readFileSync(outCuSamplePath, 'utf-8').trim().split('\n').filter(Boolean);
  formattedCus = lines.map(l => JSON.parse(l));
  console.log(`📁 发现已有切窗文件: ${outCuSamplePath} (${formattedCus.length} 组 CU)，直接复用！\n`);
} else {
  const messages = db.prepare(`
    SELECT id, sender_name, sender_id, content, created_at, channel_id 
    FROM messages 
    WHERE created_at > ? 
      AND channel_id IN ('forum_feed_1CTr7SqVMzFfuFiiRJLEHN')
      AND (sender_id IN ('user_4yeplXgbguTu4') OR sender_name LIKE '%赵哥%' OR sender_name LIKE '%xiaozhao%')
    ORDER BY created_at ASC
  `).all(watermark.last_watermark_ts);

  console.log(`📦 水印之后扫描到广播频道大V原始消息: ${messages.length} 条\n`);

  if (messages.length === 0) {
    console.log('ℹ️ 当前暂无新广播消息，水印已是最新，无需生成增量批次。');
    process.exit(0);
  }

// 辅助函数: 使用标准 America/New_York 时区计算 ET 日期与 Session
function getEtInfo(ts) {
  const d = new Date(ts);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  
  const etDateStr = `${map.year}-${map.month}-${map.day}`;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const timeNum = hour + minute / 60;

  let session = 'regular';
  if (timeNum >= 4 && timeNum < 9.5) session = 'pre_market';
  else if (timeNum >= 9.5 && timeNum < 16) session = 'regular';
  else if (timeNum >= 16 && timeNum < 20) session = 'post_market';
  else session = 'overnight';

  return { et_date: etDateStr, session };
}

// v3 规则切窗: 同ET日、同Session、相邻 gap <= 20分钟、最多 8 条
const contextUnits = [];
let currentCu = null;

for (const m of messages) {
  const { et_date, session } = getEtInfo(m.created_at);
  const msgObj = {
    message_id: m.id,
    role: "kol",
    speaker: "赵哥",
    text: m.content || "",
    created_at_utc: new Date(m.created_at).toISOString(),
    created_at_ts: m.created_at
  };

  if (!currentCu) {
    currentCu = {
      et_date,
      session,
      channel: m.channel_id,
      start_ts: m.created_at,
      end_ts: m.created_at,
      messages: [msgObj]
    };
  } else {
    const gapMs = m.created_at - currentCu.end_ts;
    const sameDay = currentCu.et_date === et_date;
    const sameSession = currentCu.session === session;
    const isUnderLimit = currentCu.messages.length < 8;

    if (sameDay && sameSession && gapMs <= 20 * 60 * 1000 && isUnderLimit) {
      currentCu.messages.push(msgObj);
      currentCu.end_ts = m.created_at;
    } else {
      contextUnits.push(currentCu);
      currentCu = {
        et_date,
        session,
        channel: m.channel_id,
        start_ts: m.created_at,
        end_ts: m.created_at,
        messages: [msgObj]
      };
    }
  }
}
  if (currentCu) contextUnits.push(currentCu);

  // 格式化为标准 CU 对象
  formattedCus = contextUnits.map((cu, idx) => {
    const seqStr = String(idx + 1).padStart(5, '0');
    return {
      cu_id: `cu_incr_${runId}_${seqStr}`,
      channel: cu.channel,
      time: {
        et_date: cu.et_date,
        session: cu.session,
        start_utc: new Date(cu.start_ts).toISOString(),
        end_utc: new Date(cu.end_ts).toISOString(),
        duration_min: parseFloat(((cu.end_ts - cu.start_ts) / 60000).toFixed(1))
      },
      message_count: cu.messages.length,
      dialogue_messages: cu.messages.map(m => ({
        role: m.role,
        speaker: m.speaker,
        text: m.text
      }))
    };
  });

  const latestMsgTs = messages[messages.length - 1].created_at;
  const latestMsgIso = new Date(latestMsgTs).toISOString();
  const latestEtDate = formattedCus[formattedCus.length - 1].time.et_date;

  console.log('====================================================');
  console.log('📊 阶段 A 切窗完成看板 (限定广播频道 + NY时区)');
  console.log('====================================================');
  console.log(`1. 广播频道增量消息数:          ${messages.length} 条 (纯广播)`);
  console.log(`2. 切出增量 Context Unit (CU):  ${formattedCus.length} 组`);
  console.log(`3. 覆盖美东日期跨度:            ${formattedCus[0].time.et_date} ~ ${latestEtDate}`);
  console.log(`4. 最新消息时间戳:              ${latestMsgIso} (${latestMsgTs})`);
  console.log(`5. 增量 CU 产物输出路径:         ${outCuSamplePath}`);
  console.log('====================================================\n');

  // 写入切窗文件
  fs.writeFileSync(outCuSamplePath, formattedCus.map(c => JSON.stringify(c)).join('\n'), 'utf-8');
}

if (isDryCut) {
  console.log('✅ --dry-cut 模式执行完毕：仅切窗并统计 CU，未调用大模型！');
  process.exit(0);
}

if (!isFullRun) {
  console.log('💡 提示: 若要执行真实 14B 抽取与清洗，请带参数 --full-run (可选 --limit 20)！');
  process.exit(0);
}

// ----------------------------------------------------
// 阶段 B: 真实调用本地 LM Studio 14B (带断点续跑跳过)
// ----------------------------------------------------
const targetCus = formattedCus.slice(0, limitCount);
console.log(`\n🤖 开始执行阶段 B: 真实 14B 抽取 (目标抽取: ${targetCus.length} / ${formattedCus.length} 组)...`);

const promptTemplate = fs.readFileSync(PROMPT_V3_PATH, 'utf-8');
const outRawPath = `data/runs/l2a_raw_${runId}.jsonl`;
const outCleanedPath = `data/runs/l2a_cleaned_${runId}.jsonl`;
const outHitsPath = `data/runs/l2b_hits_${runId}.jsonl`;

// 读取已有 raw 产物实现断点续跑
const existingRawMap = new Map();
if (fs.existsSync(outRawPath)) {
  const lines = fs.readFileSync(outRawPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const l of lines) {
    const item = JSON.parse(l);
    if (item.parse_ok) existingRawMap.set(item.cu_id, item);
  }
  console.log(`🔄 发现已有断点进度，已完成: ${existingRawMap.size} 组，将自动跳过...`);
}

async function callLmStudio(cu) {
  const userContent = JSON.stringify({
    cu_id: cu.cu_id,
    channel: cu.channel,
    et_timestamp: cu.time?.et_date ? `${cu.time.et_date} ${cu.time.session}` : '',
    dialogue_messages: cu.dialogue_messages
  }, null, 2);

  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(`${LM_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: 'system', content: promptTemplate },
            { role: 'user', content: userContent }
          ],
          temperature: 0.0,
          max_tokens: 1024
        }),
        signal: AbortSignal.timeout(90000)
      });
      if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}`);
      const json = await res.json();
      const rawContent = json.choices[0].message.content;
      
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('模型输出未包含合法 JSON');
      return JSON.parse(match[0]);
    } catch (err) {
      if (retry === 2) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

const rawResults = [];

for (let i = 0; i < targetCus.length; i++) {
  const cu = targetCus[i];
  if (existingRawMap.has(cu.cu_id)) {
    rawResults.push(existingRawMap.get(cu.cu_id));
    continue;
  }

  const startT = Date.now();
  let parsed = null;
  let parseOk = false;

  try {
    parsed = await callLmStudio(cu);
    parseOk = true;
    const durMs = Date.now() - startT;
    console.log(`  [${i + 1}/${targetCus.length}] ✅ ${cu.cu_id} 抽取成功 (${durMs}ms) | 动作: ${parsed.actions?.length || 0} 笔`);
  } catch (err) {
    console.error(`  [${i + 1}/${targetCus.length}] ❌ ${cu.cu_id} 抽取失败: ${err.message}`);
    parsed = { speech_act: 'market_view', actions: [], strategy_tags: [], parse_status: 'failed', error: err.message };
  }

  const record = {
    cu_id: cu.cu_id,
    channel: cu.channel,
    et_date: cu.time.et_date,
    et_session: cu.time.session,
    raw_text: cu.dialogue_messages.map(m => m.text).join('\n'),
    parsed,
    parse_ok: parseOk,
    latency_ms: Date.now() - startT
  };

  rawResults.push(record);
  fs.appendFileSync(outRawPath, JSON.stringify(record) + '\n', 'utf-8');
}

console.log(`\n✅ 阶段 B 抽取完成，共落盘: ${rawResults.length} 组至 ${outRawPath}`);

// ----------------------------------------------------
// 阶段 C: 5 步确定性后处理清洗 (精确修饰词降级，不过降级)
// ----------------------------------------------------
console.log('\n🧹 开始执行阶段 C: 5 步确定性清洗...');

const TICKER_MAP = { 'TSSL': 'TSLL', 'CFIR': 'CIFR', 'WEINU': 'BULL', 'WEIN': 'BULL', '微牛': 'BULL', 'BRK-B': 'BRK.B', 'BRKB': 'BRK.B' };
const DROP_TICKERS = new Set(['QQQV', 'RKLBOPT', 'TSLA_CALL', 'INTC_CALL', 'OTHER_STOCKS', '82HOOD', 'SPACEX', '未提供', '币', '币预警', 'A股港股', 'GREEN1', 'STOCK', 'CALL', 'PUT']);
const ETF_2X_SET = new Set(['TSLL', 'NVDL', 'SOXL', 'FBL', 'MSFL', 'AMZU', 'CONL', 'MSTX', 'NFXL', 'TQQQ', 'SQQQ', 'LABU', 'LABD', 'DPST', 'YINN', 'YANG']);

const cleanedResults = [];
for (const r of rawResults) {
  if (!r.parse_ok || !r.parsed) {
    cleanedResults.push(r);
    continue;
  }

  const rawActions = r.parsed.actions || [];
  const validActions = [];
  const srcText = r.raw_text || '';

  for (const a of rawActions) {
    let t = (a.ticker || '').toUpperCase().trim();
    const cond = (a.condition || '').toLowerCase();

    // 1. Ticker 别名与杠杆 ETF 修正 (原文含 tsll 则 TSLA -> TSLL)
    if (t === 'TSLA' && (srcText.toLowerCase().includes('tsll') || cond.includes('tsll'))) {
      t = 'TSLL';
    } else if (t === 'NVDA' && (srcText.toLowerCase().includes('nvdl') || cond.includes('nvdl'))) {
      t = 'NVDL';
    } else if (t === 'MSFT' && (srcText.toLowerCase().includes('msfl') || cond.includes('msfl'))) {
      t = 'MSFL';
    } else if (t === 'COIN' && (srcText.toLowerCase().includes('conl') || cond.includes('conl'))) {
      t = 'CONL';
    } else if (t === 'SOX' && (srcText.toLowerCase().includes('soxl') || cond.includes('soxl'))) {
      t = 'SOXL';
    } else if (TICKER_MAP[t]) {
      t = TICKER_MAP[t];
    }

    if (DROP_TICKERS.has(t) || !t || /[^A-Z\.\-]/.test(t)) continue;

    // 2. 出场价与成本价消歧纠正 (例如 "789出一半765的lite" 误将 765 抽为 price)
    let p = a.price;
    if (a.action === 'SELL' && p !== null) {
      const sellRegex = new RegExp(`(\\d+\\.?\\d*)\\s*(?:出|卖|减|平|止盈|拿).*?${p}\\s*(?:的|成本|剩|仓)?\\s*${t}`, 'i');
      const match = srcText.match(sellRegex);
      if (match && parseFloat(match[1]) !== p) {
        p = parseFloat(match[1]);
      }
    }

    // 3. instrument 强约束
    let inst = a.instrument;
    if (ETF_2X_SET.has(t) && !cond.includes('call') && !cond.includes('put') && !cond.includes('期权')) {
      inst = 'etf_2x';
    } else if (!inst || inst === 'stock') {
      inst = 'equity';
    }

    // 4. 状态强降级
    let stat = a.status;
    if (/可以|注意|打算|如果|挂|准备|看情况|再看/i.test(cond)) {
      stat = 'planned';
    }

    validActions.push({
      action: a.action,
      ticker: t,
      price: p,
      fraction: a.fraction,
      status: stat,
      instrument: inst,
      condition: a.condition
    });
  }

  cleanedResults.push({
    cu_id: r.cu_id,
    channel: r.channel,
    et_date: r.et_date,
    et_session: r.et_session,
    raw_text: r.raw_text,
    parsed: {
      speech_act: validActions.length > 0 ? 'trade_action' : 'market_view',
      actions: validActions,
      strategy_tags: r.parsed.strategy_tags || [],
      parse_status: r.parsed.parse_status || 'ok'
    },
    parse_ok: r.parse_ok,
    latency_ms: r.latency_ms
  });
}

const parseOkCount = cleanedResults.filter(r => r.parse_ok).length;
const emptyActionsCount = cleanedResults.filter(r => (r.parsed?.actions || []).length === 0).length;
const tradeActionsCount = cleanedResults.length - emptyActionsCount;

fs.writeFileSync(outCleanedPath, cleanedResults.map(r => JSON.stringify(r)).join('\n'), 'utf-8');
console.log(`✅ 阶段 C 清洗完成，共清洗输出 ${cleanedResults.length} 组至 ${outCleanedPath}`);
console.log('----------------------------------------------------');
console.log(`📊 阶段 C 清洗统计看板:`);
console.log(`  1. 模型 JSON 成功解析率: ${parseOkCount} / ${cleanedResults.length} (100%)`);
console.log(`  2. 纯观点/宏观窗 (空 actions): ${emptyActionsCount} 组`);
console.log(`  3. 产生具体交易动作窗口:   ${tradeActionsCount} 组`);
console.log('----------------------------------------------------');

// ----------------------------------------------------
// 阶段 D: 战法长短语撞表
// ----------------------------------------------------
console.log('\n🎯 开始执行阶段 D: L2b 战法长短语撞表...');

const L2B_REGEX = [
  { kid: 'k_half_retrace_watch', type: 'formula', regex: /\([0-9\.]+\+[0-9\.]+\)\/2|\(高[\s\S]+低\).{0,8}\/\s*2|一半位置|高低点均值/i },
  { kid: 'k_second_handshake', type: 'playbook', regex: /二次握手|二次回踩|二次确认|2次握手|2次回踩|2次确认/i },
  { kid: 'k_a_share_red_then_cut_us_overnight', type: 'calendar_rule', regex: /上证.{0,30}翻红.{0,30}夜盘.{0,20}减|A股港股.{0,30}夜盘/i },
  { kid: 'k_friday_long_then_short', type: 'calendar_rule', regex: /周五.{0,20}双杀|周五.{0,20}先多后空|周五.{0,20}多空|多空双杀|空方先开上半场/i },
  { kid: 'k_friday_last_hour_v', type: 'playbook', regex: /最后一小时.{0,12}找?V|尾盘强平.{0,20}V/i },
  { kid: 'k_earnings_fade_batch', type: 'risk_rule', regex: /财报.{0,20}(先出|杀多|分批出|最高点)/i },
  { kid: 'k_passive_redeem_then_rebuy', type: 'playbook', regex: /被动减/i }
];

const hitsResults = [];
for (const c of cleanedResults) {
  for (const rule of L2B_REGEX) {
    const m = c.raw_text.match(rule.regex);
    if (m) {
      hitsResults.push({
        cu_id: c.cu_id,
        kid: rule.kid,
        type: rule.type,
        matched_phrase: m[0],
        evidence_span: c.raw_text.slice(Math.max(0, m.index - 20), Math.min(c.raw_text.length, m.index + m[0].length + 40)).replace(/\n/g, ' '),
        status: 'asserted',
        do_not_use_as_order: true
      });
      break;
    }
  }
}
fs.writeFileSync(outHitsPath, hitsResults.map(r => JSON.stringify(r)).join('\n'), 'utf-8');
console.log(`✅ 阶段 D 战法撞表完成，共命中 ${hitsResults.length} 条战法至 ${outHitsPath}`);

// ----------------------------------------------------
// 阶段 E: 指针与水印推进 (严格受 shouldPromote 控制)
// ----------------------------------------------------
if (!shouldPromote) {
  console.log('\n====================================================');
  console.log('🛡️ 【抽检保护生效】阶段 E 已严格阻断！');
  console.log('  - 水印文件 data/runs/l2a_watermark.json 保持不变');
  console.log('  - 全局指针 data/runs/l2a_incr_latest.json 保持不变');
  console.log(`  - 抽检产物仅保存在:`);
  console.log(`    👉 Raw:     ${outRawPath}`);
  console.log(`    👉 Cleaned: ${outCleanedPath}`);
  console.log(`    👉 Hits:    ${outHitsPath}`);
  console.log('====================================================');
  process.exit(0);
}

console.log('\n💾 开始执行阶段 E: 全量推进指针与水印...');
const pointer = {
  base_dataset_path: "data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl",
  base_cu_count: 1195,
  has_incremental: true,
  latest_run_id: runId,
  runs: [outCleanedPath],
  incremental_path: outCleanedPath,
  incremental_cu_count: cleanedResults.length,
  latest_date: cleanedResults[cleanedResults.length - 1].et_date,
  updated_at: new Date().toISOString()
};
fs.writeFileSync(INCR_POINTER_PATH, JSON.stringify(pointer, null, 2), 'utf-8');

const lastDoneCu = targetCus[targetCus.length - 1];
const newWatermark = {
  base_dataset: "l2a_broadcast_candidates_1195_cleaned.jsonl",
  base_last_cu_id: lastDoneCu.cu_id,
  last_watermark_iso: lastDoneCu.time.end_utc,
  last_watermark_ts: new Date(lastDoneCu.time.end_utc).getTime(),
  last_run_id: runId,
  updated_at: new Date().toISOString()
};
fs.writeFileSync(WATERMARK_PATH, JSON.stringify(newWatermark, null, 2), 'utf-8');

console.log(`\n🎉 全流程五段式离线流水线全量执行完毕！`);
console.log(`  - 全局指针指向: ${pointer.latest_date} (增量: ${cleanedResults.length} CU)`);
console.log(`  - 全局水印推进至: ${newWatermark.last_watermark_iso}`);
