import assert from 'assert';
import { calculateFollowQualityMetrics } from '../follow-decision-engine.js';
import { getDb, initDb, saveFollowDecision } from '../database.js';

initDb();
const db = getDb();

console.log('===========================================================');
console.log('🧪 [Test REQ-021] 跟单质量指标与沙盒实盘准入门禁评估验证');
console.log('===========================================================\n');

// 1. 空决策池门禁评估
const emptyDb = {
  prepare: () => ({ all: () => [] })
};
const emptyRes = calculateFollowQualityMetrics({ days: 20, dbInstance: emptyDb });
assert.strictEqual(emptyRes.qualified, false, '样本量不足严禁开启实盘');
assert.strictEqual(emptyRes.gateChecklist.sampleSizeMet, false);
console.log('✅ 1. 空样本阻断验证通过');

// 2. 模拟达标样本 (20笔正常决策，无错单)
const goodDecisions = [];
for (let i = 0; i < 20; i++) {
  goodDecisions.push({
    decision_id: `dec_good_${i}`,
    decision_state: i % 4 === 0 ? 'SIZE_DOWN' : 'FIRE',
    created_at: Date.now() - 1000 * i
  });
}
const goodDb = {
  prepare: () => ({ all: () => goodDecisions })
};
const goodRes = calculateFollowQualityMetrics({ days: 20, dbInstance: goodDb });
assert.strictEqual(goodRes.qualified, true, '达标样本应允许开启实盘');
assert.strictEqual(goodRes.metrics.accuracyRate, 1.0);
console.log('✅ 2. 优质样本准入验证通过 (accuracy=100%, qualified=true)');

// 3. 模拟劣质样本 (含大量解析错误反馈)
const badDecisions = [];
for (let i = 0; i < 20; i++) {
  badDecisions.push({
    decision_id: `dec_bad_${i}`,
    decision_state: i < 5 ? 'PARSE_ERROR_REPORTED' : 'FIRE', // 25% 错误率
    created_at: Date.now() - 1000 * i
  });
}
const badDb = {
  prepare: () => ({ all: () => badDecisions })
};
const badRes = calculateFollowQualityMetrics({ days: 20, dbInstance: badDb });
assert.strictEqual(badRes.qualified, false, '高错误率严禁准入实盘');
assert.strictEqual(badRes.gateChecklist.accuracyMet, false);
console.log('✅ 3. 劣质样本门禁拦截验证通过 (errorRate=25%, qualified=false)');

console.log('\n🎉 REQ-021 跟单沙盒实盘准入门禁全部验证通过！');
