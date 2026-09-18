/**
 * tools/lms-guard.js
 * LM Studio 显存安全与防重复加载守卫 (VRAM & Anti-Duplication Guard)
 * 
 * 核心设计原则：
 * 1. 绝对幂等性：任何已加载的模型绝对禁止重复执行 lms load，防止显存爆炸 (OOM)。
 * 2. 自动排重治理 (Auto-Evict Duplicates)：主动扫描并卸载幽灵副本 (:2, :3)。
 * 3. 显存预算硬拦截 (VRAM Hard Budget)：防止多个大模型挤爆 20GB VRAM。
 */

import { getRuntimeAdapter } from './ai-runtime-adapter.js';

/**
 * 获取当前推理运行时显存中驻留的全部模型
 * @returns {Array<object>}
 */
export function getLoadedModels() {
  try {
    const adapter = getRuntimeAdapter();
    const list = adapter.ps();
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[LMS Guard] 读取运行时模型列表失败:', err.message);
    return [];
  }
}

/**
 * 自动排重治理：清理所有带序号后缀的冗余副本 (:2, :3) 或重复模型
 * @returns {Array<string>} 卸载的实例列表
 */
export function evictDuplicates() {
  const adapter = getRuntimeAdapter();
  const models = getLoadedModels();
  const seenKeys = new Set();
  const evicted = [];

  for (const m of models) {
    const id = m.identifier;
    const key = m.modelKey || id;

    // 判定 1: 标识符带有 :2, :3
    // 判定 2: 同一个 modelKey 重复出现
    const isNumberedDuplicate = /:\d+$/.test(id);
    const isKeyDuplicate = seenKeys.has(key);

    if (isNumberedDuplicate || isKeyDuplicate) {
      console.warn(`[LMS Guard] 🚨 探测到冗余重复模型实例: ${id} (${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)，正在强制卸载排空...`);
      try {
        adapter.unload(id);
        evicted.push(id);
        console.log(`[LMS Guard] ✅ 成功排空重复副本: ${id}`);
      } catch (e) {
        console.error(`[LMS Guard] 卸载 ${id} 失败:`, e.message);
      }
    } else {
      seenKeys.add(key);
    }
  }

  return evicted;
}

/**
 * 纯幂等、防重复、显存安全装载器
 * @param {string} modelKey 目标模型名 (如 qwen2.5-14b-instruct)
 * @param {object} options 选项
 * @returns {{ success: boolean, action: 'already_loaded'|'loaded'|'blocked', message: string }}
 */
export function safeLoadModel(modelKey, options = {}) {
  if (!modelKey || !modelKey.trim()) {
    throw new Error('[LMS Guard] modelKey 不能为空');
  }
  const cleanKey = modelKey.trim();

  // 1. 第一道防线：先清理可能存在的幽灵副本
  evictDuplicates();

  // 2. 第二道防线：严格幂等探测，检查目标模型是否已在显存中
  const currentLoaded = getLoadedModels();
  const alreadyLoadedInstance = currentLoaded.find(m => {
    const mKey = (m.modelKey || '').toLowerCase();
    const mId = (m.identifier || '').toLowerCase();
    const target = cleanKey.toLowerCase();
    return mKey === target || mId === target || mKey.includes(target) || target.includes(mKey);
  });

  if (alreadyLoadedInstance) {
    const sizeGb = (alreadyLoadedInstance.sizeBytes / 1024 / 1024 / 1024).toFixed(2);
    const msg = `[LMS Guard] 🛡️ 幂等拦截：模型 "${alreadyLoadedInstance.identifier}" (显存占用 ${sizeGb} GB) 已经在运行中，绝对禁止重复加载！`;
    console.log(msg);
    return {
      success: true,
      action: 'already_loaded',
      identifier: alreadyLoadedInstance.identifier,
      message: msg
    };
  }

  // 3. 统计显存/内存状态信息 (非阻断，允许大上下文/CPU Offload 灵活配置)
  let currentTotalBytes = 0;
  for (const m of currentLoaded) {
    currentTotalBytes += (m.sizeBytes || 0);
  }
  const currentGb = (currentTotalBytes / 1024 / 1024 / 1024).toFixed(2);
  console.log(`[LMS Guard] 当前已加载模型基座大小约 ${currentGb} GB (已放开硬拦截，由 LM Studio 自动管理上下文/CPU Offload)`);

  // 4. 执行受控加载 (支持迟滞保活 TTL)
  const ttl = options.ttl !== undefined ? options.ttl : 3600; // 默认 1 小时迟滞保活
  console.log(`[LMS Guard] 🚀 显存预算核算通过，开始安全装载模型: ${cleanKey} (TTL: ${ttl > 0 ? ttl + 's' : 'none'})...`);
  try {
    const adapter = getRuntimeAdapter();
    const loadRes = adapter.load(cleanKey, { ...options, ttl });
    if (!loadRes.success) {
      throw new Error(loadRes.message);
    }
    console.log(`[LMS Guard] ✅ 模型 "${cleanKey}" 加载成功`);

    // 5. 加载后再次执行去重扫描兜底
    evictDuplicates();

    return {
      success: true,
      action: 'loaded',
      message: `Successfully loaded ${cleanKey}`
    };
  } catch (err) {
    const errMsg = `[LMS Guard] 加载 "${cleanKey}" 失败: ${err.message}`;
    console.error(errMsg);
    return {
      success: false,
      action: 'error',
      message: errMsg
    };
  }
}

