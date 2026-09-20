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

    // 5. 验证 REQ-054 & CHG-049: GET /api/positions/lifecycle (启发式推演持仓与来源三层标注)
    console.log('\n--- 4. 验证 GET /api/positions/lifecycle (启发式推演持仓与来源分层) ---');
    const resLifecycle = await fetch(`${baseUrl}/api/positions/lifecycle`, { headers });
    assert(resLifecycle.status === 200, `GET /api/positions/lifecycle 应返回 200, got ${resLifecycle.status}`);
    const dataLifecycle = await resLifecycle.json();
    assert(dataLifecycle.success === true, 'lifecycle.success 应为 true');
    assert(dataLifecycle.mode === 'simulated_heuristic', 'mode 必须为 simulated_heuristic');
    assert(dataLifecycle.is_broker_reconciled === false, 'is_broker_reconciled 必须为 false (明确非券商对账)');
    assert(dataLifecycle.capital_allocation, '应包含大V宏观资金配置评估');
    assert(dataLifecycle.capital_allocation.strategy === 'EQUITY_CORE_THEN_OPTION_BOOSTER', '策略应为 EQUITY_CORE_THEN_OPTION_BOOSTER');
    assert(dataLifecycle.capital_allocation.advice.includes('堆满'), '资金总控建议必须包含股票堆满口述');
    assert(dataLifecycle.capital_allocation.leveraged2xRatio !== undefined, '必须披露 leveraged2xRatio 2x战车占比');
    assert(dataLifecycle.capital_allocation.notionalExposureRatio !== undefined, '必须披露 notionalExposureRatio 名义杠杆暴露');
    assert(Array.isArray(dataLifecycle.collapsed_positions), 'collapsed_positions 必须为数组');

    // 抽检项 1: 2x 战车与期权名义暴露计算核实 (公式: 1x*1.0 + 2x*2.0 + option*5.0 Delta近似)
    const cap = dataLifecycle.capital_allocation;
    const calcNotional = (cap.equity1xRatio || 0) * 1.0 + (cap.leveraged2xRatio || 0) * 2.0 + (cap.optionRatio || 0) * 5.0;
    assert(Math.abs(cap.notionalExposureRatio - calcNotional) < 0.05, `名义杠杆敞口计算需符合公式 (1x + 2x*2 + option*5), got ${cap.notionalExposureRatio}, expected ~${calcNotional}`);
    console.log(`  ✅ 抽检1通过: 名义暴露计算精确 (1x: ${(cap.equity1xRatio*100).toFixed(0)}%, 2x: ${(cap.leveraged2xRatio*100).toFixed(0)}%, option: ${(cap.optionRatio*100).toFixed(0)}% -> 名义敞口: ${(cap.notionalExposureRatio*100).toFixed(0)}%)`);

    // 抽检项 2: source 标签显式三层标注
    assert(dataLifecycle.source === 'heuristic' || dataLifecycle.source === 'zhao_quote', '接口顶级 source 必须显式标注');
    if (dataLifecycle.active_positions.length > 0) {
      const p0 = dataLifecycle.active_positions[0];
      assert(['heuristic', 'audited_fill', 'zhao_quote'].includes(p0.source), `持仓项 source 必须为合法三层类型之一: ${p0.source}`);
    }
    console.log('  ✅ 抽检2通过: source 标签在 API 与持仓数据中显式三层分层');

    // 抽检项 3: 标的时变股性统计频次属性
    const cardData0 = dataLatest.data[0];
    if (cardData0 && cardData0.elasticity_profile) {
      assert(cardData0.elasticity_profile.stats_desc !== undefined, 'elasticity_profile 必须包含 stats_desc 客观频次说明');
      console.log(`  ✅ 抽检3通过: 标的时变股性包含客观统计频次 (${cardData0.elasticity_profile.stats_desc})`);
    }

    // 6. 核心红线验证: 持仓推演绝对不改动四维共振打分 (防火墙物理隔离)
    console.log('\n--- 5. 核心红线验证: 四维共振客观打分与持仓推演物理隔离 ---');
    assert(cardData0, '必须能获取到标的共振数据');
    const dSum = (cardData0.dimensions.d1_gex_structure?.score || 0) +
                 (cardData0.dimensions.d2_zhao_outlook?.score || 0) +
                 (cardData0.dimensions.d3_trade_signals_proof?.score || 0) +
                 (cardData0.dimensions.d4_tape_block_flow?.score || 0);
    assert(cardData0.confluence_score === dSum, `confluence_score (${cardData0.confluence_score}) 必须严格等于物理四维之和 (${dSum})，绝对禁止被持仓推演状态污染加分`);
    console.log(`  ✅ 核心红线验证通过: confluence_score (${cardData0.confluence_score}) 严格等于物理四维之和 (${dSum})，持仓状态 100% 隔离！`);

    console.log('\n===========================================================');
    console.log('🎉 REQ-045, REQ-055 & CHG-049 车机大屏 HUD 与持仓雷达 API 单测全部 PASS！');
    console.log('===========================================================');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
