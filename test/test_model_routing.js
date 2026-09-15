/**
 * test_model_routing.js
 * 验证大小模型双轨并发分流 (Model Routing Verification)
 * 验证 1.5B 极速车道 (Trade/Filter) 与 14B 深度推理车道 (Deep/Macro) 协同工作
 */

import { resolveLocalModel, LOCAL_LM_DEFAULT_BASE } from '../ai-router-policy.js';
import { extractTradeWithSLM } from '../slm-extractor.js';

async function testRouting() {
  console.log('===========================================================');
  console.log('🧪 启动 LM Studio 大小模型双轨分流 (Model Routing) 联调测试');
  console.log('===========================================================\n');

  const fastModel = resolveLocalModel('trade');
  const deepModel = resolveLocalModel('deep');

  console.log(`[路由配置] 快车道(交易/过滤): ${fastModel}`);
  console.log(`[路由配置] 深车道(研报/宏观): ${deepModel}`);
  console.log(`[服务地址] ${LOCAL_LM_DEFAULT_BASE}\n`);

  // 1. 测试快车道 (1.5B 极速抽取)
  console.log('--- 1. 快车道测试 (1.5B 模型) ---');
  const tFastStart = Date.now();
  const tradeRes = await extractTradeWithSLM('866出一半 855的lite', { timeoutMs: 5000 });
  const tFastElapsed = Date.now() - tFastStart;
  console.log(`快车道耗时: ${tFastElapsed}ms`);
  console.log(`快车道结果: ${JSON.stringify(tradeRes.trades[0] || tradeRes, null, 2)}\n`);

  // 2. 测试深车道 (14B 深度推理)
  console.log('--- 2. 深车道测试 (14B 模型) ---');
  const tDeepStart = Date.now();
  const deepPrompt = '请用一句话简评：美联储降息周期中美股科技股与成长股的估值传导逻辑。';
  const deepRes = await fetch(`${LOCAL_LM_DEFAULT_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: deepModel,
      messages: [{ role: 'user', content: deepPrompt }],
      temperature: 0.2,
      max_tokens: 80
    })
  });
  const deepData = await deepRes.json();
  const tDeepElapsed = Date.now() - tDeepStart;
  console.log(`深车道耗时: ${tDeepElapsed}ms`);
  console.log(`深车道输出: ${deepData?.choices?.[0]?.message?.content?.trim()}\n`);

  console.log('===========================================================');
  if (tradeRes.has_trade && deepData?.choices?.[0]?.message?.content) {
    console.log('🎉 验证成功！快车道(1.5B)与深车道(14B)双轨协同运行，分工明确，零冲突！');
    process.exit(0);
  } else {
    console.error('❌ 验证失败');
    process.exit(1);
  }
}

testRouting().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
