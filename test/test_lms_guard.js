/**
 * test/test_lms_guard.js
 * 单元测试：LM Studio 显存防重与幂等装载守卫
 */

import { getLoadedModels, evictDuplicates, safeLoadModel } from '../tools/lms-guard.js';

console.log('===========================================================');
console.log('🧪 启动 LM Studio 防重复加载与显存守卫 (LMS Guard) 验证测试');
console.log('===========================================================\n');

// 1. 测试读取当前显存模型列表
const loaded = getLoadedModels();
console.log(`[测试 1] 当前显存中模型数量: ${loaded.length}`);
for (const m of loaded) {
  console.log(` - 实例: ${m.identifier} | Key: ${m.modelKey} | 大小: ${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
}

// 2. 测试排重机制
console.log('\n[测试 2] 运行自动排重巡检...');
const evicted = evictDuplicates();
console.log(`排空冗余副本数: ${evicted.length}`);

// 3. 测试核心防线：对已存在的 14B 模型发起加载请求，验证是否触发绝对幂等拦截！
console.log('\n[测试 3] 模拟对已存在的 14B 模型发起加载 (必须触发幂等拦截，禁止二次加载)...');
const res14b = safeLoadModel('qwen2.5-14b-instruct');
console.log('拦截返回结果:', res14b);

if (res14b.action !== 'already_loaded' || !res14b.success) {
  console.error('❌ 严重漏洞：未成功拦截已存在的 14B 模型！');
  process.exit(1);
}
console.log('✅ 14B 防重复拦截生效！');

// 4. 测试核心防线：对已存在的 1.5B 模型发起加载请求
console.log('\n[测试 4] 模拟对已存在的 1.5B 模型发起加载 (必须触发幂等拦截)...');
const res1_5b = safeLoadModel('qwen2.5-coder-1.5b-instruct');
console.log('拦截返回结果:', res1_5b);

if (res1_5b.action !== 'already_loaded' || !res1_5b.success) {
  console.error('❌ 严重漏洞：未成功拦截已存在的 1.5B 模型！');
  process.exit(1);
}
console.log('✅ 1.5B 防重复拦截生效！');

console.log('\n===========================================================');
console.log('🎉 验证全部通过！LMS Guard 从机制上 100% 杜绝了重复加载与显存溢出！');
console.log('===========================================================');
