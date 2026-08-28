import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🧹 L2a 广播频道 1,195 全量候选集 5 步确定性后处理清洗引擎');
console.log('====================================================\n');

const rawCandidatesPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
const sourceCuPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const outCleanedPath = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const outLeaksPath = 'data/runs/l2a_empty_but_has_fill_verb.jsonl';

const lines = fs.readFileSync(rawCandidatesPath, 'utf-8').trim().split('\n').filter(Boolean);
const records = lines.map(l => JSON.parse(l));

// 载入源对话文本
const sourceTextMap = new Map();
if (fs.existsSync(sourceCuPath)) {
  const sLines = fs.readFileSync(sourceCuPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const sl of sLines) {
    const sObj = JSON.parse(sl);
    const msgs = sObj.dialogue_messages || [];
    const fullText = msgs.map(m => m.text).filter(Boolean).join('\n');
    sourceTextMap.set(sObj.cu_id, fullText);
  }
}

console.log(`📦 载入全量候选记录: ${records.length} 条 | 源对话映射: ${sourceTextMap.size} 条\n`);

// 规则字典
const TICKER_MAP = {
  'TSSL': 'TSLL',
  'CFIR': 'CIFR',
  'WEINU': 'BULL',
  'WEIN': 'BULL',
  '微牛': 'BULL',
  'BRK-B': 'BRK.B',
  'BRKB': 'BRK.B'
};

const DROP_TICKERS = new Set([
  'QQQV', 'RKLBOPT', 'TSLA_CALL', 'INTC_CALL', 'OTHER_STOCKS',
  '82HOOD', 'SPACEX', '未提供', '币', '币预警', 'A股港股', 'GREEN1', 'STOCK', 'CALL', 'PUT'
]);

const ETF_2X_SET = new Set([
  'TSLL', 'NVDL', 'SOXL', 'FBL', 'MSFL', 'AMZU', 'CONL', 'MSTX', 'NFXL', 'TQQQ', 'SQQQ', 'LABU', 'LABD', 'DPST', 'YINN', 'YANG'
]);

const PLANNED_TRIGGERS = [
  '可以', '挂', '注意', '打算', '如果', '跌破', '探底', '附近再', '看看再', '等', '破了', '触及', '博弈', '设置'
];

const FILLED_TRIGGERS = [
  '加了', '出了', '开了', '买了', '卖了', '减了', '止损了', '平了', '接回了', '已出', '已买', '已加'
];

let tickerRemappedCount = 0;
let tickerDroppedCount = 0;
let filledDowngradedCount = 0;
let instrumentNormalizedCount = 0;
let holdClaimsConvertedCount = 0;
const leakRecords = [];
const cleanedRecords = [];

for (const r of records) {
  const cuId = r.cu_id;
  const srcText = sourceTextMap.get(cuId) || '';
  const parsed = r.parsed ? JSON.parse(JSON.stringify(r.parsed)) : { speech_act: 'unknown', actions: [], claims: [] };
  const rawActions = parsed.actions || [];
  const cleanedActions = [];
  const claims = parsed.claims || [];

  for (const act of rawActions) {
    let t = (act.ticker || '').trim();

    // 1. Ticker 映射与去假
    // 特殊情况：原文是 tsll，模型抽成了 TSLA -> 纠偏为 TSLL
    if (t === 'TSLA' && (srcText.toLowerCase().includes('tsll') || act.condition?.toLowerCase().includes('tsll'))) {
      t = 'TSLL';
      tickerRemappedCount++;
    } else if (TICKER_MAP[t]) {
      t = TICKER_MAP[t];
      tickerRemappedCount++;
    }

    if (!t || DROP_TICKERS.has(t) || t === 'null' || /[^A-Z\.\-]/.test(t)) {
      tickerDroppedCount++;
      continue; // 丢弃假代码
    }
    act.ticker = t;

    // 2. 状态判定与强制降级 (filled vs planned)
    let currentStatus = act.status || 'planned';
    if (currentStatus === 'confirmed') currentStatus = 'planned'; // 非标状态降级

    const cond = (act.condition || '').toLowerCase();
    const isExplicitFill = FILLED_TRIGGERS.some(kw => srcText.includes(kw) || cond.includes(kw));
    const isExplicitPlanned = PLANNED_TRIGGERS.some(kw => cond.includes(kw) || srcText.includes(kw));

    if (currentStatus === 'filled') {
      if (isExplicitPlanned && !isExplicitFill) {
        act.status = 'planned';
        filledDowngradedCount++;
      }
    } else {
      act.status = 'planned';
    }

    // 3. instrument 归一化
    if (act.instrument === 'stock' || !act.instrument) {
      if (ETF_2X_SET.has(act.ticker)) {
        act.instrument = 'etf_2x';
      } else {
        act.instrument = 'equity';
      }
      instrumentNormalizedCount++;
    }

    // 4. HOLD 观察单移入 claims
    if (act.action === 'HOLD' && (act.price == null || cond.includes('观察') || cond.includes('决定') || cond.includes('支撑') || cond.includes('前低'))) {
      claims.push(`观察位: ${act.ticker} ${act.price || ''} ${cond}`.trim());
      holdClaimsConvertedCount++;
      continue;
    }

    cleanedActions.push(act);
  }

  parsed.actions = cleanedActions;
  parsed.claims = claims;

  // 5. 漏抽窗口检测 (原文有强买卖动词但 actions 为空)
  const hasFillVerb = FILLED_TRIGGERS.some(kw => srcText.includes(kw)) || srcText.includes('减仓') || srcText.includes('加仓') || srcText.includes('出') || srcText.includes('买');
  if (cleanedActions.length === 0 && hasFillVerb && (parsed.speech_act === 'trade_action' || parsed.speech_act === 'market_view')) {
    leakRecords.push({
      cu_id: cuId,
      speech_act: parsed.speech_act,
      source_text: srcText,
      model_raw_response: r.raw_text
    });
  }

  r.parsed = parsed;
  cleanedRecords.push(r);
}

// 写入清洗后的数据集与漏抽清单
fs.writeFileSync(outCleanedPath, cleanedRecords.map(r => JSON.stringify(r)).join('\n'), 'utf-8');
fs.writeFileSync(outLeaksPath, leakRecords.map(r => JSON.stringify(r)).join('\n'), 'utf-8');

console.log('====================================================');
console.log('📊 5 步确定性后处理清洗完成看板 (Cleaning Scorecard)');
console.log('====================================================');
console.log(`1. Ticker 映射修复 (如 TSSL->TSLL, tsll纠偏):    ${tickerRemappedCount} 处`);
console.log(`2. 假/非标 Ticker 剔除 (如 QQQV, RKLBOPT, WEINU):  ${tickerDroppedCount} 处`);
console.log(`3. planned 强制降级 (含可以/挂/注意等误标filled):   ${filledDowngradedCount} 处`);
console.log(`4. instrument 归一化 (stock -> equity / etf_2x): ${instrumentNormalizedCount} 处`);
console.log(`5. 模糊 HOLD 观察位转入 claims:                 ${holdClaimsConvertedCount} 处`);
console.log(`6. 识别出待二次抽取的漏抽窗口 (含买卖动词):       ${leakRecords.length} 处`);
console.log(`----------------------------------------------------`);
console.log(`💾 清洗后全量产物: ${outCleanedPath} (${cleanedRecords.length} 条)`);
console.log(`💾 漏抽待修清单:   ${outLeaksPath} (${leakRecords.length} 条)`);
console.log('====================================================\n');
