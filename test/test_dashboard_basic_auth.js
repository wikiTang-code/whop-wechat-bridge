/**
 * @file test/test_dashboard_basic_auth.js
 * @description 看板 Basic Auth 中间件单测（web_runner 灰度前安全门控）
 */

import http from 'http';
import express from 'express';
import { dashboardBasicAuthMiddleware, isDashboardAuthBypassPath } from '../monitoring/dashboard-basic-auth.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- test_dashboard_basic_auth ---');

  assert(isDashboardAuthBypassPath('/health') === true, '/health must bypass');
  assert(isDashboardAuthBypassPath('/api/messages') === false, '/api/messages must not bypass');

  const prevUser = process.env.DASHBOARD_USERNAME;
  const prevPass = process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_USERNAME = 'test_user';
  process.env.DASHBOARD_PASSWORD = 'test_pass';

  const app = express();
  app.use(dashboardBasicAuthMiddleware);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/messages', (_req, res) => res.json({ success: true, data: [] }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const h = await fetch(`${base}/health`);
    assert(h.status === 200, `health should 200 without auth, got ${h.status}`);

    const noAuth = await fetch(`${base}/api/messages`);
    assert(noAuth.status === 401, `messages without auth should 401, got ${noAuth.status}`);

    const bad = await fetch(`${base}/api/messages`, {
      headers: { Authorization: 'Basic ' + Buffer.from('wrong:creds').toString('base64') },
    });
    assert(bad.status === 401, `bad creds should 401, got ${bad.status}`);

    const ok = await fetch(`${base}/api/messages`, {
      headers: { Authorization: 'Basic ' + Buffer.from('test_user:test_pass').toString('base64') },
    });
    assert(ok.status === 200, `good creds should 200, got ${ok.status}`);
    const body = await ok.json();
    assert(body.success === true, 'authenticated body ok');

    console.log('🎉 ALL test_dashboard_basic_auth PASSED\n');
  } finally {
    server.close();
    if (prevUser === undefined) delete process.env.DASHBOARD_USERNAME;
    else process.env.DASHBOARD_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = prevPass;
  }
}

run().catch((err) => {
  console.error('❌ test_dashboard_basic_auth failed:', err);
  process.exit(1);
});
