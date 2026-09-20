#!/usr/bin/env node
/**
 * test/test_audit_linked_pnl_pipeline.js
 * [REQ-054 / DEBT-021] 人工审核增量联动流水线与胜率重算引擎单测
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAuditLinkedPnLPipeline } from '../tools/trade/audit_linked_pnl_pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');

console.log('===========================================================');
console.log('🧪 [Test REQ-054] 人工审核增量联动与利润重算流水线测试');
console.log('===========================================================');

// 1. 运行流水线
const result = runAuditLinkedPnLPipeline({ apply: false });
assert.ok(result, '流水线必须返回执行结果');
const { summary, closedPairs, slmGoldenPairs } = result;

// 2. 验证审核进度指标
console.log('--- 1. 验证审核进度指标 ---');
assert.ok(summary.audit_progress, '必须包含 audit_progress');
assert.strictEqual(summary.audit_progress.total_queue, 830, '总队列数应为 830');
assert.strictEqual(summary.audit_progress.corrected, 10, '人工纠偏数应为 10');
assert.strictEqual(summary.audit_progress.confirmed_skip, 74, '人工跳过数应为 74');
console.log(`  ✅ 审核进度统计正确: ${summary.audit_progress.audit_progress_pct} 已完成`);

// 3. 验证人工纠偏优先覆盖
console.log('\n--- 2. 验证人工纠偏优先覆盖 ---');
assert.ok(summary.signal_summary.human_verified_signals >= 10, '至少应融合 10 笔人工权威纠正信号');
assert.ok(summary.signal_summary.total_closed_pairs > 700, '闭环配对总数应 > 700');
console.log(`  ✅ 人工纠偏权威信号生效: ${summary.signal_summary.human_verified_signals} 笔`);

// 4. 验证 SLM 黄金语料提纯 (REQ-036 联动)
console.log('\n--- 3. 验证 SLM 黄金语料提纯 (REQ-036 联动) ---');
assert.ok(slmGoldenPairs.length >= 80, '提纯的黄金语料数应 >= 80');
const correctionSamples = slmGoldenPairs.filter(p => p.type === 'correction_learning');
const filterSamples = slmGoldenPairs.filter(p => p.type === 'negative_filtering');
assert.ok(correctionSamples.length > 0, '必须包含纠偏学习样本');
assert.ok(filterSamples.length > 0, '必须包含负向过滤样本');
console.log(`  ✅ SLM 黄金样本验证通过: ${correctionSamples.length} 组纠偏 + ${filterSamples.length} 组过滤`);

// 5. 验证产物落盘
console.log('\n--- 4. 验证运行时产物落盘与结构 ---');
const summaryPath = path.join(ROOT_DIR, 'data/runtime/audit_linked_pnl_summary.json');
assert.ok(fs.existsSync(summaryPath), 'audit_linked_pnl_summary.json 必须落盘');
const loadedSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
assert.ok(loadedSummary.performance_metrics.overall_win_rate_pct, '必须包含总体胜率');
assert.ok(loadedSummary.performance_metrics.profit_factor, '必须包含盈亏比');
console.log(`  ✅ 产物落盘验证通过: 总体胜率 ${loadedSummary.performance_metrics.overall_win_rate_pct}% | 盈亏比 ${loadedSummary.performance_metrics.profit_factor}`);

console.log('\n===========================================================');
console.log('🎉 [Test REQ-054] 人工审核增量联动流水线单测全部 PASS！');
console.log('===========================================================');
