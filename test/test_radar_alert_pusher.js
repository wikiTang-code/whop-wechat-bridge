/**
 * test/test_radar_alert_pusher.js
 * 验证 REQ-046 盘中高置信度四维共振预警企微卡片推送器
 */
import assert from 'assert';
import {
  formatRadarAlertMarkdown,
  pushRadarAlert,
  _resetCooldownMapForTests,
} from '../tools/knowledge/radar_alert_pusher.js';

console.log('===========================================================');
console.log('🧪 [Test REQ-046] 四维共振预警企微卡片推送器单测');
console.log('===========================================================');

async function runTests() {
  _resetCooldownMapForTests();

  const mockRadarData = {
    ticker: 'TSLA',
    current_price: 240.5,
    confluence_score: 85,
    confluence_level: 'WANGZHA_CONFLUENCE',
    dimensions: {
      d1_gex_structure: { score: 25, details: '贴近自身 Put Wall ($240.00)' },
      d2_zhao_outlook: {
        score: 25,
        details: '预测支撑 $240.00',
        is_golden_playbook: true,
        golden_stats: { hit_rate_3d: 1.0, hit_rate_5d: 0.6, confidence: 0.45 },
      },
      d3_trade_signals_proof: { score: 20, details: '偏差 0.8%' },
      d4_tape_block_flow: { score: 15, details: '大单通吃 $3.5M' },
    },
    leveraged_etf: {
      etf: 'TSLL',
      name: '2倍做多特斯拉',
      leverage: 2,
      etf_current_price: 11.2,
      projected_support: [10.15],
      projected_resistance: [12.3],
    },
    external_quant_reference: {
      author: 'Mrzhoulucky (周哥美股工具箱)',
      signal_combo: '双底回踩确认',
      reference_price: 240.0,
    },
  };

  // 1. 验证 Markdown 格式化
  console.log('--- 1. 验证 Markdown 内容组装与专业字段呈现 ---');
  const md = formatRadarAlertMarkdown(mockRadarData, { nowTs: 1789800000000 });
  assert.ok(md.includes('王炸共振触发'), '王炸级别应有王炸标题');
  assert.ok(md.includes('TSLA'), '必须包含标的代码');
  assert.ok(md.includes('$240.50'), '必须包含现价');
  assert.ok(md.includes('高胜率黄金战法认证'), '必须包含黄金战法徽标');
  assert.ok(md.includes('3D胜率 100%'), '必须包含历史3D胜率');
  assert.ok(md.includes('2倍做多特斯拉 (TSLL)'), '必须包含 2x 战车联动');
  assert.ok(md.includes('折算做多支撑: <font color="info">$10.15</font>'), '必须包含折算支撑');
  assert.ok(md.includes('周哥美股工具箱'), '必须包含外部客观量化参谋');
  assert.ok(md.includes('纯客观微观结构参谋，100% 隔离实盘下单资金'), '必须包含合规免责声明');
  console.log('  ✅ Markdown 格式化组装精准无误');

  // 2. 验证低分跳过门禁
  console.log('\n--- 2. 验证分值阈值门禁过滤 ---');
  const lowScoreData = {
    ticker: 'AAPL',
    current_price: 180,
    confluence_score: 45,
    confluence_level: 'NORMAL',
    dimensions: {},
  };
  const skipRes = await pushRadarAlert(lowScoreData, { minScore: 70 });
  assert.strictEqual(skipRes.ok, false);
  assert.strictEqual(skipRes.skipped, true);
  assert.strictEqual(skipRes.reason, 'SCORE_BELOW_THRESHOLD');
  console.log('  ✅ 低于门禁分值时正确静默跳过');

  // 3. 验证网络推送与 Mock Fetch
  console.log('\n--- 3. 验证 Webhook 推送通道与防抖窗口 ---');
  let pushedPayload = null;
  const mockFetch = async (url, opts) => {
    pushedPayload = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    };
  };

  const pushRes1 = await pushRadarAlert(mockRadarData, {
    webhookUrl: 'https://qyapi.weixin.qq.com/mock/webhook',
    fetchImpl: mockFetch,
    nowFn: () => 1000000,
  });
  assert.strictEqual(pushRes1.ok, true, '首发应当成功');
  assert.ok(pushedPayload, '应当发出了有效 payload');
  assert.strictEqual(pushedPayload.msgtype, 'markdown');
  console.log('  ✅ 首次高共振推送成功');

  // 紧接着短时间内再次推送相同标的 (无明显分值跃升) -> 应被防抖冷却拦截
  const pushRes2 = await pushRadarAlert(mockRadarData, {
    webhookUrl: 'https://qyapi.weixin.qq.com/mock/webhook',
    fetchImpl: mockFetch,
    nowFn: () => 1000000 + 60 * 1000, // 仅过去 1 分钟
  });
  assert.strictEqual(pushRes2.ok, false);
  assert.strictEqual(pushRes2.skipped, true);
  assert.strictEqual(pushRes2.reason, 'COOLDOWN_ACTIVE');
  console.log('  ✅ 防抖冷却窗口生效，成功阻断刷屏');

  // 若分数显著跃升 (如 +15 分)，允许穿透冷却窗口
  const boostData = { ...mockRadarData, confluence_score: 100 };
  const pushRes3 = await pushRadarAlert(boostData, {
    webhookUrl: 'https://qyapi.weixin.qq.com/mock/webhook',
    fetchImpl: mockFetch,
    nowFn: () => 1000000 + 120 * 1000,
  });
  assert.strictEqual(pushRes3.ok, true, '分数激增允许穿透');
  console.log('  ✅ 结构重大跃升穿透推送成功');

  // 4. 验证 DryRun 模式
  console.log('\n--- 4. 验证 --dry-run 演练模式 ---');
  _resetCooldownMapForTests();
  const dryRes = await pushRadarAlert(mockRadarData, { dryRun: true });
  assert.strictEqual(dryRes.ok, true);
  assert.strictEqual(dryRes.dryRun, true);
  console.log('  ✅ --dry-run 演练模式验证通过');

  console.log('\n===========================================================');
  console.log('🎉 REQ-046 四维共振预警企微卡片推送器单测全部 PASS！');
  console.log('===========================================================');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
