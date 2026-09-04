/**
 * @file test/test_monitoring_db_and_queues.js
 * @description P1-7 自动化回归测试：
 * 1. 验证 monitoring.db 独立库初始化、WAL 模式、时序采样与裁剪；
 * 2. 验证 queue-watermark-probe 只读探针与状态判定；
 * 3. 验证 /health 聚合 payload 包含 queues 与 monitoringDb；
 * 4. 验证 R3 红线：whop_archive.db 无任何 monitoring 表。
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  initMonitoringDb,
  getMonitoringDb,
  recordHealthEvent,
  recordMetricSample,
  recordAlertHistory,
  pruneOldMetrics,
  getMonitoringDbStats,
  closeMonitoringDb,
} from '../monitoring/monitoring-db.js';
import { checkQueueHealth, getQueueSnapshot } from '../monitoring/queue-watermark-probe.js';
import { buildHealthPayload } from '../monitoring/health.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[AssertionFailed] ${message}`);
  }
}

async function runTests() {
  console.log('--- 开始执行 P1-7 测试: test_monitoring_db_and_queues ---');

  const testMonDbPath = path.resolve('data/test_monitoring.db');
  if (fs.existsSync(testMonDbPath)) {
    fs.unlinkSync(testMonDbPath);
  }

  // 1. 验证 monitoring.db 独立库初始化
  console.log('1. 验证 monitoring.db 独立库初始化与 WAL 模式...');
  const db = initMonitoringDb(testMonDbPath);
  const journalMode = db.pragma('journal_mode', { simple: true });
  assert(journalMode.toLowerCase() === 'wal', `journal_mode should be wal, got: ${journalMode}`);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  assert(tables.includes('health_events'), 'table health_events should exist');
  assert(tables.includes('metric_samples'), 'table metric_samples should exist');
  assert(tables.includes('alert_history'), 'table alert_history should exist');
  console.log('   ✅ monitoring.db 独立初始化与 WAL 模式通过！');

  // 2. 验证写入事件与采样
  console.log('2. 验证时序数据写入与查询...');
  recordHealthEvent({
    subsystem: 'test_sys',
    prevLevel: 'ok',
    level: 'warn',
    detail: '测试轻度延迟',
    evidence: { testValue: 123 },
  });

  recordMetricSample({
    eventLoopMeanMs: 25.5,
    eventLoopP99Ms: 30.1,
    eventLoopMaxMs: 45.0,
    memoryRssMb: 120,
    mediaPending: 5,
    totalPending: 10,
  });

  recordAlertHistory({
    subsystem: 'test_sys',
    level: 'warn',
    title: '测试告警',
    detail: '这是一条写入独立库的告警',
  });

  const stats = getMonitoringDbStats();
  assert(stats.eventsLogged >= 1, `eventsLogged >= 1, got: ${stats.eventsLogged}`);
  assert(stats.metricSamples >= 1, `metricSamples >= 1, got: ${stats.metricSamples}`);
  assert(stats.alertsLogged >= 1, `alertsLogged >= 1, got: ${stats.alertsLogged}`);
  console.log('   ✅ 监控事件、时序采样与告警历史写入通过！');

  // 3. 验证空间自动治理 (prune)
  console.log('3. 验证 7 天数据保留策略裁剪...');
  // 插入一条 8 天前的伪造数据
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO metric_samples (ts, created_at_beijing, event_loop_mean_ms, event_loop_p99_ms, event_loop_max_ms, memory_rss_mb, media_pending, total_pending)
    VALUES (?, '2026-08-20', 10, 10, 10, 100, 0, 0)
  `).run(eightDaysAgo);

  pruneOldMetrics(7);
  const oldRow = db.prepare('SELECT * FROM metric_samples WHERE ts < ?').get(Date.now() - 7 * 24 * 60 * 60 * 1000);
  assert(!oldRow, '8-day-old record should have been pruned');
  console.log('   ✅ 7 天数据自动裁剪通过！');

  // 4. 验证队列只读探针
  console.log('4. 验证队列与水位只读探针...');
  const qSnap = checkQueueHealth();
  assert(typeof qSnap.status === 'string', 'qSnap status should be string');
  assert(typeof qSnap.mediaPending === 'number', 'mediaPending should be number');
  assert(typeof qSnap.totalPending === 'number', 'totalPending should be number');
  assert(qSnap.queues, 'queues dictionary exists');
  console.log(`   ✅ 队列探针探测完成: ${qSnap.summary}`);

  // 5. 验证 /health 聚合 payload
  console.log('5. 验证 GET /health 聚合 payload 完整性...');
  const health = buildHealthPayload();
  assert(health.subsystems.queues, 'subsystems.queues exists');
  assert(health.subsystems.monitoringDb, 'subsystems.monitoringDb exists');
  assert(health.subsystems.monitoringDb.isolated === true, 'monitoringDb.isolated should be true');
  console.log('   ✅ /health 聚合 subsystems 包含 queues 与 monitoringDb！');

  // 6. 验证 R3 红线：主业务库绝无监控表
  console.log('6. 验证 R3 红线: 检查 whop_archive.db 结构隔离...');
  const mainDbPath = path.resolve('whop_archive.db');
  if (fs.existsSync(mainDbPath)) {
    const mainDb = new Database(mainDbPath, { readonly: true });
    const mainTables = mainDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    mainDb.close();
    assert(!mainTables.includes('health_events'), 'R3 violation: health_events must not exist in whop_archive.db');
    assert(!mainTables.includes('metric_samples'), 'R3 violation: metric_samples must not exist in whop_archive.db');
    assert(!mainTables.includes('alert_history'), 'R3 violation: alert_history must not exist in whop_archive.db');
    console.log('   ✅ R3 红线核验通过：whop_archive.db 绝无任何监控时序表！');
  }

  // 清理测试库
  closeMonitoringDb();
  if (fs.existsSync(testMonDbPath)) {
    fs.unlinkSync(testMonDbPath);
  }
  const walPath = `${testMonDbPath}-wal`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  const shmPath = `${testMonDbPath}-shm`;
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  console.log('\n🎉 ALL P1-7 TESTS PASSED: test_monitoring_db_and_queues\n');
}

runTests().catch((err) => {
  console.error('❌ P1-7 测试失败:', err);
  process.exit(1);
});
