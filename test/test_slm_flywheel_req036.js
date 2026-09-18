/**
 * test_slm_flywheel_req036.js
 * REQ-036: 大V交易语义 SLM 自迭代数据飞轮编排引擎单测套件
 */

import assert from 'assert';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getFlywheelState,
  saveFlywheelState,
  queryQueueMetrics,
  checkFlywheel
} from '../scripts/slm/flywheel_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_STATE_PATH = path.join(__dirname, '../data/slm/flywheel_state_test_scratch.json');

console.log('===========================================================');
console.log('🧪 [Test REQ-036] 大V交易语义 SLM 自迭代数据飞轮单元测试');
console.log('===========================================================\n');

// 1. 测试队列指标读取
console.log('--- 1. 验证 SQLite 队列纠错与待审水位统计 ---');
const metrics = queryQueueMetrics();
console.log('当前数据库队列指标:', metrics);
assert.ok(typeof metrics.corrected === 'number', 'corrected 必须为数字');
assert.ok(typeof metrics.pending === 'number', 'pending 必须为数字');
assert.ok(typeof metrics.reviewed === 'number', 'reviewed 必须为数字');
assert.ok(metrics.total >= 800, '总单据量应在 800 笔以上');
console.log('✅ queryQueueMetrics 统计校验通过\n');

// 2. 测试状态读写与版本元数据
console.log('--- 2. 验证飞轮元数据持久化与历史快照 ---');
const dummyState = {
  version: 'v1.test.0',
  last_trained_at: new Date().toISOString(),
  last_trained_corrected_count: 5,
  total_iterations: 1,
  history: [
    { iteration: 1, version: 'v1.test.0', corrected_count_at_train: 5 }
  ]
};

// 验证保存与读取
saveFlywheelState(dummyState);
const loadedState = getFlywheelState();
assert.strictEqual(loadedState.version, 'v1.test.0', '版本号应精准保存');
assert.strictEqual(loadedState.last_trained_corrected_count, 5, '纠错基准应匹配');
console.log('✅ 飞轮状态读写与持久化校验通过\n');

// 3. 测试增量感知与触发阈值门禁
console.log('--- 3. 验证增量敏感度与自迭代触发门禁 ---');
// 场景 A: 增量未达阈值 (当前 corrected=9, 上次=8, 阈值=5, delta=1 < 5 -> false)
const lowDeltaState = {
  version: 'v1.0.0',
  last_trained_corrected_count: metrics.corrected - 1,
  total_iterations: 1,
  history: []
};
saveFlywheelState(lowDeltaState);
const checkLow = checkFlywheel(5);
console.log('低增量探测:', checkLow.summary);
assert.strictEqual(checkLow.delta, 1, '增量应为 1');
assert.strictEqual(checkLow.shouldTrigger, false, '增量低于阈值时不应触发');

// 场景 B: 增量达标 (当前 corrected=9, 上次=0, 阈值=5, delta=9 >= 5 -> true)
const highDeltaState = {
  version: 'v1.0.0',
  last_trained_corrected_count: 0,
  total_iterations: 0,
  history: []
};
saveFlywheelState(highDeltaState);
const checkHigh = checkFlywheel(5);
console.log('高增量探测:', checkHigh.summary);
assert.ok(checkHigh.delta >= 5, '增量应大于等于 5');
assert.strictEqual(checkHigh.shouldTrigger, true, '增量达到阈值时必须触发');
console.log('✅ 增量感知与触发门禁逻辑校验通过\n');

// 恢复正常初始状态
saveFlywheelState({
  version: 'v1.0.0',
  last_trained_at: null,
  last_trained_corrected_count: 0,
  total_iterations: 0,
  history: []
});

console.log('===========================================================');
console.log('🎉 REQ-036 大V交易语义自迭代数据飞轮测试套件全部 PASS！');
console.log('===========================================================\n');

