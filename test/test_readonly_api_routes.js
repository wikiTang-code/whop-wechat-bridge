/**
 * @file test/test_readonly_api_routes.js
 * @description P1-11 / T12 单元与集成测试：验证 Web 只读 API 挂载与写操作 403 拦截
 */

import http from 'http';
import { app } from '../scripts/web_runner.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T12 测试: test_readonly_api_routes ---');

  // 1. 在随机未占用端口启动临时 Web 实例
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`1. 启动临时测试 Web 服务实例: ${baseUrl}...`);

  try {
    // 2. 验证只读 GET 路由返回 200
    console.log('2. 验证只读 GET 接口响应...');

    const resMessages = await fetch(`${baseUrl}/api/messages?limit=5`);
    assert(resMessages.status === 200, `GET /api/messages should return 200, got ${resMessages.status}`);
    const dataMessages = await resMessages.json();
    assert(dataMessages.success === true, 'dataMessages.success should be true');
    assert(Array.isArray(dataMessages.data), 'dataMessages.data should be array');
    console.log(`   ✅ GET /api/messages → 200 (返回 ${dataMessages.data.length} 条消息)`);

    const resChannels = await fetch(`${baseUrl}/api/channels`);
    assert(resChannels.status === 200, `GET /api/channels should return 200, got ${resChannels.status}`);
    const dataChannels = await resChannels.json();
    assert(dataChannels.success === true, 'dataChannels.success should be true');
    console.log(`   ✅ GET /api/channels → 200 (返回 ${dataChannels.channels.length} 个频道)`);

    const resSpeakers = await fetch(`${baseUrl}/api/speakers`);
    assert(resSpeakers.status === 200, `GET /api/speakers should return 200, got ${resSpeakers.status}`);
    const dataSpeakers = await resSpeakers.json();
    assert(dataSpeakers.success === true, 'dataSpeakers.success should be true');
    console.log(`   ✅ GET /api/speakers → 200 (返回 ${dataSpeakers.speakers.length} 位发言人)`);

    const resGpu = await fetch(`${baseUrl}/api/gpu/status`);
    assert(resGpu.status === 200, `GET /api/gpu/status should return 200, got ${resGpu.status}`);
    const dataGpu = await resGpu.json();
    assert(dataGpu.success === true, 'dataGpu.success should be true');
    console.log('   ✅ GET /api/gpu/status → 200');

    // 3. 验证写操作一律拦截并返回 403 Forbidden
    console.log('3. 验证写操作 (POST/PUT/DELETE) 严格拦截并返回 403...');

    // 场景 A: POST /api/sync
    const resSync = await fetch(`${baseUrl}/api/sync`, { method: 'POST', body: JSON.stringify({}) });
    assert(resSync.status === 403, `POST /api/sync MUST return 403, got ${resSync.status}`);
    const dataSync = await resSync.json();
    assert(dataSync.code === 'ERR_READONLY_PROCESS', 'should return ERR_READONLY_PROCESS code');
    console.log('   ✅ POST /api/sync → 403 Forbidden (拦截写操作)');

    // 场景 B: POST /api/reports/generate
    const resRepGen = await fetch(`${baseUrl}/api/reports/generate`, { method: 'POST', body: JSON.stringify({}) });
    assert(resRepGen.status === 403, `POST /api/reports/generate MUST return 403, got ${resRepGen.status}`);
    console.log('   ✅ POST /api/reports/generate → 403 Forbidden (拦截写操作)');

    // 场景 C: POST /api/tasks/restart-failed
    const resTaskRestart = await fetch(`${baseUrl}/api/tasks/restart-failed`, { method: 'POST' });
    assert(resTaskRestart.status === 403, `POST /api/tasks/restart-failed MUST return 403, got ${resTaskRestart.status}`);
    console.log('   ✅ POST /api/tasks/restart-failed → 403 Forbidden (拦截写操作)');

    // 场景 D: DELETE /api/task-queue/clear
    const resDelete = await fetch(`${baseUrl}/api/task-queue/clear`, { method: 'DELETE' });
    assert(resDelete.status === 403, `DELETE /api/task-queue/clear MUST return 403, got ${resDelete.status}`);
    console.log('   ✅ DELETE /api/task-queue/clear → 403 Forbidden (拦截写操作)');

    console.log('\n🎉 ALL T12 TESTS PASSED: test_readonly_api_routes\n');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ T12 测试失败:', err);
  process.exit(1);
});
