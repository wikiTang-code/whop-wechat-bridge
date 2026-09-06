/**
 * @file test/test_web_runner_page_smoke.js
 * @description P2-12：防止双进程 web_runner「静态壳绿、API 404」回归
 *
 * 覆盖：
 * 1) 源码必须挂载 l2WorkbenchRouter
 * 2) 关键 L2 / review / pipeline / 工作台页 禁止 404
 * 3) Auth bypass 路径在无 Basic Auth 时仍可达
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { app } from '../scripts/web_runner.js';
import { isDashboardAuthBypassPath } from '../monitoring/dashboard-basic-auth.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- P2-12 page smoke: test_web_runner_page_smoke ---');

  // 1. 静态：挂载铁律
  const webRunnerCode = fs.readFileSync(path.resolve('scripts/web_runner.js'), 'utf8');
  assert(
    /import\s+l2WorkbenchRouter\s+from\s+['"]\.\.\/routes\/l2_workbench_routes\.js['"]/.test(webRunnerCode),
    'web_runner MUST import l2WorkbenchRouter'
  );
  assert(
    /app\.use\(\s*['"]\/api['"]\s*,\s*l2WorkbenchRouter\s*\)/.test(webRunnerCode),
    'web_runner MUST app.use("/api", l2WorkbenchRouter)'
  );
  assert(webRunnerCode.includes("/media/zhao"), 'web_runner MUST serve /media/zhao');
  console.log('   ✅ web_runner 源码挂载 L2 + media/zhao');

  // 2. Auth bypass 一致性
  for (const p of [
    '/review_workbench.html',
    '/api/l2a/dates',
    '/api/l2b/drycut20',
    '/api/pipeline/queue-status',
    '/api/review/queue',
  ]) {
    assert(isDashboardAuthBypassPath(p), `bypass missing for ${p}`);
  }
  console.log('   ✅ Auth bypass 覆盖工作台关键前缀');

  // 3. 运行时：禁止 404（允许空业务数据）
  const prevUser = process.env.DASHBOARD_USERNAME;
  const prevPass = process.env.DASHBOARD_PASSWORD;
  // 强制开启 Auth，验证 bypass 仍放行
  process.env.DASHBOARD_USERNAME = 'smoke_user';
  process.env.DASHBOARD_PASSWORD = 'smoke_pass';

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const checks = [
      { path: '/review_workbench.html', ok: (s) => s === 200 },
      { path: '/api/l2a/dates', ok: (s) => s === 200 },
      { path: '/api/l2b/drycut20', ok: (s) => s === 200 || s === 404 }, // 404 only if sample file missing — still must not be Express "Cannot GET"
      { path: '/api/pipeline/queue-status', ok: (s) => s === 200 },
      { path: '/api/review/queue?date=2026-06-26', ok: (s) => s === 200 },
    ];

    for (const c of checks) {
      const res = await fetch(`${base}${c.path}`); // 无 Authorization
      const text = await res.text();
      assert(!text.includes('Cannot GET'), `${c.path} must be mounted (got Express Cannot GET)`);
      assert(c.ok(res.status), `${c.path} unexpected status ${res.status}`);
      // drycut：有样本文件时应 200
      if (c.path === '/api/l2b/drycut20' && fs.existsSync('data/samples/l2b_dry_cut_20.jsonl')) {
        assert(res.status === 200, 'drycut20 should be 200 when sample exists');
        const j = JSON.parse(text);
        assert(j.success === true && j.count >= 1, 'drycut20 payload shape');
      }
      console.log(`   ✅ ${c.path} → ${res.status}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevUser === undefined) delete process.env.DASHBOARD_USERNAME;
    else process.env.DASHBOARD_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = prevPass;
  }

  console.log('\n🎉 ALL P2-12 PAGE SMOKE TESTS PASSED\n');
}

run().catch((err) => {
  console.error('❌ page smoke failed:', err);
  process.exit(1);
});
