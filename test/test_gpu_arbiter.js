/**
 * test/test_gpu_arbiter.js
 * 单元测试：GPU 时分复用仲裁器 (Time-Division GPU Arbiter)
 */

import { gpuArbiter, ArbiterState, isForbiddenLocalGpuRequest } from '../tools/gpu-arbiter.js';
import {
  MockRuntimeAdapter,
  setRuntimeAdapterForTest,
  resetRuntimeAdapter
} from '../tools/ai-runtime-adapter.js';

// CHG-024 tests: skip ROCm handoff delay in unit tests
process.env.GPU_RESTORE_DELAY_MS = '0';

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

// 4. 测试外部租户独占锁 (CHG-021: OpenMontage 协议契约落地)
console.log('\n[测试 4] 测试外部租户 (OpenMontage) 独占锁 acquire/release 契约与自动恢复...');

// 4.1 申请锁
const acqRes = await gpuArbiter.acquireExternalLock({
  owner: 'openmontage',
  purpose: 'local_video_gen',
  exclusive: true,
  ttl_seconds: 60
});
if (!acqRes.success || acqRes.mode_now !== ArbiterState.RENDER_OM) {
  console.error('❌ 外部租户申请锁失败:', acqRes);
  process.exit(1);
}
// 14B 应被排空，且 1.5B 快车道显式保留
const runningModels = mock.ps();
if (runningModels.some(m => m.identifier === 'qwen2.5-14b-instruct')) {
  console.error('❌ 外部租户占锁后 14B 未能排空:', runningModels);
  process.exit(1);
}
if (!runningModels.some(m => m.identifier === 'qwen2.5-coder-1.5b-instruct')) {
  console.error('❌ 外部租户占锁后 1.5B 快车道未能显式保留:', runningModels);
  process.exit(1);
}
// 快车道应降级
if (!gpuArbiter.shouldFastLaneFallback()) {
  console.error('❌ 外部租户占锁期间快车道降级开关未开启');
  process.exit(1);
}
// 深车道应拦截
const deepBlocked = gpuArbiter.checkDeepLaneAccess();
if (!deepBlocked.blocked) {
  console.error('❌ 外部租户占锁期间深车道未能正确退避');
  process.exit(1);
}

// 4.2 冲突互斥：第三方租户尝试申请应被拒
const conflictRes = await gpuArbiter.acquireExternalLock({
  owner: 'other_tenant',
  purpose: 'test'
});
if (conflictRes.success !== false || conflictRes.reason !== 'RENDER_BUSY') {
  console.error('❌ 冲突租户未能正确被拦截:', conflictRes);
  process.exit(1);
}

// 4.3 自身幂等刷新 TTL
const refreshRes = await gpuArbiter.acquireExternalLock({
  owner: 'openmontage',
  ttl_seconds: 120
});
if (!refreshRes.success || refreshRes.ttl_seconds !== 120) {
  console.error('❌ 自身幂等刷新 TTL 失败:', refreshRes);
  process.exit(1);
}

// 4.4 释放锁 (restore=previous)
const relRes = await gpuArbiter.releaseExternalLock({
  owner: 'openmontage',
  restore: 'previous'
});
if (!relRes.success || relRes.mode_now !== ArbiterState.DEEP_14B) {
  console.error('❌ 释放锁失败:', relRes);
  process.exit(1);
}

// 等待异步唤醒完成
await new Promise(r => setTimeout(r, 100));

const omRestored = mock.ps();
if (!omRestored.some(m => m.identifier === 'qwen2.5-14b-instruct')) {
  console.error('❌ OpenMontage 释放后 14B 模型未能自动恢复:', omRestored);
  process.exit(1);
}
console.log('  ✅ 外部租户 (OM) 独占排空、冲突拦截、幂等 TTL、释放后 14B 自动恢复全部通过！');

// 5. 测试 CHG-022 门禁收口逻辑 (共存策略、显式 keep 1.5B、restore_pending、GAME 模式)
console.log('\n[测试 5] 测试 CHG-022 门禁项：共存策略、显式 keep 1.5B、restore_pending 与游戏模式...');

