/**
 * test/test_gpu_arbiter.js
 * 单元测试：GPU 时分复用仲裁器 (Time-Division GPU Arbiter)
 */

import { gpuArbiter, ArbiterState } from '../tools/gpu-arbiter.js';
import {
  MockRuntimeAdapter,
  setRuntimeAdapterForTest,
  resetRuntimeAdapter
} from '../tools/ai-runtime-adapter.js';

console.log('===========================================================');
console.log('🧪 启动 GPU 时分复用仲裁器 (GpuArbiter) 核心逻辑单测');
console.log('===========================================================\n');

// 1. 初始化 Mock 适配器并注入
const mock = new MockRuntimeAdapter([
  { identifier: 'qwen2.5-14b-instruct', modelKey: 'qwen2.5-14b-instruct', sizeBytes: 15 * 1024 * 1024 * 1024 }
]);
setRuntimeAdapterForTest(mock);

// 初始状态校验
console.log('[测试 1] 校验 Arbiter 初始状态与模型基线...');
const s0 = gpuArbiter.getStatus();
if (s0.state !== ArbiterState.IDLE || s0.isTraining !== false) {
  console.error('❌ 初始状态错误:', s0);
  process.exit(1);
}
if (mock.ps().length !== 1) {
  console.error('❌ Mock 初始模型未挂载');
  process.exit(1);
}
console.log('  ✅ 初始状态为 IDLE，14B 模型正常驻留');

// 2. 测试时分微调独占锁获取、模型卸载、降级感知与最终恢复
console.log('\n[测试 2] 测试 withTrainingLock 时分调度完整流程...');
let stepChecked = false;

const trainPromise = gpuArbiter.withTrainingLock('test_flywheel', async () => {
  // 此时应当在训练中
  const duringStatus = gpuArbiter.getStatus();
  if (!duringStatus.isTraining || duringStatus.owner !== 'test_flywheel') {
    throw new Error('训练期间状态异常: ' + JSON.stringify(duringStatus));
  }

  // 14B 模型应当已被卸载
  const loadedModels = mock.ps();
  if (loadedModels.length !== 0) {
    throw new Error('14B 模型未能在训练前被排空，当前显存中残留: ' + JSON.stringify(loadedModels));
  }

  // 校验快车道降级开关
  if (!gpuArbiter.shouldFastLaneFallback()) {
    throw new Error('训练期间快车道降级开关未开启！');
  }

  // 校验深车道退避拦截
  const deepAccess = gpuArbiter.checkDeepLaneAccess();
  if (!deepAccess.blocked || deepAccess.retryAfter !== 45) {
    throw new Error('训练期间深车道未能正确退避: ' + JSON.stringify(deepAccess));
  }

  stepChecked = true;
  return { trained_samples: 100 };
});

const result = await trainPromise;
if (!stepChecked || result.trained_samples !== 100) {
  console.error('❌ 训练执行逻辑未完整跑通');
  process.exit(1);
}

// 训练结束后：状态恢复 IDLE，14B 模型必须被重新恢复加载
const afterStatus = gpuArbiter.getStatus();
if (afterStatus.state !== ArbiterState.IDLE || afterStatus.isTraining !== false) {
  console.error('❌ 训练后状态未恢复 IDLE:', afterStatus);
  process.exit(1);
}

const restoredModels = mock.ps();
if (restoredModels.length !== 1 || restoredModels[0].identifier !== 'qwen2.5-14b-instruct') {
  console.error('❌ 训练结束后 14B 模型未自动恢复:', restoredModels);
  process.exit(1);
}
console.log('  ✅ 训练期间 14B 成功卸载、快车道降级、深车道退避；训练后 14B 自动完全恢复！');

// 3. 测试训练异常时的安全兜底 (finally 确保 14B 恢复且锁释放)
console.log('\n[测试 3] 测试训练任务异常抛错时的容灾恢复...');
let thrown = false;
try {
  await gpuArbiter.withTrainingLock('faulty_task', async () => {
    throw new Error('Simulated ROCm Out-of-Resource Exception');
  });
} catch (e) {
  thrown = true;
}

if (!thrown) {
  console.error('❌ 预期错误未被捕获');
  process.exit(1);
}

const errRecoveredStatus = gpuArbiter.getStatus();
if (errRecoveredStatus.state !== ArbiterState.IDLE) {
  console.error('❌ 异常后锁未释放:', errRecoveredStatus);
  process.exit(1);
}
const errRestoredModels = mock.ps();
if (errRestoredModels.length !== 1 || errRestoredModels[0].identifier !== 'qwen2.5-14b-instruct') {
  console.error('❌ 异常后 14B 未能兜底恢复:', errRestoredModels);
  process.exit(1);
}
console.log('  ✅ 异常发生后，Arbiter 成功在 finally 中兜底恢复 14B 并释放训练锁');

// 恢复适配器单例
resetRuntimeAdapter();

console.log('\n===========================================================');
console.log('🎉 GpuArbiter 所有时分复用与安全恢复单测全部验证通过！');
console.log('===========================================================');
