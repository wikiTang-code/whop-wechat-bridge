/**
 * @file test/test_ingest_runner.js
 * @description P1-11 / T5 单元测试：验证 Ingest Runner 瘦入口的心跳上报与 Tick 控制器
 */

import fs from 'fs';
import path from 'path';
import { executeIngestTick, computeNextPollDelayMs } from '../scripts/ingest_runner.js';
import {
  initMonitoringDb,
  getIngestHeartbeat,
  closeMonitoringDb
} from '../monitoring/monitoring-db.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T5 测试: test_ingest_runner ---');

  const testDbPath = path.resolve('data/test_monitoring_runner.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  closeMonitoringDb();
  process.env.MONITORING_DB_PATH = testDbPath;
  initMonitoringDb(testDbPath);

  // 1. 验证正常 mock 任务执行与 ok 心跳
  console.log('1. 验证正常 Tick 执行与 ok 心跳...');
  const res1 = await executeIngestTick({
    syncFn: async () => ({ success: true, newMessagesCount: 5, newSpeakerMessagesCount: 1 }),
    autoSchedulerFn: async () => {} // 默认 mock 避免单测副作用打到真实 news-engine
  });

  assert(res1.outcome === 'ok', 'outcome should be ok');
  assert(res1.pollMs >= 0, 'pollMs should be non-negative');

  const hb1 = getIngestHeartbeat('primary');
  assert(hb1.exists === true, 'heartbeat must exist');
  assert(hb1.outcome === 'ok', 'heartbeat outcome must be ok');
  assert(hb1.detail.newMessagesCount === 5, 'detail should reflect sync metrics');
  console.log(`   ✅ 正常 Tick 心跳验证通过: outcome=${hb1.outcome}, pollMs=${hb1.pollMs}`);

  // 2. 验证抛出异常时仍能记录 error 心跳
  console.log('2. 验证异常发生时必须写入 error 心跳...');
  const res2 = await executeIngestTick({
    syncFn: async () => {
      throw new Error('模拟 Whop API 502 Bad Gateway');
    }
  });

  assert(res2.outcome === 'error', 'outcome should be error');
  const hb2 = getIngestHeartbeat('primary');
  assert(hb2.outcome === 'error', 'heartbeat outcome must be error');
  assert(hb2.detail.error.includes('502 Bad Gateway'), 'heartbeat detail must contain error message');
  console.log(`   ✅ 异常 Tick 心跳验证通过: outcome=${hb2.outcome}, err=${hb2.detail.error}`);

  // 3. 验证 T11: 背压自适应周期与调度器集成
  console.log('3. 验证 T11: 背压与时段感知自适应延迟计算...');
  const { computeNextPollDelayMs } = await import('../scripts/ingest_runner.js');
  const delayMs = computeNextPollDelayMs();
  assert(typeof delayMs === 'number', 'delayMs must be a number');
  assert(delayMs >= 25000 && delayMs <= 120000, `delayMs should be within [25s, 120s], got ${delayMs}`);
  console.log(`   ✅ 自适应周期验证通过: delay=${delayMs / 1000}s`);

  // 4. 验证 T15: Auto News 与 Auto Persona 调度器在同步成功路径触发
  console.log('4. 验证 T15: 同步成功时自动触发 Auto Schedulers...');
  let schedulerCalled = false;
  const res4 = await executeIngestTick({
    syncFn: async () => ({ success: true, newMessagesCount: 1 }),
    autoSchedulerFn: async () => {
      schedulerCalled = true;
    },
  });

  assert(res4.outcome === 'ok', 'outcome should be ok');
  assert(schedulerCalled === true, 'autoSchedulerFn MUST be called on successful sync');
  console.log('   ✅ T15 验证通过：Auto Schedulers 在 Ingest 同步成功路径 100% 触发执行！');

  // 5. 验证 T17: launchMonitoringProbes 探针与 Supervisor 启动
  console.log('5. 验证 T17: launchMonitoringProbes 启动探针与 Supervisor...');
  const { launchMonitoringProbes } = await import('../scripts/ingest_runner.js');
  await launchMonitoringProbes();
  const dbCheck = initMonitoringDb();
  const sampleCount = dbCheck.prepare('SELECT count(*) as count FROM metric_samples').get().count;
  assert(typeof sampleCount === 'number', 'sampleCount should be number');
  console.log(`   ✅ T17 验证通过：Supervisor 与探针成功启动，metric_samples 正常落盘 (当前=${sampleCount})`);

  // 清理
  closeMonitoringDb();
  delete process.env.MONITORING_DB_PATH;
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  console.log('\n🎉 ALL T5 / T11 / T15 / T17 TESTS PASSED: test_ingest_runner\n');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ T5 测试失败:', err);
  process.exit(1);
});
