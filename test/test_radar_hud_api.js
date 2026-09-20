/**
 * test/test_radar_hud_api.js
 * 验证 REQ-045 车机大屏 HUD 与雷达态势只读 API
 */
import http from 'http';
import { app } from '../scripts/web_runner.js';
import { getDb, ensureRadarEventsTable } from '../database.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

console.log('===========================================================');
console.log('🧪 [Test REQ-045] 车机大屏 HUD 与雷达态势只读 API 单测');
console.log('===========================================================');

async function runTests() {
  const db = getDb();
  ensureRadarEventsTable(db);

  // 1. 在高位安全随机端口启动 Web 实例 (避免 undici 拦截低位/受限端口如 1720)
  const server = http.createServer(app);
  const testPort = 21000 + Math.floor(Math.random() * 8000);
  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${testPort}`;
  console.log(`[Test] 临时测试服务已就绪: ${baseUrl}`);

  const authUser = process.env.DASHBOARD_USERNAME;
  const authPass = process.env.DASHBOARD_PASSWORD;
  const headers = (authUser && authPass)
    ? { 'Authorization': 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64') }
    : {};

  try {
    // 2. 验证 /api/radar/latest
    console.log('--- 1. 验证 GET /api/radar/latest ---');
    const resLatest = await fetch(`${baseUrl}/api/radar/latest`, { headers });
    assert(resLatest.status === 200, `应返回 HTTP 200, got ${resLatest.status}`);
    const dataLatest = await resLatest.json();
    assert(dataLatest.success === true, '应标记 success=true');
    assert(dataLatest.market_session, '应包含美股时钟状态');
    assert(dataLatest.disclaimer.includes('绝非投资建议'), '必须包含安全免责声明');
    assert(Array.isArray(dataLatest.data), 'data 应为数组');
    assert(dataLatest.data.length > 0, '标的列表不应为空');
    
    const tsla = dataLatest.data.find(d => d.ticker === 'TSLA');
    assert(tsla, '应包含 TSLA');
    assert(tsla.confluence_score >= 0, 'TSLA 应包含共振打分');
    assert(tsla.leveraged_etf, 'TSLA 应包含 2x 杠杆做多 ETF 联动');
    console.log(`  ✅ GET /api/radar/latest 通过 (返回 ${dataLatest.data.length} 个标的态势)`);

    // 3. 验证写入并查询 /api/radar/events
    console.log('\n--- 2. 验证 GET /api/radar/events ---');
    const mockEventId = `radar_test_${Date.now()}`;
    db.prepare(`
      INSERT OR REPLACE INTO confluence_radar_events (
        id, ticker, current_price, confluence_score, confluence_level,
        dimensions_json, observations_json, leveraged_etf_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      mockEventId,
      'TSLA',
      240.5,
      85,
      'WANGZHA_CONFLUENCE',
      JSON.stringify({ d1: 25, d2: 25, d3: 20, d4: 15 }),
      JSON.stringify(['🔥 王炸共振触发']),
      JSON.stringify({ etf: 'TSLL', leverage: 2, etf_current_price: 11.2 }),
      Date.now()
    );

    const resEvents = await fetch(`${baseUrl}/api/radar/events?ticker=TSLA&limit=5`, { headers });
    assert(resEvents.status === 200, `应返回 HTTP 200, got ${resEvents.status}`);
    const dataEvents = await resEvents.json();
    assert(dataEvents.success === true, 'events.success 应为 true');
    assert(Array.isArray(dataEvents.data), 'events.data 应为数组');
    const found = dataEvents.data.find(e => e.id === mockEventId);
    assert(found, '应查到刚才插入的测试事件');
    assert(found.confluence_level === 'WANGZHA_CONFLUENCE', '级别应为 WANGZHA_CONFLUENCE');
    console.log('  ✅ GET /api/radar/events 通过 (历史事件沉淀查询精准)');

    // 4. 验证 /hud 与 /radar 页面托管
    console.log('\n--- 3. 验证 /hud 与 /radar 量化决策驾驶舱页面 ---');
    const resHud = await fetch(`${baseUrl}/hud`, { headers });
    assert(resHud.status === 200, `GET /hud 应返回 200, got ${resHud.status}`);
    const textHud = await resHud.text();
    assert(textHud.includes('美股微观结构与四维共振量化决策驾驶舱'), '页面必须包含量化决策驾驶舱标题');
    assert(textHud.includes('id="session-badge"'), '页面必须包含 session-badge 容器');

    const resRadar = await fetch(`${baseUrl}/radar`, { headers });
    assert(resRadar.status === 200, `GET /radar 应返回 200, got ${resRadar.status}`);
    const textRadar = await resRadar.text();
    assert(textRadar.includes('美股微观结构与四维共振量化决策驾驶舱'), '页面必须包含量化决策驾驶舱标题');
    console.log('  ✅ /hud 与 /radar 量化决策驾驶舱页面托管通过');

    console.log('\n===========================================================');
    console.log('🎉 REQ-045 车机大屏 HUD 与雷达 API 单测全部 PASS！');
    console.log('===========================================================');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
