import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🔍 L2a 广播频道夜跑 50 条三层确定性抽检与体检报告生成器');
console.log('====================================================\n');

// 1. 读取原始 CU 库以获取真实源对话
const cuDatasetPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const cuSourceMap = new Map();
if (fs.existsSync(cuDatasetPath)) {
  const cuLines = fs.readFileSync(cuDatasetPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const l of cuLines) {
    try {
      const cuObj = JSON.parse(l);
      const fullText = cuObj.dialogue_messages ? cuObj.dialogue_messages.map(m => m.text).join(' ') : '';
      cuSourceMap.set(cuObj.cu_id, {
        cu_id: cuObj.cu_id,
        source_text: fullText,
        dialogue: cuObj.dialogue_messages,
        time: cuObj.time
      });
    } catch (e) {}
  }
}

// 2. 读取当前已跑记录
const jsonlPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
if (!fs.existsSync(jsonlPath)) {
  console.error(`❌ 尚未找到夜跑输出文件: ${jsonlPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const records = lines.map(l => JSON.parse(l));

console.log(`📦 载入夜跑候选记录: ${records.length} 条\n`);

// 3. 全局统计指标
let parseOkCount = 0;
let totalActionsCount = 0;
let emptyActionsCount = 0;
let multiActionsCount = 0;
let hallucinatedTickerCount = 0;
let totalLatencyMs = 0;

const speechActCounts = {};
const allTickers = new Set();
const multiActionSamples = [];
const emptyActionWithTradeKeywords = [];

for (const r of records) {
  if (r.parse_ok) parseOkCount++;
  totalLatencyMs += (r.latency_ms || 0);

  const act = r.parsed?.speech_act || 'unknown';
  speechActCounts[act] = (speechActCounts[act] || 0) + 1;

  const actions = r.parsed?.actions || [];
  totalActionsCount += actions.length;

  const sourceInfo = cuSourceMap.get(r.cu_id);
  const srcText = sourceInfo?.source_text || '';

  if (actions.length === 0) {
    emptyActionsCount++;
    // 关键修正：比对真实源对话文本，而不是模型的 raw_text
    if (/买|加|出|卖|吸|清|止损|止盈|建仓|平仓|捞/i.test(srcText)) {
      emptyActionWithTradeKeywords.push({ ...r, source_text: srcText });
    }
  } else if (actions.length >= 2) {
    multiActionsCount++;
    multiActionSamples.push({ ...r, source_text: srcText });
  }

  for (const a of actions) {
    const sym = a.ticker || '';
    allTickers.add(sym);
    if (!sym || sym.includes('未指定') || sym === 'NULL' || sym === 'UNKNOWN') {
      hallucinatedTickerCount++;
    }
  }
}

const parseOkRate = records.length > 0 ? (parseOkCount / records.length) * 100 : 0;
const emptyActionsRate = records.length > 0 ? (emptyActionsCount / records.length) * 100 : 0;
const avgLatencySec = records.length > 0 ? ((totalLatencyMs / records.length) / 1000).toFixed(1) : '0';

console.log('====================================================');
console.log('📊 全局质量看板 (Global Quality Scorecard)');
console.log('====================================================');
console.log(`1. 总处理 CU 数量:           ${records.length} 组`);
console.log(`2. parse_ok 解析成功率:      ${parseOkRate.toFixed(1)}% (${parseOkCount}/${records.length}) -> ${parseOkRate >= 99.5 ? '✅ PASS' : '⚠️ 需关注'}`);
console.log(`3. 抽取 Action 订单总数:      ${totalActionsCount} 条`);
console.log(`4. 空 actions 比例:          ${emptyActionsRate.toFixed(1)}% (${emptyActionsCount}/${records.length})`);
console.log(`5. 幻觉/无效 Ticker 数量:     ${hallucinatedTickerCount} 条 -> ${hallucinatedTickerCount === 0 ? '✅ PASS (零幻觉)' : '❌ FAIL'}`);
console.log(`6. 单条平均推理耗时:         ${avgLatencySec} 秒/条`);
console.log(`7. speech_act 分布:          ${JSON.stringify(speechActCounts)}`);
console.log('====================================================\n');

// 4. 确定性哈希采样函数 (可复现)
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

function deterministicSample(arr, n) {
  const sorted = [...arr].sort((a, b) => {
    const ha = hashString(a.cu_id || '');
    const hb = hashString(b.cu_id || '');
    return ha - hb;
  });
  return sorted.slice(0, n);
}

const sampleRandom30 = deterministicSample(records, 30);
const sampleMulti10 = deterministicSample(multiActionSamples, 10);
const sampleEmpty10 = deterministicSample(emptyActionWithTradeKeywords, 10);

const outReport = {
  summary: {
    totalRecords: records.length,
    parseOkRate,
    totalActionsCount,
    emptyActionsRate,
    hallucinatedTickerCount,
    avgLatencySec,
    speechActCounts
  },
  layers: {
    layer1_random_30: sampleRandom30.map(r => {
      const src = cuSourceMap.get(r.cu_id)?.source_text || '';
      return {
        cu_id: r.cu_id,
        layer: 'random_30',
        source_text: src.slice(0, 120),
        pred_speech_act: r.parsed?.speech_act,
        pred_actions: r.parsed?.actions,
        reconcile_ready: (r.parsed?.actions?.length > 0) ? 'YES' : 'NO'
      };
    }),
    layer2_multi_10: sampleMulti10.map(r => {
      const src = cuSourceMap.get(r.cu_id)?.source_text || '';
      return {
        cu_id: r.cu_id,
        layer: 'multi_10',
        actions_count: r.parsed?.actions?.length,
        source_text: src.slice(0, 120),
        pred_speech_act: r.parsed?.speech_act,
        pred_actions: r.parsed?.actions,
        reconcile_ready: 'YES'
      };
    }),
    layer3_empty_with_trade_keywords_10: sampleEmpty10.map(r => {
      const src = cuSourceMap.get(r.cu_id)?.source_text || '';
      return {
        cu_id: r.cu_id,
        layer: 'empty_trade_keywords_10',
        source_text: src.slice(0, 150),
        pred_speech_act: r.parsed?.speech_act,
        pred_actions: [],
        note: '源文本含买/卖/吸但模型判空，待核实是否为纯分析/口诀'
      };
    })
  }
};

const outReportPath = 'data/runs/l2a_nightly_sampling_report.json';
fs.writeFileSync(outReportPath, JSON.stringify(outReport, null, 2), 'utf-8');
console.log(`✅ 50 条三层确定性抽检报告已生成至: ${outReportPath}！`);
