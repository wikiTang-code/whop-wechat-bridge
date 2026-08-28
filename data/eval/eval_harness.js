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

    // 3. Action 三元组 (action, ticker, price, status) 精确匹配
    const goldActions = gold.actions || [];
    totalGoldActions += goldActions.length;

    const predActions = pred.actions || [];
    for (const ga of goldActions) {
      const pMatch = predActions.find(pa => {
        const isActionMatch = pa.action === ga.action;
        const isTickerMatch = pa.ticker?.toUpperCase() === ga.ticker?.toUpperCase();
        const isStatusMatch = !ga.status || !pa.status || pa.status === ga.status;
        
        let isPriceMatch = false;
        if (ga.price === null || ga.price === undefined) {
          isPriceMatch = (pa.price === null || pa.price === undefined);
        } else {
          isPriceMatch = pa.price !== null && pa.price !== undefined && Math.abs(pa.price - ga.price) < 0.5;
        }

        return isActionMatch && isTickerMatch && isStatusMatch && isPriceMatch;
      });

      if (pMatch) {
        matchedGoldActions++;
      } else {
        errorReport.push({
          cu_id: pred.cu_id,
          type: 'MISSED_OR_MISMATCHED_ACTION',
          detail: `金标期望 [${ga.action} ${ga.ticker} @ ${ga.price} (${ga.status || 'any'})] 未能在模型输出中精确匹配`
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
  console.log(`3. Action 精确匹配率:      ${actionTripletMatchRate.toFixed(1)}% (目标 >= 75%) -> ${actionTripletMatchRate >= 75 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log(`4. Failed 样本假动作编造率:  ${hallucinatedOnFailedRate.toFixed(1)}% (目标 <= 2%) -> ${hallucinatedOnFailedRate <= 2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`5. 幻觉标的编造率:          ${hallucinatedTickerRate.toFixed(1)}% (目标 <= 2%) -> ${hallucinatedTickerRate <= 2 ? '✅ PASS' : '⚠️ 需优化'}`);
  console.log('====================================================\n');

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

// 若独立运行，默认直接读取 preds_35b_50.jsonl 进行实测评测
if (process.argv[1] && process.argv[1].endsWith('eval_harness.js')) {
  const predsPath = 'data/eval/preds_35b_50.jsonl';
  if (fs.existsSync(predsPath)) {
    console.log(`ℹ️ 读取模型预测文件: ${predsPath}`);
    const lines = fs.readFileSync(predsPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
    const preds = lines.map(l => JSON.parse(l)).filter(p => p.parsed !== null).map(p => p.parsed);
    evaluatePredictions(preds);
  } else {
    console.log('ℹ️ 未找到 preds_35b_50.jsonl，运行金标自检 (Self-Check)');
    evaluatePredictions(Array.from(goldMap.values()));
  }
}
