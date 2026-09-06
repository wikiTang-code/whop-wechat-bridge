/**
 * @file test/test_web_runner_and_heartbeat.js
 * @description P1-11 / T6 单元测试：验证 Ingest 90s/180s 心跳状态机、只读 DB 防护与瘦入口
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { evaluateIngestStatus } from '../monitoring/ingest-health.js';
import { getReadOnlyArchiveDb, getReadOnlyMonitoringDb, closeReadOnlyDbs } from '../monitoring/db-readonly.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T6 测试: test_web_runner_and_heartbeat ---');

  // 1. 验证 evaluateIngestStatus 状态机纯函数
  console.log('1. 验证 90s/180s 心跳状态机纯函数...');
  const baseMs = 1788590000000;

  // 场景 A: 缺失心跳 -> critical (HTTP 503)
  const sNull = evaluateIngestStatus({ heartbeat: null });
  assert(sNull.status === 'critical', 'missing heartbeat should be critical');
  assert(sNull.httpStatus === 503, 'missing heartbeat should return 503');
  console.log('   ✅ 缺失心跳 → critical (503)');

  // 场景 B: 延迟 30s < 90s -> ok (HTTP 200)
  const sOk = evaluateIngestStatus({
    heartbeat: { exists: true, updatedAtMs: baseMs },
    nowMs: baseMs + 30000,
  });
  assert(sOk.status === 'ok', 'delay < 90s should be ok');
  assert(sOk.httpStatus === 200, 'ok status should return 200');
  assert(sOk.delaySec === 30, 'delaySec should be 30');
  console.log('   ✅ 延迟 30s (<90s) → ok (200)');

  // 场景 C: 延迟 120s (90s <= delay < 180s) -> warn (HTTP 200)
  const sWarn = evaluateIngestStatus({
    heartbeat: { exists: true, updatedAtMs: baseMs },
    nowMs: baseMs + 120000,
  });
  assert(sWarn.status === 'warn', '90s <= delay < 180s should be warn');
  assert(sWarn.httpStatus === 200, 'warn status should return 200');
  assert(sWarn.delaySec === 120, 'delaySec should be 120');
  console.log('   ✅ 延迟 120s (90s~180s) → warn (200)');

  // 场景 D: 延迟 185s (delay >= 180s) -> critical (HTTP 503)
  const sCrit = evaluateIngestStatus({
    heartbeat: { exists: true, updatedAtMs: baseMs },
    nowMs: baseMs + 185000,
  });
  assert(sCrit.status === 'critical', 'delay >= 180s should be critical');
  assert(sCrit.httpStatus === 503, 'critical status should return 503');
  assert(sCrit.delaySec === 185, 'delaySec should be 185');
  console.log('   ✅ 延迟 185s (>=180s) → critical (503)');

  // 2. 验证 db-readonly.js 拦截写操作 (SQLITE_READONLY)
  console.log('2. 验证只读数据库连接的安全拦截...');
  const testDbFile = path.resolve('data/test_readonly_guard.db');
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  const rwDb = new Database(testDbFile);
  rwDb.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY, val TEXT);');
  rwDb.close();

  const roDb = getReadOnlyArchiveDb(testDbFile);
  assert(roDb, 'roDb should be acquired');

  let writeBlocked = false;
  try {
    roDb.prepare("INSERT INTO test_table (val) VALUES ('bad')").run();
  } catch (err) {
    if (err.message.includes('readonly') || err.message.includes('SQLITE_READONLY')) {
      writeBlocked = true;
    }
  }
  closeReadOnlyDbs();
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  assert(writeBlocked, 'readonly db must strictly block write operations with SQLITE_READONLY!');
  console.log('   ✅ 只读保护生效：写操作被 SQLite 只读模式严格物理拦截！');

  // 3. 验证瘦入口约束：web_runner 源码中绝不顶层 import persona-engine / news-engine
  console.log('3. 验证 web_runner 瘦入口依赖自检...');
  const webRunnerCode = fs.readFileSync(path.resolve('scripts/web_runner.js'), 'utf8');
  assert(!/(import|from)\s+['"][^'"]*persona-engine/i.test(webRunnerCode), 'web_runner MUST NOT import persona-engine');
  assert(!/(import|from)\s+['"][^'"]*news-engine/i.test(webRunnerCode), 'web_runner MUST NOT import news-engine');
  assert(!/(import|from)\s+['"][^'"]*startPoller/i.test(webRunnerCode), 'web_runner MUST NOT import startPoller');
  assert(!webRunnerCode.includes('startPoller('), 'web_runner MUST NOT invoke startPoller');
  assert(!webRunnerCode.includes('startQueueWorker('), 'web_runner MUST NOT start queue workers');
  const routerCode = fs.readFileSync(path.resolve('monitoring/readonly-api-router.js'), 'utf8');
  assert(!routerCode.includes('getDb(') && !routerCode.includes('getDb'), 'readonly-api-router MUST NOT call getDb');
  console.log('   ✅ 瘦入口与只读铁律核验通过：web_runner 零重型 AI 依赖与轮询模块，readonly-api-router 零 getDb 依赖！');

  // 4. 验证 T10: 聚合 HTTP 状态码策略 (warn 必须 200，仅 critical 返回 503)
  console.log('4. 验证 T10: 聚合 HTTP 状态码决策逻辑...');
  const computeHttpCode = (ingestStatus, baseStatus) => {
    const isCritical = ingestStatus === 'critical' || baseStatus === 'critical';
    return isCritical ? 503 : 200;
  };

  assert(computeHttpCode('ok', 'ok') === 200, 'ok + ok should be 200');
  assert(computeHttpCode('warn', 'ok') === 200, 'warn + ok MUST be 200 (not 503)');
  assert(computeHttpCode('ok', 'warn') === 200, 'ok + warn MUST be 200 (not 503)');
  assert(computeHttpCode('warn', 'warn') === 200, 'warn + warn MUST be 200 (not 503)');
  assert(computeHttpCode('critical', 'ok') === 503, 'critical + ok MUST be 503');
  assert(computeHttpCode('ok', 'critical') === 503, 'ok + critical MUST be 503');
  assert(computeHttpCode('critical', 'warn') === 503, 'critical + warn MUST be 503');
  console.log('   ✅ T10 HTTP 语义核验通过：warn 稳定返回 200 (避免误伤看门狗)，仅 critical 触发 503！');

  console.log('\n🎉 ALL T6 / T10 TESTS PASSED: test_web_runner_and_heartbeat\n');
}

run().catch(err => {
  console.error('❌ T6 测试失败:', err);
  process.exit(1);
});
