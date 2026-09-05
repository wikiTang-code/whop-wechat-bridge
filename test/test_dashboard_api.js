/**
 * @file test/test_dashboard_api.js
 * @description P2-11 / P2-C 单元测试：验证 GET /api/monitoring/dashboard API 契约与 Schema 稳定性
 *
 * 验收要求:
 * 1. 双进程内存: webRssMb / ingestRssMb / combinedRssMb (缺失时 combinedRssMb=null)
 * 2. 精确 7 大核心子系统: ingest, aiTunnel, eventLoop, monitoringDb, queues, assets, pushPipeline
 * 3. 彻底消除假 P95: sparklines.pushP95 绝不出现假常数 180，且包含 notes.pushP95 = 'not_sampled'
 * 4. 只读安全性与历史告警契约
 */

import { getDashboardPayload } from '../monitoring/dashboard-api.js';
import { recordIngestHeartbeat, initMonitoringDb, closeMonitoringDb } from '../monitoring/monitoring-db.js';
import path from 'path';
import fs from 'fs';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P2-C 测试: test_dashboard_api ---');

  // 1. 验证默认环境下的 payload 结构与字段类型
  console.log('1. 验证 getDashboardPayload 基础契约稳定性...');
  const payload = getDashboardPayload();

  assert(payload.success === true, 'payload.success should be true');
  assert(typeof payload.timestamp === 'number', 'timestamp must be a number');
  assert(typeof payload.serverTimeBeijing === 'string', 'serverTimeBeijing must be a string');

  // market 节点
  assert(payload.market, 'payload.market must exist');
  assert(typeof payload.market.isClosed === 'boolean', 'market.isClosed must be boolean');
  assert(typeof payload.market.currentET === 'string', 'market.currentET must be string');
  assert(typeof payload.market.statusText === 'string', 'market.statusText must be string');

  // overall 节点与双进程 memory 契约
  console.log('2. 验证 overall.memory 双进程语义与空值表现...');
  assert(payload.overall, 'payload.overall must exist');
  assert(typeof payload.overall.status === 'string', 'overall.status must be string');
  assert(typeof payload.overall.uptimeSeconds === 'number', 'overall.uptimeSeconds must be number');
  assert(payload.overall.memory, 'overall.memory must exist');

  const mem = payload.overall.memory;
  assert(typeof mem.webRssMb === 'number' && mem.webRssMb > 0, 'webRssMb must be positive number');
  assert(mem.budgetMb === 958.0, 'budgetMb must be 958.0');

  if (mem.ingestRssMb === null) {
    assert(mem.combinedRssMb === null, 'combinedRssMb must be null when ingestRssMb is missing (no silent || 0)');
    console.log('   ✅ 空值语义验证通过: ingestRssMb 为 null 时 combinedRssMb 严格为 null');
  } else {
    assert(typeof mem.ingestRssMb === 'number', 'ingestRssMb must be number when present');
    assert(typeof mem.combinedRssMb === 'number', 'combinedRssMb must be number when ingest present');
  }

  // 3. subsystems 节点（严格对齐 7 大核心子系统键名）
  console.log('3. 验证 7 大核心子系统键名完整性与状态字段...');
  assert(payload.subsystems, 'payload.subsystems must exist');
  const requiredSubsystems = [
    'ingest',
    'aiTunnel',
    'eventLoop',
    'monitoringDb',
    'queues',
    'assets',
    'pushPipeline',
  ];

  for (const sub of requiredSubsystems) {
    assert(payload.subsystems[sub], `subsystems must contain key: ${sub}`);
    assert(typeof payload.subsystems[sub].status === 'string', `${sub}.status must be string`);
  }
  console.log('   ✅ 7 大子系统键名对齐核验通过: ingest, aiTunnel, eventLoop, monitoringDb, queues, assets, pushPipeline');

  // 4. recentAlerts 与 sparklines 真实性校验 (严禁假 P95)
  console.log('4. 验证 sparklines 时序真实性，彻底断言绝无 180 伪常数...');
  assert(Array.isArray(payload.recentAlerts), 'recentAlerts must be an array');
  assert(payload.sparklines, 'sparklines must exist');
  assert(Array.isArray(payload.sparklines.timestamps), 'sparklines.timestamps must be an array');
  assert(Array.isArray(payload.sparklines.memoryRss), 'sparklines.memoryRss must be an array');
  assert(Array.isArray(payload.sparklines.pushP95), 'sparklines.pushP95 must be an array');

  // 核心断言：pushP95 绝不包含常数 180
  const hasFake180 = payload.sparklines.pushP95.some(val => val === 180);
  assert(!hasFake180, 'sparklines.pushP95 must NOT contain fake constant 180!');
  assert(payload.sparklines.pushP95.length === 0, 'sparklines.pushP95 should be empty array when not sampled');

  // 核心断言：必须带有诚实 notes
  assert(payload.sparklines.notes, 'sparklines.notes must exist');
  assert(payload.sparklines.notes.pushP95 === 'not_sampled', 'notes.pushP95 must be "not_sampled"');
  console.log('   ✅ 真实时序与 notes 校验通过: 无假常数 180, pushP95=[0], notes.pushP95="not_sampled"');

  // 5. 动态注入测试：模拟 Ingest 心跳携带真实 rssMb
  console.log('5. 动态注入验证: 当 Ingest 心跳上报 rssMb 时 combinedRssMb 准确合计...');
  const testMonDbPath = path.resolve('data/test_dashboard_p2c.db');
  if (fs.existsSync(testMonDbPath)) fs.unlinkSync(testMonDbPath);

  const prevEnv = process.env.MONITORING_DB_PATH;
  process.env.MONITORING_DB_PATH = testMonDbPath;
  initMonitoringDb(testMonDbPath);

  try {
    recordIngestHeartbeat({
      workerKey: 'primary',
      outcome: 'ok',
      pollMs: 250,
      detail: { rssMb: 52.4, newMessagesCount: 3 },
      nowMs: Date.now(),
    });

    const dynamicPayload = getDashboardPayload();
    assert(dynamicPayload.overall.memory.ingestRssMb === 52.4, 'ingestRssMb should be 52.4');
    assert(dynamicPayload.overall.memory.combinedRssMb !== null, 'combinedRssMb should be computed');
    const expectedCombined = Math.round((dynamicPayload.overall.memory.webRssMb + 52.4) * 10) / 10;
    assert(dynamicPayload.overall.memory.combinedRssMb === expectedCombined, `combinedRssMb must be ${expectedCombined}`);
    assert(typeof dynamicPayload.overall.memory.budgetPercent === 'number', 'budgetPercent should be computed');
    console.log(`   ✅ 动态双进程内存计算通过: Web=${dynamicPayload.overall.memory.webRssMb}MB + Ingest=52.4MB -> Combined=${expectedCombined}MB (${dynamicPayload.overall.memory.budgetPercent}%)`);
  } finally {
    closeMonitoringDb();
    if (fs.existsSync(testMonDbPath)) fs.unlinkSync(testMonDbPath);
    if (prevEnv) process.env.MONITORING_DB_PATH = prevEnv;
    else delete process.env.MONITORING_DB_PATH;
  }

  console.log('\n🎉 ALL P2-C TESTS PASSED: test_dashboard_api\n');
}

run().catch(err => {
  console.error('❌ P2-C 测试失败:', err);
  process.exit(1);
});

