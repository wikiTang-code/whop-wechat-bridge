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

import { safeUnloadModel, ensureModelReady, getLoadedModels, unloadAllModels } from './lms-guard.js';
import { getRuntimeAdapter } from './ai-runtime-adapter.js';

export const ArbiterState = {
  IDLE: 'IDLE',
  DEEP_14B: 'DEEP_14B',
  FAST_1_5B: 'FAST_1.5B',
  'FAST_1.5B': 'FAST_1.5B',
  TRAINING: 'TRAINING',
  RENDER_OM: 'RENDER_OM',
  GAME: 'GAME'
};

/** CHG-024: hard reject local Wan 14B / A14B class on 20GB card */
export function isForbiddenLocalGpuRequest({ purpose = '', vram_mb_estimate = 0, model = '' } = {}) {
  const blob = `${purpose} ${model}`.toLowerCase();
  if (Number(vram_mb_estimate) > 16000) return true;
  if (/(wan\s*2\.[12]\s*-?\s*14|wan14|wan-?14|a14b|wan2\.2.?a14b)/i.test(blob)) return true;
  if (/\b14b\b/i.test(blob) && /wan|video|diffusion|comfy/i.test(blob)) return true;
  return false;
}

function modelStillLoaded(modelKey) {
  const key = String(modelKey || '').toLowerCase();
  try {
    return getLoadedModels().some((m) => {
      const id = String(m.identifier || '').toLowerCase();
      const mk = String(m.modelKey || '').toLowerCase();
      return id.includes(key) || mk.includes(key);
    });
  } catch {
    return true; // unknown → treat as still loaded (fail closed for exclusive)
  }
}

class GpuArbiter {
  constructor() {
    this.state = ArbiterState.IDLE;
    this.currentOwner = null;
    this.purpose = null;
    this.lockedAt = null;
    this.ttlSeconds = 900;
    this.ttlTimer = null;
    this.modeBefore = ArbiterState.IDLE;
    this.waitQueue = [];
    this.defaultDeepModel = 'qwen2.5-14b-instruct';
    this.defaultFastModel = 'qwen2.5-coder-1.5b-instruct';
    this.restorePending = false;
  }

  /**
   * 获取当前仲裁器运行状态 (向后兼容 + 扩展 v1 契约)
   */
  getStatus() {
    const isLocked = this.state === ArbiterState.TRAINING || this.state === ArbiterState.RENDER_OM || this.state === ArbiterState.GAME;
    let loadedList = [];
    let usedMb = 0;
    try {
      const models = getLoadedModels();
      loadedList = models.map(m => m.identifier);
      for (const m of models) {
        const bytes = Number(m.sizeBytes) || 0;
        if (bytes > 0) usedMb += Math.round(bytes / (1024 * 1024));
      }
    } catch (_) {}

    // ~18 GB usable budget on 7900 XT after desktop reserve (protocol §1)
    const usableMb = 18432;
    const free_vram_mb = usedMb > 0 ? Math.max(0, usableMb - usedMb) : null;

    return {
      // v0.1.4 external contract aliases
      mode: this.state,
      locked: isLocked,
      free_vram_mb,
      // internal / legacy
      state: this.state,
      isTraining: this.state === ArbiterState.TRAINING,
      isGame: this.state === ArbiterState.GAME,
      isLocked,
      owner: this.currentOwner,
      purpose: this.purpose,
      lockedAt: this.lockedAt,
      lockedDurationMs: this.lockedAt ? Date.now() - this.lockedAt : 0,
      ttlSeconds: this.ttlSeconds,
      queueLength: this.waitQueue.length,
      restore_pending: this.restorePending,
      loaded_models: loadedList,
      // 向后兼容旧版 /api/gpu/status data
      gpuLock: {
        isLocked,
        locked: isLocked,
        owner: this.currentOwner,
        acquiredAt: this.lockedAt,
        mode: this.state,
        restore_pending: this.restorePending,
        loaded_models: loadedList,
        free_vram_mb
      }
    };
  }

