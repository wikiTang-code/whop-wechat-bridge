import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🎯 Benchmark Eval Harness (50条金标质量打分与误差分析)');
console.log('====================================================\n');

// 1. 读取金标文件
const goldPath = 'data/eval/gold_envelopes_50.jsonl';
if (!fs.existsSync(goldPath)) {
  console.error(`❌ 缺少金标文件: ${goldPath}`);
  process.exit(1);
}

const goldLines = fs.readFileSync(goldPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const goldMap = new Map();
for (const line of goldLines) {
  const obj = JSON.parse(line);
  goldMap.set(obj.cu_id, obj);
}
console.log(`💎 成功载入金标: ${goldMap.size} 条`);

// 2. 评测打分函数
export function evaluatePredictions(predictions) {
  let totalSamples = 0;
  let jsonValidCount = 0;
  let speechActMatchCount = 0;
  let totalGoldActions = 0;
  let matchedGoldActions = 0;
  let failedSampleCount = 0;
  let hallucinatedOnFailedCount = 0;
  let hallucinatedTickerCount = 0;

  const errorReport = [];

  for (const pred of predictions) {
    const gold = goldMap.get(pred.cu_id);
    if (!gold) continue;

    totalSamples++;
    if (pred.parse_status !== 'json_error') jsonValidCount++;

    // 1. speech_act 匹配
    const isSpeechActMatch = pred.speech_act === gold.speech_act;
    if (isSpeechActMatch) speechActMatchCount++;

    // 2. failed 样本编造检验
    if (gold.parse_status === 'failed') {
      failedSampleCount++;
      if (pred.actions && pred.actions.length > 0) {
        hallucinatedOnFailedCount++;
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'HALLUCINATED_ON_FAILED',
          detail: `金标为 failed(无有效动作)，但模型输出了 ${pred.actions.length} 个 action`
        });
      }
    }

    // 3. Action 三元组 (action, ticker, price) 精确匹配
    const goldActions = gold.actions || [];
    totalGoldActions += goldActions.length;

    const predActions = pred.actions || [];
    for (const ga of goldActions) {
      const pMatch = predActions.find(pa => 
        pa.action === ga.action && 
        pa.ticker?.toUpperCase() === ga.ticker?.toUpperCase() &&
        (ga.price === null || Math.abs((pa.price || 0) - ga.price) < 0.5)
      );
      if (pMatch) {
        matchedGoldActions++;
      } else {
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'MISSED_OR_MISMATCHED_ACTION',
          detail: `金标期望 [${ga.action} ${ga.ticker} @ ${ga.price}] 未能在模型输出中精确匹配`
        });
      }
    }

    // 4. 检查模型是否编造了金标中不存在的 Ticker
    const goldTickers = new Set(goldActions.map(a => a.ticker?.toUpperCase()));
    if (gold.claims) gold.claims.forEach(c => goldTickers.add(c.ticker?.toUpperCase()));

    for (const pa of predActions) {
      const sym = pa.ticker?.toUpperCase();
      if (sym && !goldTickers.has(sym)) {
        hallucinatedTickerCount++;
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'HALLUCINATED_TICKER',
          detail: `模型输出了金标中不存在的标的: ${sym}`
        });
      }
    }
  }

  // 计算指标
  const jsonValidRate = (jsonValidCount / totalSamples) * 100;
  const speechActMatchRate = (speechActMatchCount / totalSamples) * 100;
  const actionTripletMatchRate = totalGoldActions > 0 ? (matchedGoldActions / totalGoldActions) * 100 : 100;
  const hallucinatedOnFailedRate = failedSampleCount > 0 ? (hallucinatedOnFailedCount / failedSampleCount) * 100 : 0;
  const hallucinatedTickerRate = (hallucinatedTickerCount / totalSamples) * 100;

  console.log('\n====================================================');
  console.log('📊 评测基准打分结果 (Benchmark Scoreboard)');
  console.log('====================================================');
  console.log(`1. JSON 可解析率:          ${jsonValidRate.toFixed(1)}% (目标 >= 98%) -> ${jsonValidRate >= 98 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`2. speech_act 一致率:       ${speechActMatchRate.toFixed(1)}% (目标 >= 90%) -> ${speechActMatchRate >= 90 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`3. Action 三元组精确匹配率: ${actionTripletMatchRate.toFixed(1)}% (目标 >= 75%) -> ${actionTripletMatchRate >= 75 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`4. Failed 样本假动作编造率:  ${hallucinatedOnFailedRate.toFixed(1)}% (目标 <= 2%) -> ${hallucinatedOnFailedRate <= 2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`5. 幻觉标的编造率:          ${hallucinatedTickerRate.toFixed(1)}% (目标 <= 2%) -> ${hallucinatedTickerRate <= 2 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log('====================================================\n');

  console.log(`🔍 误差样例 (Error Cases): 共 ${errorReport.length} 项差异`);
  errorReport.slice(0, 10).forEach((err, idx) => {
    console.log(`[误差 #${idx+1}] [${err.cu_id}] [${err.type}]: ${err.detail}`);
  });

  return {
    metrics: {
      jsonValidRate,
      speechActMatchRate,
      actionTripletMatchRate,
      hallucinatedOnFailedRate,
      hallucinatedTickerRate
    },
    errorReport
  };
}

// 若独立运行，测试示例打分
if (process.argv[1] && process.argv[1].endsWith('eval_harness.js')) {
  console.log('ℹ️ 运行自检：评估 50 条金标自身的自洽性 (Self-Check)');
  evaluatePredictions(Array.from(goldMap.values()));
}
