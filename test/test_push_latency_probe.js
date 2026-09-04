/**
 * @file test/test_push_latency_probe.js
 * @description P1-10 单元测试：验证大V推送与交易链路端到端时延（TTL）与积压监测探针
 */

import {
  recordPushMetric,
  calculateRecentPushStats,
  checkPushPipelineHealth,
  getPushPipelineSnapshot,
  _resetPushMetricsForTests,
} from '../monitoring/push-latency-probe.js';

function assert(condition, msg) {
  if (!condition) throw new Error('[AssertionFailed] ' + msg);
}

async function run() {
  console.log('--- 开始执行 P1-10 测试: test_push_latency_probe ---');

  // 1. 初始化重置
  _resetPushMetricsForTests();
  const initSnap = getPushPipelineSnapshot();
  assert(initSnap.status === 'ok', 'init status should be ok');
  assert(initSnap.consecutiveFailures === 0, 'init consecutiveFailures should be 0');
  console.log('   ✅ 1. 探针初始状态验证通过');

  // 2. 模拟常规成功推送打点
  const now = Date.now();
  recordPushMetric({
    messageId: 'msg_001',
    speakerName: 'zhao',
    createdAt: now - 3500, // 3.5 秒前生成
    pushedAt: now,
    rttMs: 220,
    success: true,
  });

  const stats1 = calculateRecentPushStats();
  assert(stats1.sampleCount === 1, 'sampleCount should be 1');
  assert(stats1.avgTtlMs >= 3000, 'avgTtlMs should reflect ~3500ms');
  assert(stats1.avgRttMs === 220, 'avgRttMs should match');
  assert(stats1.successRate === 1.0, 'successRate should be 1.0');
  assert(stats1.consecutiveFailures === 0, 'consecutiveFailures should be 0');
  console.log('   ✅ 2. 单次推送打点与 TTL 统计验证通过 (TTL=' + stats1.avgTtlMs + 'ms, RTT=' + stats1.avgRttMs + 'ms)');

  // 3. 批量推入多个样本，验证分位数与环形缓冲
  for (let i = 2; i <= 20; i++) {
    const t = now + i * 1000;
    recordPushMetric({
      messageId: 'msg_' + i,
      speakerName: 'zhao',
      createdAt: t - (1000 + i * 200),
      pushedAt: t,
      rttMs: 150 + i * 10,
      success: true,
    });
  }
  const stats20 = calculateRecentPushStats();
  assert(stats20.sampleCount === 20, 'sampleCount should be 20');
  assert(stats20.p95TtlMs > 0, 'p95TtlMs should be calculated');
  assert(stats20.maxTtlMs >= stats20.p95TtlMs, 'maxTtlMs >= p95TtlMs');
  console.log('   ✅ 3. 批量打点与 P95 时延验证通过 (P95 TTL=' + stats20.p95TtlMs + 'ms, Max TTL=' + stats20.maxTtlMs + 'ms)');

  // 4. 验证推送失败感知与连续失败告警级别
  recordPushMetric({
    messageId: 'msg_fail_1',
    speakerName: 'zhao',
    createdAt: now,
    pushedAt: now + 500,
    rttMs: 500,
    success: false,
    error: 'HTTP 429: Too Many Requests',
  });

  let probeSnap = checkPushPipelineHealth();
  assert(probeSnap.status === 'warn', 'Single failure should trigger warn status');
  assert(probeSnap.consecutiveFailures === 1, 'consecutiveFailures should be 1');
  console.log('   ✅ 4. 单次推送失败触发 WARN 判定通过: ' + probeSnap.summary);

  // 连续失败 3 次触发 CRITICAL
  recordPushMetric({
    messageId: 'msg_fail_2',
    speakerName: 'zhao',
    createdAt: now,
    pushedAt: now + 600,
    success: false,
    error: 'HTTP 502: Bad Gateway',
  });
  recordPushMetric({
    messageId: 'msg_fail_3',
    speakerName: 'zhao',
    createdAt: now,
    pushedAt: now + 700,
    success: false,
    error: 'HTTP 504: Gateway Timeout',
  });

  probeSnap = checkPushPipelineHealth();
  assert(probeSnap.status === 'critical', '3 consecutive failures must trigger critical');
  assert(probeSnap.consecutiveFailures === 3, 'consecutiveFailures should be 3');
  console.log('   ✅ 5. 连续 3 次推送失败触发 CRITICAL 判定通过: ' + probeSnap.summary);

  // 恢复单次成功后，连续失败清零，状态恢复
  recordPushMetric({
    messageId: 'msg_recovered',
    speakerName: 'zhao',
    createdAt: now,
    pushedAt: now + 200,
    success: true,
  });
  probeSnap = checkPushPipelineHealth();
  assert(probeSnap.status === 'ok', 'After recovery, status should return to ok');
  assert(probeSnap.consecutiveFailures === 0, 'consecutiveFailures should reset to 0');
  console.log('   ✅ 6. 推送恢复后连续失败自动清零恢复 OK 验证通过');

  // 7. 验证跳过推送（如静音模式）不影响健康度
  recordPushMetric({
    messageId: 'msg_skipped',
    speakerName: 'zhao',
    skipped: true,
  });
  probeSnap = checkPushPipelineHealth();
  assert(probeSnap.status === 'ok', 'Skipped push should not degrade status');
  console.log('   ✅ 7. 跳过推送 (skipWeChat) 静默安全验证通过');

  console.log('\n🎉 ALL P1-10 TESTS PASSED: test_push_latency_probe\n');
}

run().catch(err => {
  console.error('❌ P1-10 测试失败:', err);
  process.exit(1);
});
