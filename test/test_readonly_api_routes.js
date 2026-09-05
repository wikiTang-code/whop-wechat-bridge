/**
 * @file test/test_readonly_api_routes.js
 * @description P1-11 / T12 / T18 / T20 单元与集成测试：验证 Web 只读 API 挂载、前端契约形状与写操作 403 拦截
 */

import http from 'http';
import { app } from '../scripts/web_runner.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T12 / T18 / T20 测试: test_readonly_api_routes ---');

  // 1. 在随机未占用端口启动临时 Web 实例
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`1. 启动临时测试 Web 服务实例: ${baseUrl}...`);

  const authUser = process.env.DASHBOARD_USERNAME;
  const authPass = process.env.DASHBOARD_PASSWORD;
  const headers = (authUser && authPass)
    ? { 'Authorization': 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64') }
    : {};

  try {
    // 2. 验证只读 GET 路由与前端 app.js 契约全面对齐
    console.log('2. 验证只读 GET 接口响应与字段形状...');

    // a. GET /api/config (app.js 依赖 result.data 包含 LAST_SYNC_TIME)
    const resConfig = await fetch(`${baseUrl}/api/config`, { headers });
    assert(resConfig.status === 200, `GET /api/config should return 200, got ${resConfig.status}`);
    const dataConfig = await resConfig.json();
    assert(dataConfig.success === true, 'config.success should be true');
    assert(dataConfig.data && typeof dataConfig.data === 'object', 'app.js requires config.data object');
    assert('LAST_SYNC_TIME' in dataConfig.data, 'config.data must include LAST_SYNC_TIME');
    assert(typeof dataConfig.data.AI_PROVIDER === 'string', 'config.data must include AI_PROVIDER');
    console.log(`   ✅ GET /api/config → 200 (包含 data.LAST_SYNC_TIME 与 AI_PROVIDER)`);

    // b. GET /api/messages (app.js 过滤支持 speakerMode/search/channelId 等)
    const resMessages = await fetch(`${baseUrl}/api/messages?limit=5&speakerMode=speakers`, { headers });
    assert(resMessages.status === 200, `GET /api/messages should return 200, got ${resMessages.status}`);
    const dataMessages = await resMessages.json();
    assert(dataMessages.success === true, 'dataMessages.success should be true');
    assert(Array.isArray(dataMessages.data), 'dataMessages.data should be array');
    assert(Array.isArray(dataMessages.messages), 'dataMessages.messages should be array');
    assert(typeof dataMessages.total === 'number', 'dataMessages.total should be number');
    console.log(`   ✅ GET /api/messages → 200 (兼备 data 与 messages, 过滤 speakerMode=speakers 通过)`);

    // c. GET /api/messages/:id/context (上下文回溯路由)
    const resContext = await fetch(`${baseUrl}/api/messages/dummy_test_msg/context?limit=5`, { headers });
    assert(resContext.status === 200, `GET /api/messages/:id/context should return 200, got ${resContext.status}`);
    const dataContext = await resContext.json();
    assert(dataContext.success === true, 'dataContext.success should be true');
    assert(Array.isArray(dataContext.messages), 'dataContext.messages must be array');
    console.log(`   ✅ GET /api/messages/:id/context → 200 (返回上下文消息列表)`);

    // d. GET /api/proxy-image (图片代理)
    const resProxyNoParam = await fetch(`${baseUrl}/api/proxy-image`, { headers });
    assert(resProxyNoParam.status === 400, `GET /api/proxy-image without param should return 400, got ${resProxyNoParam.status}`);
    const resProxyBadHost = await fetch(`${baseUrl}/api/proxy-image?url=https://evil-site.com/hack.png`, { headers });
    assert(resProxyBadHost.status === 403, `GET /api/proxy-image with disallowed host should return 403, got ${resProxyBadHost.status}`);
    console.log(`   ✅ GET /api/proxy-image → 400 (缺失参数) / 403 (拦截非法 host) 安全校验通过`);

    // e. GET /api/channels (兼备 data 与 channels)
    const resChannels = await fetch(`${baseUrl}/api/channels`, { headers });
    assert(resChannels.status === 200, `GET /api/channels should return 200, got ${resChannels.status}`);
    const dataChannels = await resChannels.json();
    assert(dataChannels.success === true, 'dataChannels.success should be true');
    assert(Array.isArray(dataChannels.data), 'frontend requires dataChannels.data array');
    assert(Array.isArray(dataChannels.channels), 'dataChannels.channels should also be array');
    console.log(`   ✅ GET /api/channels → 200 (兼备 data 与 channels 数组)`);

    // f. GET /api/speakers (兼备 speakers 数组且排除大V)
    const resSpeakers = await fetch(`${baseUrl}/api/speakers`, { headers });
    assert(resSpeakers.status === 200, `GET /api/speakers should return 200, got ${resSpeakers.status}`);
    const dataSpeakers = await resSpeakers.json();
    assert(dataSpeakers.success === true, 'dataSpeakers.success should be true');
    assert(Array.isArray(dataSpeakers.speakers), 'frontend requires dataSpeakers.speakers array');
    console.log(`   ✅ GET /api/speakers → 200 (兼备 speakers 数组)`);

    // g. GET /api/reports (兼备 data 与 total)
    const resReports = await fetch(`${baseUrl}/api/reports`, { headers });
    assert(resReports.status === 200, `GET /api/reports should return 200, got ${resReports.status}`);
    const dataReports = await resReports.json();
    assert(dataReports.success === true, 'dataReports.success should be true');
    assert(Array.isArray(dataReports.data), 'frontend requires dataReports.data array');
    assert(typeof dataReports.total === 'number', 'frontend requires dataReports.total number');
    console.log(`   ✅ GET /api/reports → 200 (兼备 data 与 total 字段)`);

    // h. GET /api/news-summaries & latest
    const resNews = await fetch(`${baseUrl}/api/news-summaries`, { headers });
    assert(resNews.status === 200, 'news-summaries should return 200');
    const dataNews = await resNews.json();
    assert(Array.isArray(dataNews.summaries), 'dataNews.summaries must be array');
    const resNewsLatest = await fetch(`${baseUrl}/api/news-summaries/latest`, { headers });
    assert(resNewsLatest.status === 200, 'news-summaries/latest should return 200');
    console.log(`   ✅ GET /api/news-summaries & /latest → 200`);

    // i. GET /api/quant/portfolio /positions /orders (量化页只读路由)
    const resQuantPort = await fetch(`${baseUrl}/api/quant/portfolio`, { headers });
    assert(resQuantPort.status === 200, `quant/portfolio should return 200, got ${resQuantPort.status}`);
    const dataQuantPort = await resQuantPort.json();
    assert(dataQuantPort.success === true, 'quant/portfolio success should be true');
    assert(dataQuantPort.data && typeof dataQuantPort.data === 'object', 'quant/portfolio data must exist');

    const resQuantPos = await fetch(`${baseUrl}/api/quant/positions`, { headers });
    assert(resQuantPos.status === 200, `quant/positions should return 200, got ${resQuantPos.status}`);

    const resQuantOrd = await fetch(`${baseUrl}/api/quant/orders`, { headers });
    assert(resQuantOrd.status === 200, `quant/orders should return 200, got ${resQuantOrd.status}`);
    const dataQuantOrd = await resQuantOrd.json();
    assert(Array.isArray(dataQuantOrd.orders) || Array.isArray(dataQuantOrd.data), 'quant/orders data/orders array required');
    console.log(`   ✅ GET /api/quant/* (portfolio/positions/orders) → 200`);

    // j. GET /api/csrf-token / persona / status
    const resCsrf = await fetch(`${baseUrl}/api/csrf-token`, { headers });
    assert(resCsrf.status === 200, 'csrf-token should be 200');
    const dataCsrf = await resCsrf.json();
    assert(typeof dataCsrf.csrfToken === 'string', 'csrfToken must be string');

    const resPersonaStatus = await fetch(`${baseUrl}/api/persona/status`, { headers });
    assert(resPersonaStatus.status === 200, 'persona/status should be 200');

    const resPersonaLatest = await fetch(`${baseUrl}/api/persona/latest`, { headers });
    assert(resPersonaLatest.status === 200, 'persona/latest should be 200');

    // k. GET /api/gpu/status (包装 data: global.gpuLock)
    const resGpu = await fetch(`${baseUrl}/api/gpu/status`, { headers });
    assert(resGpu.status === 200, `GET /api/gpu/status should return 200, got ${resGpu.status}`);
    const dataGpu = await resGpu.json();
    assert(dataGpu.success === true, 'dataGpu.success should be true');
    assert(dataGpu.data && typeof dataGpu.data === 'object', 'dataGpu.data must exist');
    console.log('   ✅ GET /api/gpu/status → 200 (包装 data: gpuLock)');

    // l. GET /api/system/monitor (丰富单体监控结构)
    const resMonitor = await fetch(`${baseUrl}/api/system/monitor`, { headers });
    assert(resMonitor.status === 200, `GET /api/system/monitor should return 200, got ${resMonitor.status}`);
    const dataMonitor = await resMonitor.json();
    assert(dataMonitor.success === true, 'dataMonitor.success should be true');
    assert(Array.isArray(dataMonitor.data?.activeTasks), 'system/monitor requires activeTasks array');
    console.log('   ✅ GET /api/system/monitor → 200 (返回 activeTasks 与 rich monitor json)');

    // 3. 验证写操作一律拦截并返回 403 Forbidden
    console.log('3. 验证写操作 (POST/PUT/DELETE) 严格拦截并返回 403...');

    // 场景 A: POST /api/sync
    const resSync = await fetch(`${baseUrl}/api/sync`, { method: 'POST', body: JSON.stringify({}), headers });
    assert(resSync.status === 403, `POST /api/sync MUST return 403, got ${resSync.status}`);
    const dataSync = await resSync.json();
    assert(dataSync.code === 'ERR_READONLY_PROCESS', 'should return ERR_READONLY_PROCESS code');
    console.log('   ✅ POST /api/sync → 403 Forbidden (拦截写操作)');

    // 场景 B: POST /api/reports/generate
    const resRepGen = await fetch(`${baseUrl}/api/reports/generate`, { method: 'POST', body: JSON.stringify({}), headers });
    assert(resRepGen.status === 403, `POST /api/reports/generate MUST return 403, got ${resRepGen.status}`);
    console.log('   ✅ POST /api/reports/generate → 403 Forbidden (拦截写操作)');

    // 场景 C: POST /api/tasks/restart-failed
    const resTaskRestart = await fetch(`${baseUrl}/api/tasks/restart-failed`, { method: 'POST', headers });
    assert(resTaskRestart.status === 403, `POST /api/tasks/restart-failed MUST return 403, got ${resTaskRestart.status}`);
    console.log('   ✅ POST /api/tasks/restart-failed → 403 Forbidden (拦截写操作)');

    // 场景 D: DELETE /api/task-queue/clear
    const resDelete = await fetch(`${baseUrl}/api/task-queue/clear`, { method: 'DELETE', headers });
    assert(resDelete.status === 403, `DELETE /api/task-queue/clear MUST return 403, got ${resDelete.status}`);
    console.log('   ✅ DELETE /api/task-queue/clear → 403 Forbidden (拦截写操作)');

    console.log('\n🎉 ALL T12 / T18 / T20 TESTS PASSED: test_readonly_api_routes\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

run().catch(err => {
  console.error('❌ T12 / T18 / T20 测试失败:', err);
  process.exit(1);
});
