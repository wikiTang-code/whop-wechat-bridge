/**
 * @file test/test_consistency_smoke_watchdog.js
 * @description P2-13E: 验证看门狗 consistency_smoke.sh 静态红线 (R1/R2) 与端到端检测
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { startWebServer } from '../scripts/web_runner.js';
import { recordIngestHeartbeat, initMonitoringDb } from '../monitoring/monitoring-db.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P2-13E 测试: test_consistency_smoke_watchdog ---');

  const scriptPath = path.resolve('scripts/watchdog/consistency_smoke.sh');
  assert(fs.existsSync(scriptPath), 'consistency_smoke.sh must exist');

  const content = fs.readFileSync(scriptPath, 'utf8');
  const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  // 1. 静态红线核验
  console.log('1. 验证 R1/R2 红线与告警文案规范...');
  assert(!codeOnly.includes('pm2 restart'), 'consistency_smoke.sh must NEVER call pm2 restart');
  assert(!codeOnly.includes('pm2 stop'), 'consistency_smoke.sh must NEVER call pm2 stop');
  assert(content.includes('媒体数据一致性'), 'alert title must mention 媒体数据一致性');
  assert(content.includes('watchdog_alert.sh'), 'must source watchdog_alert.sh');
  console.log('   ✅ 静态红线核验通过：禁止 pm2 restart，文案对齐，纯 bash 探测');

  // 2. 端到端活体冒烟核验
  console.log('2. 启动临时 Web 服务执行端到端一致性冒烟测试...');
  const port = 18096;
  process.env.READONLY_MODE = '1';
  process.env.ROLE = 'web_dashboard';
  process.env.ENABLE_TUNNEL = '0';
  delete process.env.DASHBOARD_USERNAME;
  delete process.env.DASHBOARD_PASSWORD;

  initMonitoringDb();
  recordIngestHeartbeat({ outcome: 'ok', nowMs: Date.now() });

  const server = await startWebServer(port);
  const stateRelPath = 'scripts/watchdog/.test_consistency_state';
  const stateFile = path.resolve(stateRelPath);
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

  const getBashCmd = () => {
    if (process.platform === 'win32') {
      const candidates = [
        'D:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    return 'bash';
  };

  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(getBashCmd(), [
        'scripts/watchdog/consistency_smoke.sh'
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WATCHDOG_HOST: '127.0.0.1',
          WATCHDOG_PORT: String(port),
          WATCHDOG_BASE_URL: `http://127.0.0.1:${port}`,
          WATCHDOG_TIMEOUT_SEC: '3',
          WATCHDOG_DRY_RUN: '1',
          CONSISTENCY_SMOKE_STATE_FILE: stateRelPath,
        },
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', c => stdout += c);
      child.stderr.on('data', c => stderr += c);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`consistency_smoke.sh exited with code ${code}: ${stderr}\n${stdout}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
      child.on('error', reject);
    });

    console.log('   [consistency_smoke stdout]:\n', output.stdout.trim());
    assert(output.stdout.includes('status=ok'), 'consistency probe should be ok on healthy web_runner');
    console.log('   ✅ 端到端冒烟测试通过：健康状态与一致性抽样正常响应 (status=ok)');
  } finally {
    await new Promise(r => server.close(r));
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }

  console.log('\n🎉 ALL P2-13E TESTS PASSED: test_consistency_smoke_watchdog\n');
}

run().catch(err => {
  console.error('❌ P2-13E 测试失败:', err);
  process.exit(1);
});
