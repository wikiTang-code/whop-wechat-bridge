#!/usr/bin/env node
/**
 * scripts/lms_load.js
 * 安全受控的 LM Studio 模型装载 CLI (替代裸调用 lms load)
 * 强制启用防重复拦截与显存预算守卫
 */

import { safeLoadModel, evictDuplicates, getLoadedModels } from '../tools/lms-guard.js';

const targetModel = process.argv[2];

if (!targetModel || targetModel === '--help' || targetModel === '-h') {
  console.log(`
使用方式:
  node scripts/lms_load.js <modelName>    安全幂等加载模型 (防重复、防显存爆炸)
  node scripts/lms_load.js --clean        主动清理当前显存中的所有冗余重复副本 (:2, :3)
  node scripts/lms_load.js --status       查看当前已加载模型与显存健康状况
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

const res = safeLoadModel(targetModel);
if (res.success) {
  process.exit(0);
} else {
  process.exit(1);
}
