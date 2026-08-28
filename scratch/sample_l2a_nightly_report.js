import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🔍 L2a 夜跑结果自动化抽检与质量透视报告生成器');
console.log('====================================================\n');

const jsonlPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
if (!fs.existsSync(jsonlPath)) {
  console.error(`❌ 尚未找到夜跑输出文件: ${jsonlPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const records = lines.map(l => JSON.parse(l));

console.log(`📦 载入夜跑候选记录: ${records.length} 条\n`);

// 1. 全局统计指标
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

  if (actions.length === 0) {
    emptyActionsCount++;
    // 检查原文是否疑似含有买卖指令
    const raw = r.raw_text || '';
    if (/买|加|出|卖|吸|清|止损|止盈|建仓/i.test(raw)) {
      emptyActionWithTradeKeywords.push(r);
    }
  } else if (actions.length >= 2) {
    multiActionsCount++;
    multiActionSamples.push(r);
  }

  for (const a of actions) {
    const sym = a.ticker || '';
    allTickers.add(sym);
    if (!sym || sym.includes('未指定') || sym === 'NULL' || sym === 'UNKNOWN') {
      hallucinatedTickerCount++;
    }
  }
}

const parseOkRate = (parseOkCount / records.length) * 100;
const emptyActionsRate = (emptyActionsCount / records.length) * 100;
const avgLatencySec = ((totalLatencyMs / records.length) / 1000).toFixed(1);

console.log('====================================================');
console.log('📊 全局质量概览 (Global Quality Summary)');
console.log('====================================================');
console.log(`1. 总处理 CU 数量:           ${records.length} 组`);
console.log(`2. parse_ok 解析成功率:      ${parseOkRate.toFixed(1)}% (${parseOkCount}/${records.length})`);
console.log(`3. 抽取 Action 订单总数:      ${totalActionsCount} 条`);
console.log(`4. 空 actions 比例:          ${emptyActionsRate.toFixed(1)}% (${emptyActionsCount}/${records.length})`);
console.log(`5. 幻觉/无效 Ticker 数量:     ${hallucinatedTickerCount} 条`);
console.log(`6. 单条平均推理耗时:         ${avgLatencySec} 秒/条`);
console.log(`7. speech_act 分布:          ${JSON.stringify(speechActCounts)}`);
console.log('====================================================\n');

// 2. 抽样生成
function sampleArray(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

const random30 = sampleArray(records, 30);
const multi10 = sampleArray(multiActionSamples, 10);
const empty10 = sampleArray(emptyActionWithTradeKeywords, 10);

const reportObj = {
  summary: {
    totalRecords: records.length,
    parseOkRate,
    totalActionsCount,
    emptyActionsRate,
    hallucinatedTickerCount,
    avgLatencySec,
    speechActCounts
  },
  samples: {
    random_30: random30.map(r => ({ cu_id: r.cu_id, act: r.parsed?.speech_act, actions: r.parsed?.actions, raw_text: r.raw_text?.slice(0, 120) })),
    multi_action_10: multi10.map(r => ({ cu_id: r.cu_id, actions_count: r.parsed?.actions?.length, actions: r.parsed?.actions, raw_text: r.raw_text?.slice(0, 120) })),
    empty_action_with_trade_words_10: empty10.map(r => ({ cu_id: r.cu_id, raw_text: r.raw_text?.slice(0, 150) }))
  }
};

const outReportPath = 'data/runs/l2a_nightly_sampling_report.json';
fs.writeFileSync(outReportPath, JSON.stringify(reportObj, null, 2), 'utf-8');
console.log(`✅ 抽检报告已生成至: ${outReportPath}`);
