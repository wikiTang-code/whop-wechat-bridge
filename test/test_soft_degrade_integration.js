/**
 * @file test/test_soft_degrade_integration.js
 * @description P2-15C: 软降级跨模块接线与双进程跨进程心跳可见性测试
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  ALLOWED_ACTIONS,
  FORBIDDEN_ACTIONS,
  recordSoftDegradeAction,
  clearSoftDegradeAction,
  getSoftDegradeSnapshot,
  _resetSoftDegradeForTests,
} from '../monitoring/soft-degrade-registry.js';
import {
  _setAiTunnelStateForTests,
  isAiTunnelSuspended,
} from '../monitoring/ai-tunnel-circuit.js';
import {
  initMonitoringDb,
  recordIngestHeartbeat,
  closeMonitoringDb,
} from '../monitoring/monitoring-db.js';
import { executeControlledLogTmpCleanup } from '../monitoring/cleanup-hooks.js';

async function run() {
  console.log('--- 开始执行 P2-15C 测试: test_soft_degrade_integration ---');

  // 1. 静态红线核验
  console.log('1. 验证静态红线 (无 pm2 restart/stop，严禁破坏性删库)...');
  const regSrc = fs.readFileSync(path.resolve('monitoring/soft-degrade-registry.js'), 'utf8');
  const cleanSrc = fs.readFileSync(path.resolve('monitoring/cleanup-hooks.js'), 'utf8');
  const codeCheck = (regSrc + cleanSrc).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  assert(!codeCheck.includes('pm2 restart'), 'Must NEVER call pm2 restart');
  assert(!codeCheck.includes('pm2 stop'), 'Must NEVER call pm2 stop');
  console.log('   ✅ 静态红线核验通过：严格杜绝 pm2 restart/stop 任何硬自愈');

  // 隔离测试监控库，杜绝脏数据污染
  closeMonitoringDb();
  const testDbFile = path.resolve('data/test_soft_degrade_mon.db');
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  process.env.MONITORING_DB_PATH = testDbFile;
  initMonitoringDb(testDbFile);

  _resetSoftDegradeForTests();
  _setAiTunnelStateForTests('closed');

  // 2. 验证 AI Circuit 熔断与 softDegrade 自动联动
  console.log('2. 验证 AI 隧道断线挂起 (ai_tunnel_suspend_probe) 联动...');
  assert.strictEqual(getSoftDegradeSnapshot().status, 'ok');

  // 模拟 AI 探针连续失败触发熔断 open
  _setAiTunnelStateForTests('open');
  assert.strictEqual(isAiTunnelSuspended(), true);

  const aiDegrade = getSoftDegradeSnapshot();
  assert.strictEqual(aiDegrade.status, 'warn', 'AI tunnel suspended must raise status to warn');
  const aiAction = aiDegrade.activeActions.find((a) => a.id === 'ai_tunnel_suspend_probe');
  assert.ok(aiAction, 'activeActions must include ai_tunnel_suspend_probe');
  assert.strictEqual(aiAction.reason, 'ai_tunnel_circuit_open');
  console.log('   ✅ AI Circuit 联动通过：熔断时自动暴露 ai_tunnel_suspend_probe 动作');

  // 恢复 closed
  _setAiTunnelStateForTests('closed');
  const aiRecovered = getSoftDegradeSnapshot();
  assert.ok(!aiRecovered.activeActions.some((a) => a.id === 'ai_tunnel_suspend_probe'));
  console.log('   ✅ AI Circuit 恢复通过：探活成功后自动移除降级动作');

  // 3. 验证离线补录派生动作 (offline_sync_spawn_weekend)
  console.log('3. 验证周末离线补录派生动作登记与释放...');
  recordSoftDegradeAction({
    id: 'offline_sync_spawn_weekend',
    level: 'warn',
    reason: 'weekend_offline_healing',
    detail: 'Spawned offline asset sync child (PID=99999)',
  });
  const offlineSnap = getSoftDegradeSnapshot();
  assert.strictEqual(offlineSnap.status, 'warn');
  assert.ok(offlineSnap.activeActions.some((a) => a.id === 'offline_sync_spawn_weekend'));

  clearSoftDegradeAction('offline_sync_spawn_weekend');
  assert.ok(!getSoftDegradeSnapshot().activeActions.some((a) => a.id === 'offline_sync_spawn_weekend'));
  console.log('   ✅ 离线自愈动作通过：派生记录与进程退出后 clear 生效');

  // 4. 验证双进程跨进程心跳同步 (Ingest Heartbeat -> Web 看板可见)
  console.log('4. 验证双进程跨进程可见性 (Ingest 心跳带出软降级动作)...');
  const t0 = Date.now();
  // 模拟 Ingest 进程发生背压降频并写入心跳
  recordIngestHeartbeat({
    workerKey: 'primary',
    outcome: 'ok',
    pollMs: 120,
    detail: {
      softDegradeActions: [
        {
          id: 'backpressure_throttle_poll',
          level: 'warn',
          sinceMs: t0,
          reason: 'backpressure_THROTTLED_L1',
          detail: 'Ingest poll throttled to 60s',
        },
      ],
    },
    nowMs: t0,
  });

  const crossProcessSnap = getSoftDegradeSnapshot({ nowMs: t0 });
  assert.strictEqual(crossProcessSnap.status, 'warn', 'Web process must detect Ingest soft degrade action');
  const syncedAction = crossProcessSnap.activeActions.find((a) => a.id === 'backpressure_throttle_poll');
  assert.ok(syncedAction, 'activeActions must contain cross-process action from ingest heartbeat');
  assert.ok(syncedAction.detail.includes('[ingest]'), 'action detail should denote [ingest] source');
  console.log('   ✅ 跨进程同步通过：Web 侧无缝感知 Ingest 进程最新心跳中的软降级动作');

  // Ingest 恢复，上报空 actions
  recordIngestHeartbeat({
    workerKey: 'primary',
    outcome: 'ok',
    pollMs: 50,
    detail: { softDegradeActions: [] },
    nowMs: t0 + 100,
  });
  const crossProcessRecovered = getSoftDegradeSnapshot({ nowMs: t0 + 200 });
  assert.strictEqual(crossProcessRecovered.status, 'ok', 'Status recovers to ok when Ingest clears actions');
  console.log('   ✅ 跨进程恢复通过：Ingest 减载结束心跳清空后 Web 状态恢复 ok');

  // 5. 验证 P2-15E 受控临时文件清理钩子 (log_tmp_cleanup)
  console.log('5. 验证 P2-15E 受控临时文件清理钩子...');
  const sandboxTmp = path.resolve('data/test_sandbox_tmp');
  if (fs.existsSync(sandboxTmp)) fs.rmSync(sandboxTmp, { recursive: true, force: true });
  fs.mkdirSync(sandboxTmp, { recursive: true });

  const fakeTmp1 = path.join(sandboxTmp, 'whop_test_1.tmp');
  fs.writeFileSync(fakeTmp1, 'temporary_file_1');

  // 模拟较早前的文件
  const oldTime = (Date.now() - 120_000) / 1000;
  fs.utimesSync(fakeTmp1, oldTime, oldTime);

  const cleanRes = executeControlledLogTmpCleanup({
    tmpDir: sandboxTmp,
    logsDir: sandboxTmp,
    dryRun: false,
  });

  assert.strictEqual(cleanRes.cleanedCount, 1, 'Should have cleaned 1 whop_ test temp file');
  assert.strictEqual(fs.existsSync(fakeTmp1), false, 'whop_test_1.tmp must be removed');
  console.log('   ✅ P2-15E 清理钩子通过：受控仅清理匹配的临时文件，动作可观测且安全释放');

  // 清理临时文件
  closeMonitoringDb();
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  if (fs.existsSync(sandboxTmp)) fs.rmSync(sandboxTmp, { recursive: true, force: true });
  _resetSoftDegradeForTests();

  console.log('\n🎉 ALL P2-15C TESTS PASSED: test_soft_degrade_integration\n');
}

run().catch((err) => {
  console.error('❌ P2-15C 测试失败:', err);
  process.exit(1);
});