// 5.1 轻量非独占共存: exclusive=false, vram_mb_estimate=2000 -> 14B 不卸载
const coexistRes = await gpuArbiter.acquireExternalLock({
  owner: 'lightweight_worker',
  purpose: 'quick_feature_extract',
  exclusive: false,
  vram_mb_estimate: 2000,
  ttl_seconds: 60
});
if (!coexistRes.success || coexistRes.coexist !== true) {
  console.error('❌ 轻量任务未能判定为共存:', coexistRes);
  process.exit(1);
}
// 14B 仍然存在
const coexistPs = mock.ps();
if (!coexistPs.find(m => m.identifier === 'qwen2.5-14b-instruct')) {
  console.error('❌ 共存模式下 14B 被错误卸载:', coexistPs);
  process.exit(1);
}
await gpuArbiter.releaseExternalLock({ owner: 'lightweight_worker', restore: 'previous' });
console.log('  ✅ 轻量非独占任务 (2GB) 成功与 14B 共存，14B 未被误卸');

// 5.2 视频模型 (8GB < 12GB): 卸 14B，但显式保留 1.5B 快车道
const videoRes = await gpuArbiter.acquireExternalLock({
  owner: 'openmontage_ltx',
  purpose: 'ltx_video_gen',
  exclusive: true,
  vram_mb_estimate: 8000,
  ttl_seconds: 60
});
if (!videoRes.success) {
  console.error('❌ 视频渲染申请锁失败:', videoRes);
  process.exit(1);
}
const afterVideoPs = mock.ps();
const has14B = afterVideoPs.some(m => m.identifier === 'qwen2.5-14b-instruct');
const has1_5B = afterVideoPs.some(m => m.identifier === 'qwen2.5-coder-1.5b-instruct');
if (has14B || !has1_5B) {
  console.error('❌ 8GB 视频模型占锁时未能正确卸载 14B 并保留 1.5B:', afterVideoPs);
  process.exit(1);
}
console.log('  ✅ 8GB 视频模型占锁：14B 卸载成功，且显式保持 1.5B 快车道常驻！');

// 5.3 释放锁测试 restore_pending 状态暴露
const relPromise = gpuArbiter.releaseExternalLock({
  owner: 'openmontage_ltx',
  restore: 'previous'
});
const midStatus = gpuArbiter.getStatus();
if (midStatus.restore_pending !== true) {
  console.error('❌ 释放锁后异步恢复中未能正确暴露 restore_pending=true:', midStatus);
  process.exit(1);
}
await relPromise;
// 等待异步恢复就绪
await new Promise(r => setTimeout(r, 100));
const endStatus = gpuArbiter.getStatus();
if (endStatus.restore_pending !== false) {
  console.error('❌ 异步恢复完成后 restore_pending 未复位为 false:', endStatus);
  process.exit(1);
}
console.log('  ✅ restore_pending 在恢复期间正确标记并在完成后自动复位！');

// 5.4 游戏模式测试: enterGameMode -> 显存清空 (0GB), 其他任务被拒
const gameRes = await gpuArbiter.enterGameMode({ owner: 'gamer' });
if (!gameRes.success || gameRes.mode_now !== ArbiterState.GAME) {
  console.error('❌ 进入游戏模式失败:', gameRes);
  process.exit(1);
}
if (mock.ps().length !== 0) {
  console.error('❌ 游戏模式下显存未归零:', mock.ps());
  process.exit(1);
}
const gameStatus = gpuArbiter.getStatus();
if (gameStatus.isGame !== true || gameStatus.state !== ArbiterState.GAME) {
  console.error('❌ 仲裁器状态未处于 GAME:', gameStatus);
  process.exit(1);
}
// 游戏期间任何租户申请均被拒绝 (HTTP 200 + success:false + reason:GAME_MODE)
const rejRent = await gpuArbiter.acquireExternalLock({ owner: 'other_job' });
if (rejRent.success !== false || rejRent.reason !== 'GAME_MODE') {
  console.error('❌ 游戏期间未正确拒绝其他租户:', rejRent);
  process.exit(1);
}
if (Object.prototype.hasOwnProperty.call(rejRent, 'retry_after')) {
  console.error('❌ GAME_MODE 不得带 retry_after（v0.1.4 人类挂起）:', rejRent);
  process.exit(1);
}
// 退出游戏模式
const exitRes = await gpuArbiter.exitGameMode({ restore: 'deep' });
if (!exitRes.success) {
  console.error('❌ 退出游戏模式失败:', exitRes);
  process.exit(1);
}
await new Promise(r => setTimeout(r, 100));
console.log('  ✅ 游戏模式成功一秒排空显存、锁定防打扰，退出后自动装回 14B！');

