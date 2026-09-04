/**
 * Integration & unit tests for:
 * 1. Slow operation tracker (trackSlowOp & ring buffer)
 * 2. Alert sink flapping dampening (anti-flood state machine)
 * 3. Beijing timezone formatting
 * 4. 3-tier stepped backpressure controller
 */

import assert from 'assert';
import {
  trackSlowOp,
  recordSlowOp,
  getRecentSlowOps,
  getSlowOpsRing,
  _resetSlowOpsForTests,
} from '../monitoring/slow-log-tracker.js';
import {
  sendAlert,
  formatBeijingTime,
  _resetAlertSinkForTests,
  getAlertSinkStats,
} from '../monitoring/alert-sink.js';
import {
  updateBackpressureMetrics,
  getEffectivePollIntervalSec,
  shouldPauseSecondaryWorkers,
  getBackpressureStatus,
  _resetBackpressureForTests,
} from '../monitoring/backpressure-controller.js';

console.log('--- 开始执行: test_flapping_and_backpressure ---');

// ============================================================================
// 1. 测试慢日志追踪与环形缓冲 (Slow Log Tracker)
// ============================================================================
console.log('1. 验证慢日志追踪与环形缓冲...');
_resetSlowOpsForTests();

// 模拟同步正常操作（未超时）
trackSlowOp('fast_sync_fn', 10, () => 42, 50);
assert.strictEqual(getSlowOpsRing().length, 0, '未达阈值的操作不应入环形缓冲');

// 模拟记录慢操作
recordSlowOp({ fn: 'database:saveMessages', batchSize: 888, durationMs: 4200.5 });
recordSlowOp({ fn: 'fts5_sync', batchSize: 50, durationMs: 650.2 });

const recent = getRecentSlowOps(2);
assert.strictEqual(recent.length, 2, '应能获取最近 2 条慢日志');
assert.strictEqual(recent[0].fn, 'fts5_sync', '最新执行的应排在最前');
assert.strictEqual(recent[1].fn, 'database:saveMessages', '上一条排第二');
assert.strictEqual(recent[1].batchSize, 888);
console.log('   ✅ 慢日志追踪与环形缓冲测试通过！');

// ============================================================================
// 2. 测试北京时间戳格式化
// ============================================================================
console.log('2. 验证北京时间戳格式化...');
const fixedTime = new Date('2026-09-04T10:13:46.763Z').getTime(); // 对应北京时间 18:13:46
const beijingStr = formatBeijingTime(fixedTime);
assert(beijingStr.includes('2026/09/04') || beijingStr.includes('2026-09-04') || beijingStr.includes('18:13:46'), '时间应格式化为 18:13:46');
assert(beijingStr.includes('(北京时间)'), '文案必须带 (北京时间) 后缀');
console.log('   ✅ 北京时间戳格式化测试通过:', beijingStr);

// ============================================================================
// 3. 测试防震荡抑制状态机 (Flapping Dampening)
// ============================================================================
console.log('3. 验证防震荡抑制与静音恢复...');
const pushes = [];
let fakeNow = 1000000;

_resetAlertSinkForTests({
  now: () => fakeNow,
  push: async (url, md) => {
    pushes.push({ url, md });
    return { ok: true };
  },
});

// 初始状态 OK
await sendAlert({ subsystem: 'test_sub', level: 'ok', title: '初始健康' });
assert.strictEqual(pushes.length, 0, '从初始进入 ok 不应推送');

// 翻转 1: ok -> critical
fakeNow += 10000;
const r1 = await sendAlert({ subsystem: 'test_sub', level: 'critical', title: '第1次卡顿' });
assert.strictEqual(r1.action, 'edge');
assert.strictEqual(pushes.length, 1);
assert(pushes[0].md.includes('database:saveMessages'), '告警证据应自动携带慢日志');

// 翻转 2: critical -> ok (恢复)
fakeNow += 15000;
const r2 = await sendAlert({ subsystem: 'test_sub', level: 'ok', title: '第1次恢复' });
assert.strictEqual(r2.action, 'recovery');
assert.strictEqual(pushes.length, 2);

