/**
 * tools/gpu-arbiter.js
 * GPU 显存时分复用与训练/推理仲裁器 (Time-Division GPU Arbiter)
 * 
 * 核心设计目标：
 * 解决 AMD RX 7900 XT 20GB 显存下 14B 大模型（占 14.6GB）与 1.5B 飞轮微调（需 4.2GB）
 * 无法并发常驻、强行并发会导致 PyTorch 显存不足静默降级挤爆 Host 内存的根本痛点。
 * 
 * 仲裁机制：
 * 1. 状态机：IDLE (空闲) | TRAINING (训练独占窗口) | DEEP_INFERENCE (深度推理)
 * 2. 独占训练窗口执行 SOP：
 *    - 申请训练锁 -> 状态切至 TRAINING
 *    - 自动排空 14B 推理显存 (safeUnloadModel，耗时 ~1s，释放 14.6GB)
 *    - 运行 1.5B 微调 (40s 独占 4.2GB 纯物理 VRAM)
 *    - 训练完成 -> 自动重新唤醒 14B (ensureModelReady，冷载 15~20s)
 *    - 释放锁 -> 状态恢复至 IDLE
 * 3. 车道降级策略：
 *    - 当状态为 TRAINING 时，快车道 (isFastLane) 请求立即指示降级为正则提取
 *    - 深车道 (isDeepLane) 请求直接退避 (返回 HTTP 503 + Retry-After)
 */

import { safeUnloadModel, ensureModelReady, getLoadedModels } from './lms-guard.js';

export const ArbiterState = {
  IDLE: 'IDLE',
  TRAINING: 'TRAINING',
  DEEP_INFERENCE: 'DEEP_INFERENCE'
};

class GpuArbiter {
  constructor() {
    this.state = ArbiterState.IDLE;
    this.currentOwner = null;
    this.lockedAt = null;
    this.waitQueue = [];
    this.defaultDeepModel = 'qwen2.5-14b-instruct';
  }

  /**
   * 获取当前仲裁器运行状态
   */
  getStatus() {
    return {
      state: this.state,
      isTraining: this.state === ArbiterState.TRAINING,
      owner: this.currentOwner,
      lockedAt: this.lockedAt,
      lockedDurationMs: this.lockedAt ? Date.now() - this.lockedAt : 0,
      queueLength: this.waitQueue.length
    };
  }

  /**
   * 检查快车道当前是否需要降级
   * @returns {boolean} 若处于微调独占期，返回 true 提示调用方降级为规则抽取
   */
  shouldFastLaneFallback() {
    return this.state === ArbiterState.TRAINING;
  }

  /**
   * 检查深车道当前是否被阻塞
   * @returns {{ blocked: boolean, reason?: string, retryAfter?: number }}
   */
  checkDeepLaneAccess() {
    if (this.state === ArbiterState.TRAINING) {
      return {
        blocked: true,
        reason: 'GPU 目前正处于 1.5B 模型时分微调窗口 (预计持续 40s)，14B 已暂时离线',
        retryAfter: 45
      };
    }
    return { blocked: false };
  }

  /**
   * 申请独占训练窗口并执行训练任务 (核心入口)
   * @param {string} owner 任务所有者 (如 'flywheel_engine')
   * @param {Function} trainCallback 训练执行逻辑
   * @param {object} [options]
   * @param {string} [options.targetDeepModel] 训练前后需要卸载与恢复的深车道模型名
   */
  async withTrainingLock(owner, trainCallback, options = {}) {
    const targetModel = options.targetDeepModel || this.defaultDeepModel;

    // 1. 等待排队获取锁 (单飞互斥)
    if (this.state !== ArbiterState.IDLE) {
      console.log(`[Arbiter] GPU 当前忙碌 (${this.state} by ${this.currentOwner})，任务 "${owner}" 进入等待队列...`);
      await new Promise(resolve => this.waitQueue.push(resolve));
    }

    this.state = ArbiterState.TRAINING;
    this.currentOwner = owner;
    this.lockedAt = Date.now();
    console.log(`[Arbiter] 🔒 成功获取 GPU 训练锁 (Owner: ${owner})，开始时分轮转调度...`);

    let trainError = null;
    let trainResult = null;

    try {
      // 2. 阶段 A: 卸载 14B 模型释放显存
      console.log(`[Arbiter] [Step 1/3] 正在排空 14B 推理显存 (${targetModel})...`);
      const unloadCount = safeUnloadModel(targetModel);
      console.log(`[Arbiter] [Step 1/3] 已排空 ${unloadCount} 个实例，显存已准备就绪给训练引擎`);

      // 3. 阶段 B: 执行独占训练任务
      console.log(`[Arbiter] [Step 2/3] 启动训练回调任务 (100% 独占显存)...`);
      trainResult = await trainCallback();
      console.log(`[Arbiter] [Step 2/3] 训练任务完成`);
    } catch (err) {
      trainError = err;
      console.error(`[Arbiter ERROR] 训练执行期间发生异常:`, err.message);
    } finally {
      // 4. 阶段 C: 恢复 14B 模型就绪
      console.log(`[Arbiter] [Step 3/3] 正在重新唤醒装载 14B 推理模型 (${targetModel})...`);
      try {
        const reloadRes = await ensureModelReady(targetModel);
        console.log(`[Arbiter] [Step 3/3] 14B 推理模型恢复完成:`, reloadRes.action || 'ready');
      } catch (reloadErr) {
        console.error(`[Arbiter ERROR] 重新装载 14B 失败:`, reloadErr.message);
      }

      // 5. 释放锁并唤醒队列中下一个任务
      const holdTimeMs = Date.now() - this.lockedAt;
      this.state = ArbiterState.IDLE;
      this.currentOwner = null;
      this.lockedAt = null;
      console.log(`[Arbiter] 🔓 训练锁已释放 (持有时间: ${Math.round(holdTimeMs / 1000)}s)`);

      if (this.waitQueue.length > 0) {
        const next = this.waitQueue.shift();
        next();
      }
    }

    if (trainError) {
      throw trainError;
    }
    return trainResult;
  }
}

// 导出全局单例
export const gpuArbiter = new GpuArbiter();