// 6. CHG-024: Wan / oversize reject + unload false-success closed
console.log('\n[测试 6] CHG-024 防呆：Wan14 拒载 + 卸载失败不发锁...');
if (!isForbiddenLocalGpuRequest({ vram_mb_estimate: 18000 })) {
  console.error('❌ vram>16000 应被拒绝');
  process.exit(1);
}
const wanRej = await gpuArbiter.acquireExternalLock({
  owner: 'openmontage',
  purpose: 'wan2.1-14b local video',
  vram_mb_estimate: 8000
});
if (wanRej.success !== false || wanRej.reason !== 'VRAM_EXCEEDED_20GB_BUDGET') {
  console.error('❌ Wan 14B 未拒载:', wanRej);
  process.exit(1);
}

class StickyFailUnloadAdapter extends MockRuntimeAdapter {
  unload(identifier) {
    this.history.push({ action: 'unload_fail', identifier, timestamp: Date.now() });
    return { success: false, message: 'ECONNREFUSED simulated' };
  }
}
const sticky = new StickyFailUnloadAdapter([
  { identifier: 'qwen2.5-14b-instruct', modelKey: 'qwen2.5-14b-instruct', sizeBytes: 15 * 1024 * 1024 * 1024 }
]);
setRuntimeAdapterForTest(sticky);
gpuArbiter.state = ArbiterState.IDLE;
gpuArbiter.currentOwner = null;
const failAcq = await gpuArbiter.acquireExternalLock({
  owner: 'openmontage',
  exclusive: true,
  vram_mb_estimate: 8000
});
if (failAcq.success !== false || failAcq.reason !== 'UNLOAD_FAILED') {
  console.error('❌ 卸载失败仍发了锁:', failAcq);
  process.exit(1);
}
if (gpuArbiter.state === ArbiterState.RENDER_OM) {
  console.error('❌ 卸载失败后状态未回滚:', gpuArbiter.getStatus());
  process.exit(1);
}
console.log('  ✅ CHG-024 拒载与假成功闭环通过');

// 7. CHG-025 / v0.1.4: status aliases + INVALID_PAYLOAD
console.log('\n[测试 7] CHG-025 / v0.1.4 status 契约与 INVALID_PAYLOAD...');
setRuntimeAdapterForTest(mock);
const st = gpuArbiter.getStatus();
if (st.mode !== st.state || typeof st.locked !== 'boolean' || !('free_vram_mb' in st)) {
  console.error('❌ status 缺少 mode/locked/free_vram_mb:', st);
  process.exit(1);
}
const bad = await gpuArbiter.acquireExternalLock({});
if (bad.success !== false || bad.reason !== 'INVALID_PAYLOAD' || Object.prototype.hasOwnProperty.call(bad, 'retry_after')) {
  console.error('❌ INVALID_PAYLOAD 契约不符:', bad);
  process.exit(1);
}
console.log('  ✅ status aliases + INVALID_PAYLOAD 通过');

// 恢复适配器单例
resetRuntimeAdapter();

console.log('\n===========================================================');
console.log('🎉 GpuArbiter 所有时分复用、跨项目协议与 CHG-022/024/025 门禁单测全部验证通过！');
console.log('===========================================================');
