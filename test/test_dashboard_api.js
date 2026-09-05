/**
 * @file test/test_dashboard_api.js
 * @description P2-11 / T8 单元测试：验证 GET /api/monitoring/dashboard API 契约与 Schema 稳定性
 */

import { getDashboardPayload } from '../monitoring/dashboard-api.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T8 测试: test_dashboard_api ---');

  // 1. 验证 payload 结构
  console.log('1. 验证 getDashboardPayload 契约 schema 稳定性...');
  const payload = getDashboardPayload();

  assert(payload.success === true, 'payload.success should be true');
  assert(typeof payload.timestamp === 'number', 'timestamp must be a number');
  assert(typeof payload.serverTimeBeijing === 'string', 'serverTimeBeijing must be a string');

  // market 节点
  assert(payload.market, 'payload.market must exist');
  assert(typeof payload.market.isClosed === 'boolean', 'market.isClosed must be boolean');
  assert(typeof payload.market.currentET === 'string', 'market.currentET must be string');
  assert(typeof payload.market.statusText === 'string', 'market.statusText must be string');

  // overall 节点
  assert(payload.overall, 'payload.overall must exist');
  assert(typeof payload.overall.status === 'string', 'overall.status must be string');
  assert(typeof payload.overall.uptimeSeconds === 'number', 'overall.uptimeSeconds must be number');
  assert(payload.overall.memory, 'overall.memory must exist');
  assert(typeof payload.overall.memory.rssMb === 'number', 'rssMb must be number');
  assert(payload.overall.memory.budgetMb === 958.0, 'budgetMb must be 958.0');

  // subsystems 节点
  assert(payload.subsystems, 'payload.subsystems must exist');
  assert(payload.subsystems.ingest_worker, 'subsystems must include ingest_worker');

  // recentAlerts 与 sparklines
  assert(Array.isArray(payload.recentAlerts), 'recentAlerts must be an array');
  assert(payload.sparklines, 'sparklines must exist');
  assert(Array.isArray(payload.sparklines.timestamps), 'sparklines.timestamps must be an array');
  assert(Array.isArray(payload.sparklines.memoryRss), 'sparklines.memoryRss must be an array');
  assert(Array.isArray(payload.sparklines.pushP95), 'sparklines.pushP95 must be an array');

  console.log('   ✅ 契约各字段类型与嵌套层次完全对齐 docs/p2-11-health-dashboard-wireframe.md！');
  console.log(`   - 现场体征: Global=${payload.overall.status}, Market=${payload.market.statusText}, RSS=${payload.overall.memory.rssMb}MB`);

  console.log('\n🎉 ALL T8 TESTS PASSED: test_dashboard_api\n');
}

run().catch(err => {
  console.error('❌ T8 测试失败:', err);
  process.exit(1);
});
