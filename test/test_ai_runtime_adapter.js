/**
 * test/test_ai_runtime_adapter.js
 * 单元测试：AI 推理运行时抽象适配器 (AI Runtime Adapter)
 * 验证对 Windows LMS、WSL llama-server 和 Mock 适配器的解耦与多后端调度能力
 */

import {
  BaseRuntimeAdapter,
  WindowsLmsAdapter,
  WslLlamaAdapter,
  MockRuntimeAdapter,
  getRuntimeAdapter,
  setRuntimeAdapterForTest,
  resetRuntimeAdapter
} from '../tools/ai-runtime-adapter.js';

import {
  getLoadedModels,
  safeLoadModel,
  safeUnloadModel,
  evictDuplicates
} from '../tools/lms-guard.js';

console.log('===========================================================');
console.log('🧪 启动 AI Runtime Adapter 抽象层与解耦验证单测');
console.log('===========================================================\n');

// 1. 测试 Mock 适配器的基础行为
console.log('[测试 1] 验证 MockRuntimeAdapter 内存模型生命周期...');
const mock = new MockRuntimeAdapter([
  { identifier: 'qwen2.5-14b-instruct', modelKey: 'qwen2.5-14b-instruct', sizeBytes: 15 * 1024 * 1024 * 1024 }
]);

const initialList = mock.ps();
if (initialList.length !== 1 || initialList[0].identifier !== 'qwen2.5-14b-instruct') {
  console.error('❌ Mock 适配器初始模型列表不匹配:', initialList);
  process.exit(1);
}
console.log('  ✅ Mock 适配器初始状态正确');

// 2. 测试注入 Mock 适配器后 lms-guard 的绝对幂等性
console.log('\n[测试 2] 注入 Mock 适配器测试 lms-guard 幂等拦截...');
setRuntimeAdapterForTest(mock);

const guardLoaded = getLoadedModels();
if (guardLoaded.length !== 1) {
  console.error('❌ lms-guard 未能通过适配器读取模型');
  process.exit(1);
}

// 模拟重复加载已存在的 14B 模型
const resDup = safeLoadModel('qwen2.5-14b-instruct');
if (resDup.action !== 'already_loaded' || !resDup.success) {
  console.error('❌ lms-guard 幂等拦截失效:', resDup);
  process.exit(1);
}
console.log('  ✅ lms-guard 在 Mock 适配器下成功拦截已存在模型 (already_loaded)');

// 3. 测试通过 lms-guard 加载新模型 (1.5B) 并自动更新 Mock 状态
console.log('\n[测试 3] 测试通过 Adapter 加载新模型...');
const resNew = safeLoadModel('qwen2.5-coder-1.5b-instruct');
if (resNew.action !== 'loaded' || !resNew.success) {
  console.error('❌ 新模型装载失败:', resNew);
  process.exit(1);
}
const afterLoadList = getLoadedModels();
if (afterLoadList.length !== 2) {
  console.error('❌ 新模型未正确体现在显存列表中, 当前数量:', afterLoadList.length);
  process.exit(1);
}
console.log('  ✅ 新模型装载成功并同步至运行时');

// 4. 测试卸载逻辑
console.log('\n[测试 4] 测试通过 Adapter 卸载模型...');
const unCount = safeUnloadModel('qwen2.5-coder-1.5b-instruct');
if (unCount !== 1) {
  console.error('❌ 卸载模型数量异常:', unCount);
  process.exit(1);
}
const afterUnloadList = getLoadedModels();
if (afterUnloadList.length !== 1) {
  console.error('❌ 卸载后模型残留, 数量:', afterUnloadList.length);
  process.exit(1);
}
console.log('  ✅ 成功卸载模型并恢复基线');

// 5. 测试排重机制
console.log('\n[测试 5] 测试通过 Adapter 自动排重治理 (:2, :3 幽灵副本)...');
mock.models.set('qwen2.5-14b-instruct:2', {
  identifier: 'qwen2.5-14b-instruct:2',
  modelKey: 'qwen2.5-14b-instruct',
  sizeBytes: 15 * 1024 * 1024 * 1024
});
if (mock.ps().length !== 2) {
  console.error('❌ 注入重复副本失败');
  process.exit(1);
}
const evicted = evictDuplicates();
if (!evicted.includes('qwen2.5-14b-instruct:2') || mock.ps().length !== 1) {
  console.error('❌ 排重治理未能排空重复副本:', evicted);
  process.exit(1);
}
console.log('  ✅ 成功排空幽灵副本 :2');

// 6. 测试多后端切换单例机制
console.log('\n[测试 6] 验证多后端切换与单例管理...');
resetRuntimeAdapter();
const lmsAdapter = getRuntimeAdapter('lms');
if (!(lmsAdapter instanceof WindowsLmsAdapter)) {
  console.error('❌ 切换 lms 适配器类型错误');
  process.exit(1);
}
console.log('  ✅ lms 后端适配器实例化正确');

const wslAdapter = getRuntimeAdapter('wsl_llama');
if (!(wslAdapter instanceof WslLlamaAdapter)) {
  console.error('❌ 切换 wsl_llama 适配器类型错误');
  process.exit(1);
}
console.log('  ✅ wsl_llama 后端适配器实例化正确');

// 7. 测试游戏模式全量排空显存 (unloadAllModels)
console.log('\n[测试 7] 验证游戏模式一秒排空全部显存 (unloadAllModels)...');
const mockGame = new MockRuntimeAdapter([
  { identifier: 'qwen2.5-14b-instruct', modelKey: 'qwen2.5-14b-instruct', sizeBytes: 15 * 1024 * 1024 * 1024 },
  { identifier: 'qwen2.5-coder-1.5b-instruct', modelKey: 'qwen2.5-coder-1.5b-instruct', sizeBytes: 2 * 1024 * 1024 * 1024 }
]);
setRuntimeAdapterForTest(mockGame);

import { unloadAllModels } from '../tools/lms-guard.js';
const unloadedCount = unloadAllModels();
const afterGame = getLoadedModels();
if (unloadedCount !== 2 || afterGame.length !== 0) {
  console.error('❌ 游戏模式排空显存失败, 剩余模型:', afterGame);
  process.exit(1);
}
console.log(`  ✅ 成功排空 ${unloadedCount} 个模型实例，显存模型归零 (0 GB 占用)`);

// 恢复默认适配器
resetRuntimeAdapter();

console.log('\n===========================================================');
console.log('🎉 全部单测验证通过！Runtime Adapter 与游戏/工作模式显存调度验证通过！');
console.log('===========================================================');