  /**
   * 检查快车道当前是否需要降级
   * @returns {boolean} 若处于微调或外部渲染独占期，返回 true 提示调用方降级为规则抽取
   */
  shouldFastLaneFallback() {
    return this.state === ArbiterState.TRAINING || this.state === ArbiterState.RENDER_OM;
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
    if (this.state === ArbiterState.RENDER_OM) {
      return {
        blocked: true,
        reason: `GPU 目前已被外部租户 ${this.currentOwner} 独占渲染中，14B 已暂时离线`,
        retryAfter: 30
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

  /**
   * 进入游戏模式 (人类独占，一秒排空所有显存，杜绝任何任务自动唤醒)
   */
  async enterGameMode({ owner = 'game' } = {}) {
    this.clearTtlTimer();
    this.state = ArbiterState.GAME;
    this.currentOwner = owner;
    this.purpose = 'gaming';
    this.lockedAt = Date.now();
    this.ttlSeconds = 86400; // 24小时兜底

    console.log(`[Arbiter] 🎮 进入游戏模式 (人类独占)，排空所有模型实例...`);
    let count = 0;
    try {
      count = unloadAllModels();
    } catch (e) {
      console.warn(`[Arbiter] 排空显存异常:`, e.message);
    }
    return {
      success: true,
      mode_now: ArbiterState.GAME,
      unloadedCount: count,
      message: 'GPU switched to GAME mode; VRAM cleared to 0 GB'
    };
  }

  /**
   * 退出游戏模式并恢复工作模型
   */
  async exitGameMode({ restore = 'deep', targetDeepModel = this.defaultDeepModel } = {}) {
    console.log(`[Arbiter] 💼 退出游戏模式，准备恢复工作模式 (restore=${restore})...`);
    this.state = restore === 'empty' ? ArbiterState.IDLE : ArbiterState.DEEP_14B;
    this.currentOwner = null;
    this.lockedAt = null;
    this.purpose = null;

    if (restore !== 'empty') {
      this.restorePending = true;
      ensureModelReady(targetDeepModel)
        .catch(err => console.error(`[Arbiter] 退出游戏模式恢复 14B 异常:`, err.message))
        .finally(() => { this.restorePending = false; });
    }

    return {
      success: true,
      mode_now: this.state,
      message: 'Exited GAME mode successfully',
      restored: restore !== 'empty'
    };
  }

  /**
   * 申请外部租户锁 (跨项目 HTTP v1 契约: OpenMontage 等)
   */
  async acquireExternalLock({
    owner,
    purpose = 'local_render',
    exclusive = true,
    vram_mb_estimate = 8000,
    ttl_seconds = 900,
    targetDeepModel = this.defaultDeepModel,
    model = ''
  } = {}) {
    if (!owner) {
      return { success: false, reason: 'INVALID_PAYLOAD', message: 'owner is required' };
    }

    // CHG-024: server-side hard reject oversize / Wan 14B class
    if (isForbiddenLocalGpuRequest({ purpose, vram_mb_estimate, model })) {
      return {
        success: false,
        reason: 'VRAM_EXCEEDED_20GB_BUDGET',
        message:
          'RX 7900XT 20GB budget rejected: requested model exceeds card capacity (Wan 14B is strictly cloud-only)'
      };
    }

    // 若申请游戏模式
    if (owner === 'game' || purpose === 'gaming') {
      return await this.enterGameMode({ owner });
    }

    // 若锁已被自己持有，幂等刷新 TTL
    if (this.currentOwner === owner && this.state === ArbiterState.RENDER_OM) {
      this.refreshTtl(owner, ttl_seconds);
      return {
        success: true,
        mode_before: this.modeBefore || ArbiterState.DEEP_14B,
        mode_now: ArbiterState.RENDER_OM,
        ttl_seconds,
        message: 'GPU lock already held by you; TTL refreshed'
      };
    }

    // 若当前处于 GAME 模式，拒绝
    if (this.state === ArbiterState.GAME) {
      return {
        success: false,
        reason: 'GAME_MODE',
        message: 'GPU 目前处于游戏模式 (人类独占)，暂不可用'
      };
    }

    // 若当前处于 SLM 时分微调中，返回忙碌与重试时间
    if (this.state === ArbiterState.TRAINING) {
      return {
        success: false,
        reason: 'TRAIN_1.5B',
        retry_after: 45,
        owner: this.currentOwner,
        message: 'GPU 目前正处于 1.5B 飞轮微调独占期 (预计 40s)'
      };
    }

    // 若已被其他外部租户持有，返回忙碌
    if (this.state === ArbiterState.RENDER_OM && this.currentOwner !== owner) {
      return {
        success: false,
        reason: 'RENDER_BUSY',
        retry_after: 60,
        owner: this.currentOwner,
        message: `GPU 目前已被 ${this.currentOwner} 独占渲染中`
      };
    }

    const canCoexistWith14B = !exclusive && vram_mb_estimate <= 4000;

    // CHG-024: exclusive path requires Supervisor reachable when deep model present or health fails closed
    if (!canCoexistWith14B) {
      let adapterOk = true;
      try {
        adapterOk = Boolean(getRuntimeAdapter().healthCheck());
      } catch {
        adapterOk = false;
      }
      const deepPresent = modelStillLoaded(targetDeepModel);
      if (!adapterOk && deepPresent) {
        return {
          success: false,
          reason: 'SUPERVISOR_UNREACHABLE',
          retry_after: 15,
          message: 'Supervisor :18080 unreachable; exclusive lock not granted while deep model may still be loaded'
        };
      }
    }

    // 成功抢占（先占锁；卸载失败则回滚 —— 禁止假成功）
    const prevState = this.state;
    const prevOwner = this.currentOwner;
    const prevPurpose = this.purpose;
    const prevLockedAt = this.lockedAt;
    const prevTtl = this.ttlSeconds;
    const prevModeBefore = this.modeBefore;

    this.modeBefore = this.state === ArbiterState.IDLE ? ArbiterState.DEEP_14B : this.state;
    this.state = ArbiterState.RENDER_OM;
    this.currentOwner = owner;
    this.purpose = purpose;
    this.lockedAt = Date.now();
    this.ttlSeconds = ttl_seconds;

    const unloadedModels = [];
    const rollback = () => {
      this.state = prevState;
      this.currentOwner = prevOwner;
      this.purpose = prevPurpose;
      this.lockedAt = prevLockedAt;
      this.ttlSeconds = prevTtl;
      this.modeBefore = prevModeBefore;
      this.clearTtlTimer();
    };

    if (canCoexistWith14B) {
      console.log(`[Arbiter] 💡 租户 "${owner}" 请求非独占轻量渲染 (预计 ${vram_mb_estimate}MB <= 4000MB)，允许与 14B 显存共存，不卸载 14B。`);
    } else {
      console.log(`[Arbiter] 🔒 租户 "${owner}" 获取 GPU 独占锁 (Purpose: ${purpose}, TTL: ${ttl_seconds}s)，正在排空 14B 显存...`);
      const deepBefore = modelStillLoaded(targetDeepModel);
      try {
        const count = safeUnloadModel(targetDeepModel);
        if (count > 0) unloadedModels.push(targetDeepModel);
      } catch (e) {
        console.warn(`[Arbiter] 卸载 ${targetDeepModel} 异常:`, e.message);
        rollback();
        return {
          success: false,
          reason: 'UNLOAD_FAILED',
          retry_after: 15,
          message: `Unload threw: ${e.message}`
        };
      }
      if (deepBefore && modelStillLoaded(targetDeepModel)) {
        rollback();
        return {
          success: false,
          reason: 'UNLOAD_FAILED',
          retry_after: 15,
          message: 'Supervisor :18080 unreachable or deep model still loaded; lock not granted'
        };
      }

      // 显式 keep 1.5B 规则 (Cursor 冻结 §7.4)
      if (vram_mb_estimate < 12000) {
        try {
          console.log(`[Arbiter] ⚡ 外部显存预算为 ${vram_mb_estimate}MB (< 12GB)，显式装载并保活 1.5B 快车道模型 (${this.defaultFastModel})...`);
          ensureModelReady(this.defaultFastModel).catch(() => {});
        } catch (_) {}
      } else {
        console.log(`[Arbiter] 🚨 外部显存预算 ${vram_mb_estimate}MB >= 12GB (顶格模型)，连 1.5B 快车道也排空，快车道全面降级为正则。`);
        try {
          safeUnloadModel(this.defaultFastModel);
          unloadedModels.push(this.defaultFastModel);
        } catch (_) {}
      }
    }

    this.setupTtlTimer(owner, ttl_seconds);

    return {
      success: true,
      mode_before: this.modeBefore,
      mode_now: ArbiterState.RENDER_OM,
      coexist: canCoexistWith14B,
      unloaded: unloadedModels,
      ttl_seconds
    };
  }

  /**
   * 释放外部租户锁并恢复模型
   */
  async releaseExternalLock({
    owner,
    restore = 'previous',
    targetDeepModel = this.defaultDeepModel
  } = {}) {
    if (!owner) {
      return { success: false, reason: 'INVALID_PAYLOAD', message: 'owner is required' };
    }

    // 若从游戏模式退出
    if (this.state === ArbiterState.GAME || owner === 'game') {
      return await this.exitGameMode({ restore, targetDeepModel });
    }

    if (this.state !== ArbiterState.RENDER_OM) {
      return { success: true, message: 'GPU is not currently locked by external tenant' };
    }

    if (this.currentOwner !== owner) {
      return { success: false, reason: 'FORBIDDEN', message: `Cannot release lock held by ${this.currentOwner}` };
    }

    this.clearTtlTimer();
    console.log(`[Arbiter] 🔓 租户 "${owner}" 释放 GPU 锁 (restore=${restore})`);

    let modeNow = ArbiterState.IDLE;
    if (restore === 'empty') {
      this.state = ArbiterState.IDLE;
      modeNow = ArbiterState.IDLE;
    } else {
      this.state = ArbiterState.DEEP_14B;
      modeNow = ArbiterState.DEEP_14B;
      // CHG-024: delay restore so OM ROCm allocator can return VRAM (tail-chase)
      this.restorePending = true;
      const delayMs = parseInt(process.env.GPU_RESTORE_DELAY_MS || '2500', 10);
      const wait = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 2500;
      const timer = setTimeout(() => {
        ensureModelReady(targetDeepModel)
          .catch(err => {
            console.error(`[Arbiter] 释放后异步唤醒 14B 异常:`, err.message);
          })
          .finally(() => {
            this.restorePending = false;
          });
      }, wait);
      if (timer.unref) timer.unref();
    }

    this.currentOwner = null;
    this.lockedAt = null;
    this.purpose = null;

    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next();
    }

    return {
      success: true,
      mode_now: modeNow,
      restore_pending: this.restorePending,
      message: 'GPU unlocked successfully',
      restored: restore !== 'empty'
    };
  }

  setupTtlTimer(owner, ttlSeconds) {
    this.clearTtlTimer();
    this.ttlTimer = setTimeout(() => {
      console.warn(`[Arbiter TTL] ⚠️ 租户 "${owner}" 持锁超过 ${ttlSeconds}s 未释放，看门狗自动触发回收！`);
      this.releaseExternalLock({ owner, restore: 'previous' }).catch(err => {
        console.error(`[Arbiter TTL] 自动释放异常:`, err.message);
      });
    }, ttlSeconds * 1000);
    if (this.ttlTimer.unref) this.ttlTimer.unref();
  }

  clearTtlTimer() {
    if (this.ttlTimer) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
  }

  refreshTtl(owner, ttlSeconds) {
    this.ttlSeconds = ttlSeconds;
    this.setupTtlTimer(owner, ttlSeconds);
  }
}

// 导出全局单例
export const gpuArbiter = new GpuArbiter();