// 单飞互斥缓存表，避免高并发深车道请求触发多次重复唤醒 load
const loadPromiseMap = new Map();

/**
 * 确保模型就绪 (带单飞互斥锁，支持按需 JIT 唤醒与防频繁切换迟滞保活)
 * @param {string} modelKey 目标模型名
 * @param {object} [options]
 * @param {number} [options.ttl=3600] 迟滞保活窗口(秒)，默认 1 小时
 */
export async function ensureModelReady(modelKey, options = {}) {
  const cleanKey = String(modelKey || '').trim();
  if (!cleanKey) return { success: false, message: 'modelKey is empty' };

  // 1. 先查当前是否已在显存中
  const current = getLoadedModels();
  const found = current.find(m => {
    const k = (m.modelKey || '').toLowerCase();
    const id = (m.identifier || '').toLowerCase();
    const target = cleanKey.toLowerCase();
    return k === target || id === target || k.includes(target) || target.includes(k);
  });
  if (found) {
    return { success: true, action: 'already_loaded', identifier: found.identifier };
  }

  // 2. 单飞互斥：如果已经在唤醒加载中，复用正在进行的 Promise，防止并发多次加载引发碰撞
  if (loadPromiseMap.has(cleanKey)) {
    return await loadPromiseMap.get(cleanKey);
  }

  const p = (async () => {
    try {
      console.log(`[LMS Guard] ⚡ 按需 JIT 唤醒加载模型: ${cleanKey} (TTL: ${options.ttl !== undefined ? options.ttl : 3600}s)...`);
      const res = safeLoadModel(cleanKey, options);
      return res;
    } finally {
      loadPromiseMap.delete(cleanKey);
    }
  })();

  loadPromiseMap.set(cleanKey, p);
  const result = await p;
  loadPromiseMap.delete(cleanKey);
  return result;
}

/**
 * 安全卸载指定模型的所有实例
 * @param {string} modelKey 
 */
export function safeUnloadModel(modelKey) {
  const cleanKey = String(modelKey || '').trim().toLowerCase();
  for (const k of Array.from(loadPromiseMap.keys())) {
    if (k.toLowerCase().includes(cleanKey) || cleanKey.includes(k.toLowerCase())) {
      loadPromiseMap.delete(k);
    }
  }

  const adapter = getRuntimeAdapter();
  const current = getLoadedModels();
  let count = 0;
  for (const m of current) {
    if (m.identifier.includes(modelKey) || (m.modelKey && m.modelKey.includes(modelKey))) {
      try {
        const res = adapter.unload(m.identifier);
        if (res.success) {
          console.log(`[LMS Guard] 已安全卸载: ${m.identifier}`);
          count++;
        } else {
          console.warn(`[LMS Guard] 卸载失败 ${m.identifier}:`, res.message);
        }
      } catch (e) {
        console.error(`[LMS Guard] 卸载异常 ${m.identifier}:`, e.message);
      }
    }
  }
  return count;
}

/**
 * 安全卸载当前显存中的所有模型实例 (游戏模式 / 彻底腾空显存)
 * @returns {number} 成功卸载的模型数量
 */
export function unloadAllModels() {
  loadPromiseMap.clear();
  const adapter = getRuntimeAdapter();
  const current = getLoadedModels();
  let count = 0;
  for (const m of current) {
    try {
      const res = adapter.unload(m.identifier);
      if (res.success) {
        console.log(`[LMS Guard] 已安全卸载: ${m.identifier}`);
        count++;
      } else {
        console.warn(`[LMS Guard] 卸载失败 ${m.identifier}:`, res.message);
      }
    } catch (e) {
      console.error(`[LMS Guard] 卸载异常 ${m.identifier}:`, e.message);
    }
  }
  return count;
}
