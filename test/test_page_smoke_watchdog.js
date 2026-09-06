/**
 * @file test/test_page_smoke_watchdog.js
 * @description P2-12d: 验证看门狗 page_smoke.sh 静态红线 (R1/R2) 与端到端冒烟检测
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { startWebServer } from '../scripts/web_runner.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P2-12d 测试: test_page_smoke_watchdog ---');

  const scriptPath = path.resolve('scripts/watchdog/page_smoke.sh');
  assert(fs.existsSync(scriptPath), 'page_smoke.sh must exist');

  const content = fs.readFileSync(scriptPath, 'utf8');

  // 1. 静态红线核验 (R2: 严禁自动 pm2 restart)
  console.log('1. 验证 R1/R2 红线与告警文案规范...');
  assert(!content.includes('pm2 restart'), 'page_smoke.sh must NEVER call pm2 restart');
  assert(!content.includes('pm2 stop'), 'page_smoke.sh must NEVER call pm2 stop');
  assert(content.includes('页壳假绿/路由漏挂'), 'alert title must explicitly mention 页壳假绿/路由漏挂');
  assert(content.includes('watchdog_alert.sh'), 'must source watchdog_alert.sh');
  assert(content.includes('Cannot GET'), 'must detect Express Cannot GET string');
  console.log('   ✅ 静态红线核验通过：禁止 pm2 restart，文案对齐，纯 bash 探测');

  // 2. 验证关键路径覆盖
  console.log('2. 验证关键页与 API 路由最小集覆盖...');
  const expectedPaths = [
    '/api/messages?limit=1',
    '/api/monitoring/dashboard',
    '/api/l2a/dates',
    '/api/l2b/drycut20',
    '/api/review/queue?date=2026-06-26',
    '/api/pipeline/queue-status',
    '/review_workbench.html',
    '/monitoring',
  ];
  for (const p of expectedPaths) {
    assert(content.includes(p), `page_smoke.sh must probe critical path: ${p}`);
  }
  console.log('   ✅ 全部 8 个关键页/API 路径覆盖核验通过！');

  // 3. 端到端活体冒烟核验 (启动本地 Web 进程并执行 bash 冒烟)
  console.log('3. 启动临时 Web 服务执行端到端冒烟测试...');
  const port = 18095;
  process.env.READONLY_MODE = '1';
  process.env.ROLE = 'web_dashboard';
  process.env.ENABLE_TUNNEL = '0';
  delete process.env.DASHBOARD_USERNAME;
  delete process.env.DASHBOARD_PASSWORD;

  const server = await startWebServer(port);
  const stateRelPath = 'scripts/watchdog/.test_smoke_state';
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
        'scripts/watchdog/page_smoke.sh'
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WATCHDOG_HOST: '127.0.0.1',
          WATCHDOG_PORT: String(port),
          WATCHDOG_BASE_URL: `http://127.0.0.1:${port}`,
          WATCHDOG_TIMEOUT_SEC: '3',
          WATCHDOG_DRY_RUN: '1',
          PAGE_SMOKE_STATE_FILE: stateRelPath,
        },
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', c => stdout += c);
      child.stderr.on('data', c => stderr += c);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`page_smoke.sh exited with code ${code}: ${stderr}\n${stdout}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
      child.on('error', reject);
    });

    console.log('   [page_smoke stdout]:\n', output.stdout);
    console.log('   [page_smoke stderr]:\n', output.stderr);
    assert(output.stdout.includes('status=ok fail=0/8'), 'all 8 routes should be healthy on mounted web_runner');
    console.log('   ✅ 端到端测试通过：全 8 关键路由全部健康通畅 (fail=0/8)');
  } finally {
    await new Promise(r => server.close(r));
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }

  console.log('\n🎉 ALL P2-12d TESTS PASSED: test_page_smoke_watchdog\n');
}

run().catch(err => {
  console.error('❌ P2-12d 测试失败:', err);
  process.exit(1);
});

