import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('📊 L2a 候选订单 vs 长桥真实成交流水对账引擎 (Reconcile Engine)');
console.log('====================================================\n');

// 1. Ticker 别名映射
const TICKER_ALIAS_MAP = {
  'CFIR': 'CIFR',
  '奈飞双倍': 'NFXL',
  'NFLX': 'NFXL',
  '特斯拉两倍': 'TSLL',
  'TSLA': 'TSLL',
  '微策略两倍': 'MSTX',
  'MSTR': 'MSTX',
  'COIN两倍': 'CONL',
  'COIN': 'CONL',
  '英伟达两倍': 'NVDL',
  'NVDA': 'NVDL'
};

function normalizeTicker(sym) {
  if (!sym) return '';
  const clean = sym.trim().toUpperCase();
  return TICKER_ALIAS_MAP[clean] || clean;
}

// 2. 读取 L2a 候选订单文件
const candidatesPath = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
if (!fs.existsSync(candidatesPath)) {
  console.error(`❌ 候选订单文件不存在: ${candidatesPath}`);
  console.error('💡 请等待 L2a 夜跑生成完成后再执行对账。');
  process.exit(1);
}

const candidateLines = fs.readFileSync(candidatesPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const candidates = candidateLines.map(l => JSON.parse(l));
console.log(`📦 成功载入 L2a 候选记录: ${candidates.length} 组`);

// 提取所有 KOL 动作单
const kolActions = [];
for (const cand of candidates) {
  const actions = cand.parsed?.actions || [];
  // 获取 CU 的发生时间戳 (UTC)
  let cuTimestamp = cand.created_at || Date.now();
  if (cand.et_date) {
    const dStr = `${cand.et_date}T12:00:00.000Z`;
    const parsedT = new Date(dStr).getTime();
    if (!isNaN(parsedT)) cuTimestamp = parsedT;
  }

  for (let idx = 0; idx < actions.length; idx++) {
    const a = actions[idx];
    const normSym = normalizeTicker(a.ticker);
    if (!normSym || normSym === 'NULL' || normSym.includes('未指定')) continue;

    kolActions.push({
      action_id: `${cand.cu_id}_act_${idx + 1}`,
      cu_id: cand.cu_id,
      ticker: normSym,
      action: (a.action || 'BUY').toUpperCase(),
      status: (a.status || 'filled').toLowerCase(),
      price: a.price != null ? parseFloat(a.price) : null,
      instrument_type: (a.instrument_type || 'stock').toLowerCase(),
      timestamp: cuTimestamp,
      raw_text: cand.raw_text
    });
  }
}
console.log(`🎯 提取有效 KOL 喊单/动作: ${kolActions.length} 笔\n`);

// 3. 读取长桥真实成交流水 (严格检查，缺文件立即退出，严禁造假)
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
  console.error('🛑 严格执行铁律：严禁伪造虚拟成交流水，对账引擎安全退出！');
  console.error('====================================================');
  process.exit(1);
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

// 4. 执行 1:1 独占撮合算法
const matchedBrokerFillIds = new Set();
const reconciliationResults = [];

let matchFilledCount = 0;
let matchPlannedCount = 0;
let kolOnlyCount = 0;
let brokerOnlyCount = 0;

for (const kol of kolActions) {
  // 查找所有候选 Broker Fills
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
      // planned: [0, +2个交易日 = 48h]
      timeMatch = (b.timestamp >= kol.timestamp) && (b.timestamp <= kol.timestamp + 48 * 3600 * 1000);
    }
    if (!timeMatch) continue;

    // 价格容差判定
    let priceMatch = false;
    if (kol.price == null) {
      priceMatch = true; // 市价/模糊喊单
    } else {
      const isOption = kol.instrument_type.includes('option') || b.instrument_type.includes('option');
      const maxDiff = isOption ? Math.max(0.08, b.price * 0.03) : Math.max(0.05, b.price * 0.008);
      priceMatch = Math.abs(b.price - kol.price) <= maxDiff;
    }

    if (priceMatch) {
      const timeDiffMs = Math.abs(b.timestamp - kol.timestamp);
      candidatesForKol.push({ fill: b, timeDiffMs });
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
    const best = candidatesForKol[0].fill;
    matchedBrokerFillIds.add(best.fill_id);
    const matchType = kol.status === 'filled' ? 'MATCH_FILLED' : 'MATCH_PLANNED_LATER';
    if (matchType === 'MATCH_FILLED') matchFilledCount++;
    else matchPlannedCount++;

    reconciliationResults.push({
      status: matchType,
      kol_action: kol,
      broker_fill: best,
      note: '1:1 精确匹配成功'
    });
  } else {
    // 存在多笔候选，取时间最接近的一笔
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
      note: `多单中撮合最优时间差 (${candidatesForKol.length} 个候选)`
    });
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

// 5. 计算宏观统计指标
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
console.log(`5. 仅大V发言 (KOL_ONLY):          ${kolOnlyCount} 笔`);
console.log(`6. 自主交易 (BROKER_ONLY):        ${brokerOnlyCount} 笔 -> 自主交易率: ${discretionaryRate.toFixed(1)}%`);
console.log('====================================================\n');

// 6. 保存报表 (纯只读，绝不回写候选表)
const reportPath = 'data/runs/l2a_reconciliation_report.json';
const outData = {
  summary: {
    totalKolActions: kolActions.length,
    totalBrokerFills: standardFills.length,
    matchFilledCount,
    matchPlannedCount,
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