// 翻转 3: ok -> critical (再次卡顿 -> 触发 FLAPPING 震荡判定)
fakeNow += 15000;
const r3 = await sendAlert({ subsystem: 'test_sub', level: 'critical', title: '第2次卡顿' });
assert.strictEqual(r3.action, 'flapping_suppressed', '进入震荡态应发送震荡抑制聚合告警');
assert(pushes[2].md.includes('震荡抑制'), '卡片应声明已启动抑制');

// 在 FLAPPING 期间的翻转 4: critical -> ok
fakeNow += 15000;
const r4 = await sendAlert({ subsystem: 'test_sub', level: 'ok', title: '第2次假恢复' });
assert.strictEqual(r4.action, 'flapping_silenced', '在震荡态中单次 ok 必须被彻底静音，消灭刷屏');
assert.strictEqual(pushes.length, 3, '被静音的 ok 绝不发企微卡片');

// 在 FLAPPING 期间的翻转 5: ok -> critical
fakeNow += 15000;
const r5 = await sendAlert({ subsystem: 'test_sub', level: 'critical', title: '第3次卡顿' });
assert.strictEqual(r5.action, 'flapping_deduped', '震荡期内的重复 critical 应被严格去重');
assert.strictEqual(pushes.length, 3, '去重后总发送数保持在 3 条');

// 验证统计信息
const stats = getAlertSinkStats();
assert(stats.flappingSubsystems.includes('test_sub'), 'test_sub 应处于 flapping 状态');
console.log('   ✅ 防震荡状态机与单次恢复静音验证通过！');

// ============================================================================
// 4. 测试三级阶梯背压控制器 (Backpressure Controller)
// ============================================================================
console.log('4. 验证三级阶梯背压控制器...');
_resetBackpressureForTests();

// 初始状态 NORMAL (25s)
assert.strictEqual(getBackpressureStatus().tier, 'NORMAL');
assert.strictEqual(getEffectivePollIntervalSec(), 25);
assert.strictEqual(shouldPauseSecondaryWorkers(), false);

// 1个周期 p99 = 1500ms -> 尚未达到 2 个周期，保持 NORMAL
updateBackpressureMetrics({ p99Ms: 1500, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'NORMAL');
assert.strictEqual(getEffectivePollIntervalSec(), 25);

// 连续第 2 个周期 p99 = 1800ms -> 进入 THROTTLED_L1 (60s) 并暂停媒体 worker
updateBackpressureMetrics({ p99Ms: 1800, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'THROTTLED_L1');
assert.strictEqual(getEffectivePollIntervalSec(), 60);
assert.strictEqual(shouldPauseSecondaryWorkers(), true);

// 突发 p99 >= 5000ms 或 HTTP 探测失败 -> 直接进入 THROTTLED_L2 (120s)
updateBackpressureMetrics({ p99Ms: 5500, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'THROTTLED_L2');
assert.strictEqual(getEffectivePollIntervalSec(), 120);
assert.strictEqual(shouldPauseSecondaryWorkers(), true);

// 恢复阶段：连续 3 个周期 p99 <= 50ms 阶梯回退到 THROTTLED_L1 (不瞬间拉满)
updateBackpressureMetrics({ p99Ms: 20, httpOk: true });
updateBackpressureMetrics({ p99Ms: 25, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'THROTTLED_L2', '未满 3 周期保持 L2');
updateBackpressureMetrics({ p99Ms: 30, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'THROTTLED_L1', '满 3 周期阶梯降到 L1 (60s)');
assert.strictEqual(getEffectivePollIntervalSec(), 60);

// 再连续 3 个周期健康，彻底回到 NORMAL (25s)
updateBackpressureMetrics({ p99Ms: 15, httpOk: true });
updateBackpressureMetrics({ p99Ms: 18, httpOk: true });
updateBackpressureMetrics({ p99Ms: 22, httpOk: true });
assert.strictEqual(getBackpressureStatus().tier, 'NORMAL', '再次满 3 周期回到 NORMAL');
assert.strictEqual(getEffectivePollIntervalSec(), 25);
assert.strictEqual(shouldPauseSecondaryWorkers(), false);
console.log('   ✅ 三级阶梯背压控制器验证通过！');

console.log('\n🎉 ALL TESTS PASSED: test_flapping_and_backpressure');
