import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🧹 L2a 广播候选集 V1.1 精准补漏清洗引擎');
console.log('====================================================\n');

const rawCandidatesPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
const sourceCuPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const outCleanedPath = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const outHardLeaksPath = 'data/runs/l2a_empty_tier1_hard_fills.jsonl';
const outHintLeaksPath = 'data/runs/l2a_empty_tier2_planned_hints.jsonl';

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

const PLANNED_SUBSTRINGS = [
  '可以', '挂', '注意', '打算', '如果', '跌破', '探底', '附近再', '看看再', '等', '破了', '触及', '博弈', '设置', '转弯', '冲高'
];

const HARD_FILL_VERBS = [
  '加了', '出了', '开了', '买了', '卖了', '减了', '止损了', '平了', '接回了', '已出', '已买', '已加', '吸回了'
];

let tickerRemappedCount = 0;
let tickerDroppedCount = 0;
let filledDowngradedCount = 0;
let instrumentFixedCount = 0;
let holdClaimsConvertedCount = 0;
const tier1HardLeaks = [];
const tier2HintLeaks = [];
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

    // 1. Ticker 修复
    if (t === 'TSLA' && (srcText.toLowerCase().includes('tsll') || act.condition?.toLowerCase().includes('tsll'))) {
      t = 'TSLL';
      tickerRemappedCount++;
    } else if (TICKER_MAP[t]) {
      t = TICKER_MAP[t];
      tickerRemappedCount++;
    }

    // 针对 00764 这种原文根本没提 SPY 却多出的幻觉单剔除
    if (t === 'SPY' && !srcText.toUpperCase().includes('SPY')) {
      tickerDroppedCount++;
      continue;
    }

    if (!t || DROP_TICKERS.has(t) || t === 'null' || /[^A-Z\.\-]/.test(t)) {
      tickerDroppedCount++;
      continue;
    }
    act.ticker = t;

    // 2. 状态强降级 (含后置可以/注意/转弯)
    const cond = (act.condition || '').toLowerCase();
    const hasHardVerb = HARD_FILL_VERBS.some(v => srcText.includes(v) || cond.includes(v));
    const hasPlannedSub = PLANNED_SUBSTRINGS.some(p => cond.includes(p) || srcText.includes(p));

    if (act.status === 'filled') {
      // 只要包含计划/条件关键词，且没有明确的硬成交动词修饰该动作，强制降级
      if (hasPlannedSub && !hasHardVerb) {
        act.status = 'planned';
        filledDowngradedCount++;
      } else if (cond.includes('可以') || cond.includes('注意') || cond.includes('转弯') || cond.includes('挂')) {
        act.status = 'planned';
        filledDowngradedCount++;
      }
    } else {
      act.status = 'planned';
    }

    // 3. instrument 强约束 (2x ETF 强制为 etf_2x)
    if (ETF_2X_SET.has(act.ticker) && !cond.includes('call') && !cond.includes('put') && !cond.includes('期权')) {
      act.instrument = 'etf_2x';
      instrumentFixedCount++;
    } else if (act.instrument === 'stock' || !act.instrument) {
      act.instrument = 'equity';
      instrumentFixedCount++;
    }

    // 4. HOLD 观察位降级为 claims
    if (act.action === 'HOLD' && (act.price == null || cond.includes('观察') || cond.includes('决定') || cond.includes('支撑') || cond.includes('前低') || cond.includes('点位'))) {
      claims.push(`观察位: ${act.ticker} ${act.price || ''} ${cond}`.trim());
      holdClaimsConvertedCount++;
      continue;
    }

    cleanedActions.push(act);
  }

  parsed.actions = cleanedActions;
  parsed.claims = claims;

  // 5. 漏抽窗口分级捕获 (包含 00955 等)
  if (cleanedActions.length === 0) {
    const isHardFill = HARD_FILL_VERBS.some(v => srcText.includes(v));
    const isHintPlanned = srcText.includes('买') || srcText.includes('出') || srcText.includes('减仓') || srcText.includes('加仓') || srcText.includes('吸回');

    if (isHardFill) {
      tier1HardLeaks.push({
        cu_id: cuId,
        speech_act: parsed.speech_act,
        source_text: srcText,
        reason: "包含明确硬成交动词但模型 actions 为空"
      });
    } else if (isHintPlanned) {
      tier2HintLeaks.push({
        cu_id: cuId,
        speech_act: parsed.speech_act,
        source_text: srcText,
        reason: "包含意图词/口诀但无成交动词"
      });
    }
  }

  r.parsed = parsed;
  cleanedRecords.push(r);
}

// 写入文件
fs.writeFileSync(outCleanedPath, cleanedRecords.map(r => JSON.stringify(r)).join('\n'), 'utf-8');
fs.writeFileSync(outHardLeaksPath, tier1HardLeaks.map(r => JSON.stringify(r)).join('\n'), 'utf-8');
fs.writeFileSync(outHintLeaksPath, tier2HintLeaks.map(r => JSON.stringify(r)).join('\n'), 'utf-8');

// 删除探测文件
if (fs.existsSync('scratch/grok_write_probe.md')) {
  fs.unlinkSync('scratch/grok_write_probe.md');
}

console.log('====================================================');
console.log('📊 V1.1 精准清洗完成看板 (Scorecard)');
console.log('====================================================');
console.log(`1. Ticker 映射与修复:          ${tickerRemappedCount} 处`);
console.log(`2. 假 Ticker / 虚假单剔除:     ${tickerDroppedCount} 处`);
console.log(`3. planned 彻底降级:           ${filledDowngradedCount} 处`);
console.log(`4. instrument 强约束规范:      ${instrumentFixedCount} 处`);
console.log(`5. 模糊 HOLD 降级为 claims:    ${holdClaimsConvertedCount} 处`);
console.log(`6. Tier 1 硬动词漏抽窗口:      ${tier1HardLeaks.length} 条 (含 00955 精准捕获)`);
console.log(`7. Tier 2 口诀/计划漏抽窗口:   ${tier2HintLeaks.length} 条`);
console.log(`----------------------------------------------------`);
console.log(`💾 最终清洗候选集: ${outCleanedPath} (${cleanedRecords.length} 条)`);
console.log(`💾 Tier 1 硬漏抽表: ${outHardLeaksPath} (${tier1HardLeaks.length} 条)`);
console.log('====================================================\n');
