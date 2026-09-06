/**
 * @file test/test_monitoring_page.js
 * @description P2-D/F: 静态看板文件存在 + /monitoring 路由可访问（本地，不上机）
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { startWebServer } from '../scripts/web_runner.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- test_monitoring_page ---');

  const htmlPath = path.resolve('public/monitoring.html');
  const cssPath = path.resolve('public/monitoring.css');
  const jsPath = path.resolve('public/monitoring.js');
  assert(fs.existsSync(htmlPath), 'public/monitoring.html must exist');
  assert(fs.existsSync(cssPath), 'public/monitoring.css must exist');
  assert(fs.existsSync(jsPath), 'public/monitoring.js must exist');

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.includes('data-subsystem="routeCoverage"'), 'DOM must include routeCoverage cell');
  assert(html.includes('data-subsystem="dataConsistency"'), 'DOM must include dataConsistency cell');
  assert(html.includes('id="mem-web"'), 'DOM must include mem-web');
  assert(html.includes('id="spark-push-empty"'), 'DOM must include spark-push-empty');

  process.env.READONLY_MODE = '1';
  process.env.ROLE = 'web_dashboard';
  delete process.env.DASHBOARD_USERNAME;
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.ENABLE_TUNNEL;

  const port = 13455;
  const server = await startWebServer(port);
  try {
    const page = await get(port, '/monitoring');
    assert(page.status === 200, `/monitoring should be 200, got ${page.status}`);
    assert(page.body.includes('data-subsystem="routeCoverage"'), 'served HTML should include routeCoverage cell');
    assert(page.body.includes('data-subsystem="dataConsistency"'), 'served HTML should include dataConsistency cell');

    const api = await get(port, '/api/monitoring/dashboard');
    assert(api.status === 200, 'dashboard API should be 200');
    const json = JSON.parse(api.body);
    assert(json.success === true, 'dashboard API success');
    assert(json.subsystems?.routeCoverage, 'dashboard must expose routeCoverage');
    assert(json.subsystems?.tunnel, 'dashboard must expose tunnel');
    assert(json.subsystems?.dataConsistency, 'dashboard must expose dataConsistency');
    assert(['ok', 'warn', 'critical', 'unknown', 'off'].includes(json.subsystems.tunnel.status), 'tunnel status enum');
    assert(['ok', 'warn', 'critical', 'unknown'].includes(json.subsystems.dataConsistency.status), 'dataConsistency status enum');
    assert(Array.isArray(json.sparklines?.pushP95), 'pushP95 array');
    assert(json.sparklines.pushP95.length === 0, 'pushP95 must be empty (not_sampled)');
    assert(json.sparklines.notes?.pushP95 === 'not_sampled', 'notes.pushP95 must be not_sampled');
    // 验证 /monitoring.js 静态资源可正常拉取且内容完整
    const jsResp = await get(port, '/monitoring.js');
    assert(jsResp.status === 200, `/monitoring.js should be 200, got ${jsResp.status}`);
    assert(jsResp.body.includes('renderMemorySparkline'), 'served JS must include sparkline renderer');
    assert(jsResp.body.includes('dash-degraded'), 'served JS must handle degraded mode');
    assert(jsResp.body.includes('visibilitychange'), 'served JS must handle visibility change');
    assert(jsResp.body.includes('（仅看板进程）'), 'served JS must handle ingest missing note');
    assert(!jsResp.body.includes('map(() => 180)'), 'served JS must NOT contain fake 180 mapper');
    assert(!jsResp.body.includes('CF Tunnel: 运行中'), 'must not hardcode CF Tunnel running');

    // 静态契约断言：所有 DOM 契约约定的 ID 在 JS 中均有绑定与处理
    const requiredContractIds = [
      'fetch-error', 'dash-title', 'market-et', 'market-bj', 'refresh-label',
      'global-status', 'mem-web', 'mem-ingest', 'mem-combined',
      'mem-ingest-wrap', 'mem-budget', 'mem-percent', 'mem-note', 'uptime',
      'spark-memory', 'spark-memory-caption', 'spark-push', 'spark-push-empty',
      'alert-feed', 'alert-feed-empty'
    ];
    for (const id of requiredContractIds) {
      assert(jsResp.body.includes(id), `monitoring.js must handle contract id: ${id}`);
      assert(html.includes(`id="${id}"`), `monitoring.html must define contract id: ${id}`);
    }

    // 9 子系统在 JS 中均有细节渲染分支（含 P2-12g）
    const requiredSubsystems = [
      'ingest', 'aiTunnel', 'eventLoop', 'monitoringDb', 'queues', 'assets', 'pushPipeline',
      'routeCoverage', 'tunnel', 'dataConsistency',
    ];
    for (const sub of requiredSubsystems) {
      assert(jsResp.body.includes(`'${sub}'`), `monitoring.js must contain branch for subsystem: ${sub}`);
    }

    console.log('   ✅ /monitoring + /monitoring.js + DOM Contract verification OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('🎉 ALL test_monitoring_page PASSED\n');
}

run().catch((err) => {
  console.error('❌ test_monitoring_page failed:', err);
  process.exit(1);
});
