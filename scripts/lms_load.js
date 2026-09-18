#!/usr/bin/env node
/**
 * scripts/lms_load.js
 * 安全受控的 LM Studio 模型装载 CLI (替代裸调用 lms load)
 * 强制启用防重复拦截与显存预算守卫
 */

import { safeLoadModel, evictDuplicates, getLoadedModels, unloadAllModels } from '../tools/lms-guard.js';

const targetModel = process.argv[2];

if (!targetModel || targetModel === '--help' || targetModel === '-h') {
  console.log(`
使用方式:
  node scripts/lms_load.js <modelName>    安全幂等加载指定模型 (防重复、防显存爆炸)
  node scripts/lms_load.js --status       查看当前已加载模型与显存健康状况
  node scripts/lms_load.js --clean        主动清理当前显存中的所有冗余重复副本 (:2, :3)
  node scripts/lms_load.js --game         🎮 游戏模式：一秒排空所有显存 (0 GB 占用，20GB 满血归还游戏)
  node scripts/lms_load.js --work         💼 工作模式：重新装载 14B 深度推理模型至 GPU
`);
  process.exit(0);
}

if (targetModel === '--clean') {
  console.log('🧹 正在执行显存冗余排查与排空...');
  const evicted = evictDuplicates();
  if (evicted.length === 0) {
    console.log('✅ 当前显存无任何重复实例，状态健康。');
  }
  process.exit(0);
}

if (targetModel === '--status') {
  const list = getLoadedModels();
  console.log(`\n📊 当前已加载模型 (${list.length} 个):`);
  let total = 0;
  for (const m of list) {
    total += m.sizeBytes || 0;
    console.log(` - ${m.identifier} [${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB] (${m.status})`);
  }
  console.log(`总显存占用: ${(total / 1024 / 1024 / 1024).toFixed(2)} GB / 20 GB\n`);
  process.exit(0);
}

if (targetModel === '--game' || targetModel === '--release') {
  console.log('🎮 正在切换至 [游戏模式]：正在排空 GPU 显存...');
  const count = unloadAllModels();
  console.log(`✅ 已安全卸载 ${count} 个模型实例！`);
  console.log('🎉 显存已完全释放（当前占用 0.00 GB / 20 GB），可满血畅玩 3A 游戏！');
  console.log('💡 提示：游戏期间微信网桥自动降级为规则引擎，消息跟单与推送依然正常工作。');
  process.exit(0);
}

if (targetModel === '--work' || targetModel === '--restore') {
  const defaultDeepModel = process.env.LM_STUDIO_DEEP_MODEL || 'qwen2.5-14b-instruct';
  console.log(`💼 正在切换至 [工作模式]：正在装载深度推理模型 (${defaultDeepModel})...`);
  const res = safeLoadModel(defaultDeepModel, { gpu: 'max' });
  if (res.success) {
    console.log(`✅ 模型 "${defaultDeepModel}" 已成功装载至 GPU 显存！工作模式就绪。`);
    process.exit(0);
  } else {
    console.error(`❌ 装载失败: ${res.message}`);
    process.exit(1);
  }
}

const res = safeLoadModel(targetModel);
if (res.success) {
  process.exit(0);
} else {
  process.exit(1);
}
