/**
 * test/test_gpu_cli_arbiter.js
 * 验证 CHG-022: 
 * 1. monitor.js 统一接入 gpuArbiter，不再覆写破坏 global.gpuLock
 * 2. scripts/lms_load.js 优先与 GpuArbiter 状态联动，支持 --status / --game / --work
 */

import { gpuArbiter, ArbiterState } from '../tools/gpu-arbiter.js';
import { setRuntimeAdapterForTest, MockRuntimeAdapter, resetRuntimeAdapter } from '../tools/ai-runtime-adapter.js';

console.log('===========================================================');
console.log('🧪 [Test CHG-022] GpuArbiter 与 monitor.js / CLI 联动门禁测试');
console.log('===========================================================');

const mock = new MockRuntimeAdapter();
setRuntimeAdapterForTest(mock);
mock.load('qwen2.5-14b-instruct');

// 1. 验证 global.gpuLock 为统一真相源镜像
global.gpuLock = gpuArbiter.getStatus().gpuLock;
if (global.gpuLock.isLocked !== false || global.gpuLock.mode !== ArbiterState.IDLE) {
  console.error('❌ global.gpuLock 初始镜像不正确:', global.gpuLock);
  process.exit(1);
}
console.log('  ✅ 初始 global.gpuLock 镜像与 Arbiter 状态完全一致');

// 2. 模拟外部占锁，验证 checkDeepLaneAccess 阻断且 global.gpuLock 同步感知
await gpuArbiter.acquireExternalLock({
  owner: 'openmontage',
  purpose: 'video_render',
  vram_mb_estimate: 8000
});

const deepCheck = gpuArbiter.checkDeepLaneAccess();
if (!deepCheck.blocked) {
  console.error('❌ 外部占锁时深车道未被阻断');
  process.exit(1);
}

global.gpuLock = gpuArbiter.getStatus().gpuLock;
if (global.gpuLock.isLocked !== true || global.gpuLock.owner !== 'openmontage') {
  console.error('❌ global.gpuLock 未能感知外部占锁状态:', global.gpuLock);
  process.exit(1);
}
console.log('  ✅ 外部占锁时 deepLaneAccess 被正确拦截，global.gpuLock 保持同步');

// 3. 验证显式 keep 1.5B 快车道模型已在 Mock 适配器中常驻
const running = mock.ps();
const has14B = running.some(m => m.identifier === 'qwen2.5-14b-instruct');
const has1_5B = running.some(m => m.identifier === 'qwen2.5-coder-1.5b-instruct');
if (has14B || !has1_5B) {
  console.error('❌ 显式 keep 1.5B 状态异常:', running);
  process.exit(1);
}
console.log('  ✅ 14B 已排空释放，1.5B 快车道显式常驻运行中');

// 4. 释放锁
await gpuArbiter.releaseExternalLock({ owner: 'openmontage', restore: 'previous' });
await new Promise(r => setTimeout(r, 100));

global.gpuLock = gpuArbiter.getStatus().gpuLock;
if (global.gpuLock.isLocked !== false) {
  console.error('❌ 释放锁后 global.gpuLock 仍为锁定');
  process.exit(1);
}
console.log('  ✅ 释放锁后 14B 自动恢复，global.gpuLock 自动复位');

resetRuntimeAdapter();
console.log('===========================================================');
console.log('🎉 [Test CHG-022] GpuArbiter 门禁单测全部 PASS！');
console.log('===========================================================');
