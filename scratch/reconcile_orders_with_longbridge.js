import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('📊 L2a 候选订单 vs 长桥真实成交流水对账引擎 (Reconcile Engine v2)');
console.log('====================================================\n');

// 1. Ticker 别名映射（严格保护正股，只收显式错字与双倍全称）
const TICKER_ALIAS_MAP = {
  'CFIR': 'CIFR',             // 明确错别字
  '奈飞双倍': 'NFXL',
  '特斯拉双倍': 'TSLL',
  '特斯拉两倍': 'TSLL',
  '微策略双倍': 'MSTX',
  '微策略两倍': 'MSTX',
  'COIN双倍': 'CONL',
  'COIN两倍': 'CONL',
  '英伟达双倍': 'NVDL',
  '英伟达两倍': 'NVDL'
};

function normalizeTicker(sym) {
  if (!sym) return '';
  const clean = sym.trim().toUpperCase();
  return TICKER_ALIAS_MAP[clean] || clean;
}

// 2. 读取原始 CU 样本库以获取精确时间戳
const cuDatasetPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const cuTimeMap = new Map();
if (fs.existsSync(cuDatasetPath)) {
  const cuLines = fs.readFileSync(cuDatasetPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  for (const l of cuLines) {
    try {
      const cuObj = JSON.parse(l);
      const startT = cuObj.time?.start_utc ? new Date(cuObj.time.start_utc).getTime() : 0;
      cuTimeMap.set(cuObj.cu_id, {
        start_utc_ms: startT,
        et_date: cuObj.time?.et_date,
        session: cuObj.time?.session,
        dialogue: cuObj.dialogue_messages
      });
    } catch (e) {}
  }
}

// 3. 读取 L2a 候选订单文件
const candidatesPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
if (!fs.existsSync(candidatesPath)) {
  console.error(`❌ 候选订单文件不存在: ${candidatesPath}`);
  console.error('💡 请等待 L2a 夜跑生成完成后再执行对账。');
  process.exit(2);
}

const candidateLines = fs.readFileSync(candidatesPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const candidates = candidateLines.map(l => JSON.parse(l));
console.log(`📦 成功载入 L2a 候选记录: ${candidates.length} 组`);

// 提取所有有效 KOL 交易动作 (过滤 HOLD)
const kolActions = [];
for (const cand of candidates) {
  const actions = cand.parsed?.actions || [];
  const timeInfo = cuTimeMap.get(cand.cu_id);
  const cuTimestamp = timeInfo?.start_utc_ms || cand.created_at || Date.now();

  for (let idx = 0; idx < actions.length; idx++) {
    const a = actions[idx];
    const actUpper = (a.action || 'BUY').toUpperCase();
    if (actUpper === 'HOLD') continue; // 过滤 HOLD 动作

    const normSym = normalizeTicker(a.ticker);
    if (!normSym || normSym === 'NULL' || normSym.includes('未指定') || normSym === 'UNKNOWN') continue;

    kolActions.push({
      action_id: `${cand.cu_id}_act_${idx + 1}`,
      cu_id: cand.cu_id,
      ticker: normSym,
      action: actUpper,
      status: (a.status || 'filled').toLowerCase(),
      price: a.price != null ? parseFloat(a.price) : null,
      instrument_type: (a.instrument_type || 'stock').toLowerCase(),
      timestamp: cuTimestamp,
      et_date: timeInfo?.et_date || cand.et_date,
      raw_text: cand.raw_text
    });
  }
}
console.log(`🎯 提取有效 KOL 交易动作 (已过滤 HOLD): ${kolActions.length} 笔\n`);

// 4. 读取长桥真实成交流水 (严格检查，缺文件立即 exit 2，严禁伪造流水)
const brokerFillsPathJsonl = 'data/broker/longbridge_fills.jsonl';
const brokerFillsPathCsv = 'data/broker/longbridge_fills.csv';

let brokerFills = [];

if (fs.existsSync(brokerFillsPathJsonl)) {
  const lines = fs.readFileSync(brokerFillsPathJsonl, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
  brokerFills = lines.map(l => JSON.parse(l));
  console.log(`🏛️ 成功从 JSONL 载入长桥成交流水: ${brokerFills.length} 笔`);
} else if (fs.existsSync(brokerFillsPathCsv)) {
  const csvContent = fs.readFileSync(brokerFillsPathCsv, 'utf-8').trim().split('\n');
  const headers = csvContent[0].split(',').map(h => h.trim());
  for (let i = 1; i < csvContent.length; i++) {
    const row = csvContent[i].split(',').map(c => c.trim());
    if (row.length < headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);
    brokerFills.push(obj);
  }
  console.log(`🏛️ 成功从 CSV 载入长桥成交流水: ${brokerFills.length} 笔`);
} else {
  console.error('====================================================');
  console.error('❌ 缺少长桥真实成交流水文件！');
  console.error(`   预期路径: ${brokerFillsPathJsonl} 或 ${brokerFillsPathCsv}`);
  console.error('🛑 严格执行铁律：严禁伪造虚拟成交流水，对账引擎安全退出 (exit code 2)！');
  console.error('====================================================');
  process.exit(2);
}

// 规范化 Broker 流水字段
const standardFills = brokerFills.map((f, idx) => ({
  fill_id: f.fill_id || f.order_id || `fill_${idx + 1}`,
  ticker: normalizeTicker(f.ticker || f.symbol),
  side: (f.side || f.action || 'BUY').toUpperCase(),
  price: parseFloat(f.price || f.fill_price || 0),
  quantity: parseInt(f.quantity || f.qty || 1, 10),
  timestamp: new Date(f.timestamp || f.fill_time || f.created_at).getTime(),
  instrument_type: (f.instrument_type || 'stock').toLowerCase()
}));

// 计算两个交易日之后的美东收盘时间戳 (跳过周末)
function addTwoTradingDaysClose(startMs) {
  let d = new Date(startMs);
  let daysAdded = 0;
  while (daysAdded < 2) {
    d.setDate(d.getDate() + 1);
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 非周六周日
      daysAdded++;
    }
  }
  // 设为当天美东收盘 16:00 (UTC 21:00)
  return d.getTime() + 24 * 3600 * 1000;
}

// 5. 执行 1:1 独占撮合算法
const matchedBrokerFillIds = new Set();
const reconciliationResults = [];

let matchFilledCount = 0;
let matchPlannedCount = 0;
let kolOnlyCount = 0;
let brokerOnlyCount = 0;
let ambiguousMultiCount = 0;

for (const kol of kolActions) {
  const candidatesForKol = [];

  for (const b of standardFills) {
    if (matchedBrokerFillIds.has(b.fill_id)) continue;
    if (b.ticker !== kol.ticker) continue;

    // 方向匹配
    const kolSide = (kol.action === 'SELL' || kol.action === 'STOP_LOSS' || kol.action === 'TAKE_PROFIT') ? 'SELL' : 'BUY';
    const brokerSide = b.side === 'SELL' ? 'SELL' : 'BUY';
    if (kolSide !== brokerSide) continue;

    // 时间窗口判定
    let timeMatch = false;
    if (kol.status === 'filled') {
      // [-20min, +4h]
      timeMatch = (b.timestamp >= kol.timestamp - 20 * 60 * 1000) && (b.timestamp <= kol.timestamp + 4 * 3600 * 1000);
    } else {
      // planned: [0, +2个交易日收盘]
      const twoDaysEnd = addTwoTradingDaysClose(kol.timestamp);
      timeMatch = (b.timestamp >= kol.timestamp) && (b.timestamp <= twoDaysEnd);
    }
    if (!timeMatch) continue;

    // 价格容差判定
    let priceMatch = false;
    let isWildcard = false;
    if (kol.price == null) {
      isWildcard = true;
      priceMatch = true; // 待后续按数量判定是否降级
    } else {
      const isOption = kol.instrument_type.includes('option') || b.instrument_type.includes('option');
      const maxDiff = isOption ? Math.max(0.08, b.price * 0.03) : Math.max(0.05, b.price * 0.008);
      priceMatch = Math.abs(b.price - kol.price) <= maxDiff;
    }

    if (priceMatch) {
      const timeDiffMs = Math.abs(b.timestamp - kol.timestamp);
      candidatesForKol.push({ fill: b, timeDiffMs, isWildcard });
    }
  }

  if (candidatesForKol.length === 0) {
    kolOnlyCount++;
    reconciliationResults.push({
      status: 'KOL_ONLY',
      kol_action: kol,
      broker_fill: null,
      note: kol.status === 'planned' ? '基线挂单未触发' : 'KOL喊单但实盘未跟进'
    });
  } else if (candidatesForKol.length === 1) {
    const item = candidatesForKol[0];
    const best = item.fill;
    matchedBrokerFillIds.add(best.fill_id);
    const matchType = kol.status === 'filled' ? 'MATCH_FILLED' : 'MATCH_PLANNED_LATER';
    if (matchType === 'MATCH_FILLED') matchFilledCount++;
    else matchPlannedCount++;

    reconciliationResults.push({
      status: matchType,
      kol_action: kol,
      broker_fill: best,
      note: item.isWildcard ? 'MATCH (WILDCARD_SINGLE 唯一单命中)' : '1:1 精确匹配成功'
    });
  } else {
    // 存在多笔候选
    const hasWildcard = candidatesForKol.some(c => c.isWildcard);
    if (hasWildcard) {
      // price == null 且有多笔成交 -> 降级为 AMBIGUOUS_MULTI，不随意抢单
      ambiguousMultiCount++;
      reconciliationResults.push({
        status: 'AMBIGUOUS_MULTI',
        kol_action: kol,
        broker_fill: null,
        candidate_count: candidatesForKol.length,
        note: `WILDCARD 多笔模糊成交 (${candidatesForKol.length} 笔)，待人工复核`
      });
    } else {
      // 有明确价格，取时间最接近的一笔
      candidatesForKol.sort((a, b) => a.timeDiffMs - b.timeDiffMs);
      const best = candidatesForKol[0].fill;
      matchedBrokerFillIds.add(best.fill_id);
      const matchType = kol.status === 'filled' ? 'MATCH_FILLED' : 'MATCH_PLANNED_LATER';
      if (matchType === 'MATCH_FILLED') matchFilledCount++;
      else matchPlannedCount++;

      reconciliationResults.push({
        status: matchType,
        kol_action: kol,
        broker_fill: best,
        note: `多单中按价格与最优时间差撮合 (${candidatesForKol.length} 个候选)`
      });
    }
  }
}

// 检查 Broker 自主交易 (BROKER_ONLY)
for (const b of standardFills) {
  if (!matchedBrokerFillIds.has(b.fill_id)) {
    brokerOnlyCount++;
    reconciliationResults.push({
      status: 'BROKER_ONLY',
      kol_action: null,
      broker_fill: b,
      note: '券商实盘有成交，但大V广播频道无对应喊单 (自主交易)'
    });
  }
}

// 6. 计算宏观统计看板
const totalKolFilled = kolActions.filter(a => a.status === 'filled').length;
const totalKolPlanned = kolActions.filter(a => a.status === 'planned').length;

const followThroughRate = totalKolFilled > 0 ? (matchFilledCount / totalKolFilled) * 100 : 0;
const plannedTriggerRate = totalKolPlanned > 0 ? (matchPlannedCount / totalKolPlanned) * 100 : 0;
const discretionaryRate = standardFills.length > 0 ? (brokerOnlyCount / standardFills.length) * 100 : 0;

console.log('====================================================');
console.log('📊 对账宏观统计看板 (Reconciliation Summary)');
console.log('====================================================');
console.log(`1. KOL 动作总数:                  ${kolActions.length} 笔 (Filled: ${totalKolFilled}, Planned: ${totalKolPlanned})`);
console.log(`2. 券商实盘成交总数:              ${standardFills.length} 笔`);
console.log(`3. 完美撮合 (MATCH_FILLED):       ${matchFilledCount} 笔 -> 跟单率: ${followThroughRate.toFixed(1)}%`);
console.log(`4. 挂单触发 (MATCH_PLANNED_LATER): ${matchPlannedCount} 笔 -> 触发率: ${plannedTriggerRate.toFixed(1)}%`);
console.log(`5. 模糊多单 (AMBIGUOUS_MULTI):    ${ambiguousMultiCount} 笔`);
console.log(`6. 仅大V发言 (KOL_ONLY):          ${kolOnlyCount} 笔`);
console.log(`7. 自主交易 (BROKER_ONLY):        ${brokerOnlyCount} 笔 -> 自主交易率: ${discretionaryRate.toFixed(1)}%`);
console.log('====================================================\n');

// 7. 保存对账报表 (纯只读)
const reportPath = 'data/runs/l2a_reconciliation_report.json';
const outData = {
  summary: {
    totalKolActions: kolActions.length,
    totalBrokerFills: standardFills.length,
    matchFilledCount,
    matchPlannedCount,
    ambiguousMultiCount,
    kolOnlyCount,
    brokerOnlyCount,
    followThroughRate,
    plannedTriggerRate,
    discretionaryRate
  },
  details: reconciliationResults
};

fs.writeFileSync(reportPath, JSON.stringify(outData, null, 2), 'utf-8');
console.log(`✅ 完整实盘对账报表已保存至: ${reportPath}！\n`);
