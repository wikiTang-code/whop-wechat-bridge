import fs from 'fs';
import { cleanAndNormalizeEnvelope } from './post_processor.js';
import { evaluatePredictions } from '../data/eval/eval_harness.js';

console.log('====================================================');
console.log('🧪 应用后处理清洗管道 (Post-Processing) 对 50 条预测重新打分');
console.log('====================================================\n');

const predsPath = 'data/eval/preds_35b_50.jsonl';
if (!fs.existsSync(predsPath)) {
  console.error(`❌ 缺少预测文件: ${predsPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(predsPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const rawPreds = lines.map(l => JSON.parse(l));

console.log(`📚 成功读取 50 条大模型真实预测记录`);

// 应用后处理清洗
const cleanedPredictions = [];
for (const p of rawPreds) {
  if (p.parsed) {
    const cleaned = cleanAndNormalizeEnvelope(p.parsed, p.raw_text || '');
    cleanedPredictions.push(cleaned);
  }
}

// 重新打分
console.log(`✨ 清洗完毕，执行升级版 Harness 评测打分:`);
const report = evaluatePredictions(cleanedPredictions);

// 保存后处理版评测报告
const outReportPath = 'data/eval/harness_report_post_processed_50.json';
fs.writeFileSync(outReportPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`✅ 后处理版评分报告已保存至 ${outReportPath}！`);
