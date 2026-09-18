/**
 * tools/ai-runtime-adapter.js
 * AI 推理运行时抽象适配器 (AI Runtime Adapter)
 * 
 * 职责：
 * 消除 tools/lms-guard.js 对 Windows 宿主机 `lms` CLI 的硬编码强依赖，
 * 为 Windows LM Studio 与 WSL2 原生 llama-server 提供统一的控制面抽象：
 *   1. ps() -> 获取当前加载模型信息列表
 *   2. load(modelKey, options) -> 安全装载指定模型
 *   3. unload(identifier) -> 卸载指定模型实例
 *   4. healthCheck() -> 健康巡检与存活探测
 */

import { execSync } from 'child_process';
import http from 'http';

/**
 * 基础运行时适配器抽象基类
 */
export class BaseRuntimeAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * 列出当前驻留显存的所有模型
   * @returns {Promise<Array<{ identifier: string, modelKey: string, sizeBytes: number }>> | Array<{ identifier: string, modelKey: string, sizeBytes: number }>}
   */
  ps() {
    throw new Error(`${this.name} 未实现 ps() 方法`);
  }

  /**
   * 加载模型
   * @param {string} modelKey 
   * @param {object} options 
   * @returns {Promise<{ success: boolean, message: string }> | { success: boolean, message: string }}
   */
  load(modelKey, options = {}) {
    throw new Error(`${this.name} 未实现 load() 方法`);
  }

  /**
   * 卸载模型
   * @param {string} identifier 
   * @returns {Promise<{ success: boolean, message: string }> | { success: boolean, message: string }}
   */
  unload(identifier) {
    throw new Error(`${this.name} 未实现 unload() 方法`);
  }

  /**
   * 健康巡检
   * @returns {Promise<boolean> | boolean}
   */
  healthCheck() {
    return true;
  }
}

/**
 * 适配器 1：Windows 原生 LM Studio CLI 适配器 (既有默认路径)
 */
export class WindowsLmsAdapter extends BaseRuntimeAdapter {
  constructor() {
    super('windows-lms');
  }

  ps() {
    try {
      const raw = execSync('lms ps --json', { encoding: 'utf-8', timeout: 8000 });
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[WindowsLmsAdapter] 读取 lms ps 失败:', err.message);
      return [];
    }
  }

  load(modelKey, options = {}) {
    const ttl = options.ttl !== undefined ? options.ttl : 3600;
    const ttlArg = ttl > 0 ? ` --ttl ${ttl}` : '';
    const cmd = `lms load "${modelKey}" -y${ttlArg}`;
    try {
      execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
      return { success: true, message: `Successfully loaded ${modelKey}` };
    } catch (err) {
      return { success: false, message: `Failed to load ${modelKey}: ${err.message}` };
    }
  }

  unload(identifier) {
    try {
      execSync(`lms unload "${identifier}"`, { encoding: 'utf-8', timeout: 15000 });
      return { success: true, message: `Successfully unloaded ${identifier}` };
    } catch (err) {
      return { success: false, message: `Failed to unload ${identifier}: ${err.message}` };
    }
  }

  healthCheck() {
    try {
      const list = this.ps();
      return Array.isArray(list);
    } catch {
      return false;
    }
  }
}

/**
 * 适配器 2：WSL2 原生 llama-server 适配器 (方案 A 专用)
 * 通过 HTTP REST 管理接口与 WSL 内部守护进程通信
 */
export class WslLlamaAdapter extends BaseRuntimeAdapter {
  constructor(options = {}) {
    super('wsl-llama-server');
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 8080;
    this.modelsDir = options.modelsDir || '/mnt/c/Users/86597/.cache/lm-studio/models';
  }

  ps() {
    // 方案 A llama-server 暴露 /v1/models 标准接口
    try {
      // 同步探测 /v1/models (为与 lms-guard 同步签名保持一致)
      const res = execSync(`curl -s http://${this.host}:${this.port}/v1/models`, {
        encoding: 'utf-8',
        timeout: 4000
      });
      const data = JSON.parse(res);
      if (data && Array.isArray(data.data)) {
        return data.data.map(m => ({
          identifier: m.id,
          modelKey: m.id,
          sizeBytes: m.sizeBytes || 15 * 1024 * 1024 * 1024 // 估算 14B 占位
        }));
      }
      return [];
    } catch (err) {
      // 若尚未拉起或正在切换，安全降级为空列表
      return [];
    }
  }

  load(modelKey, options = {}) {
    // 方案 A llama-server 通过控制接口或热载脚本管理
    try {
      // 检查当前是否已提供服务
      const current = this.ps();
      if (current.some(m => m.modelKey === modelKey || m.identifier === modelKey)) {
        return { success: true, message: `Model ${modelKey} already online` };
      }
      // 触发 WSL 内部模型载入 (通过 control server 或 wsl 启动脚本)
      execSync(`wsl bash -c "touch /tmp/llama_target_model && echo '${modelKey}' > /tmp/llama_target_model"`, {
        encoding: 'utf-8',
        timeout: 10000
      });
      return { success: true, message: `Dispatched load signal for ${modelKey}` };
    } catch (err) {
      return { success: false, message: `Failed to signal load ${modelKey}: ${err.message}` };
    }
  }

  unload(identifier) {
    try {
      execSync(`wsl bash -c "rm -f /tmp/llama_target_model"`, {
        encoding: 'utf-8',
        timeout: 5000
      });
      return { success: true, message: `Dispatched unload signal for ${identifier}` };
    } catch (err) {
      return { success: false, message: `Failed to unload ${identifier}: ${err.message}` };
    }
  }

  healthCheck() {
    try {
      const res = execSync(`curl -s -o /dev/null -w "%{http_code}" http://${this.host}:${this.port}/health`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim();
      return res === '200';
    } catch {
      return false;
    }
  }
}

/**
 * 适配器 3：Mock 运行时适配器 (供自动化单测和沙盒演练使用)
 */
export class MockRuntimeAdapter extends BaseRuntimeAdapter {
  constructor(initialModels = []) {
    super('mock-adapter');
    this.models = new Map();
    for (const m of initialModels) {
      this.models.set(m.identifier, { ...m });
    }
    this.history = [];
  }

  ps() {
    this.history.push({ action: 'ps', timestamp: Date.now() });
    return Array.from(this.models.values());
  }

  load(modelKey, options = {}) {
    this.history.push({ action: 'load', modelKey, options, timestamp: Date.now() });
    const id = modelKey;
    this.models.set(id, {
      identifier: id,
      modelKey: modelKey,
      sizeBytes: options.sizeBytes || 10 * 1024 * 1024 * 1024
    });
    return { success: true, message: `Mock loaded ${modelKey}` };
  }

  unload(identifier) {
    this.history.push({ action: 'unload', identifier, timestamp: Date.now() });
    const existed = this.models.delete(identifier);
    return { success: existed, message: `Mock unloaded ${identifier}` };
  }

  healthCheck() {
    return true;
  }
}

// 全局活跃适配器单例
let activeAdapter = null;

/**
 * 获取当前全局生效的运行时适配器
 * @param {string} [backendOverride] 可选覆盖参数 ('lms' | 'wsl_llama' | 'mock')
 * @returns {BaseRuntimeAdapter}
 */
export function getRuntimeAdapter(backendOverride) {
  if (activeAdapter && !backendOverride) {
    return activeAdapter;
  }

  const backend = backendOverride || process.env.AI_RUNTIME_BACKEND || 'lms';

  if (backend === 'mock') {
    activeAdapter = new MockRuntimeAdapter();
  } else if (backend === 'wsl_llama' || backend === 'wsl') {
    activeAdapter = new WslLlamaAdapter();
  } else {
    // 默认回落至 Windows LMS 适配器
    activeAdapter = new WindowsLmsAdapter();
  }

  return activeAdapter;
}

/**
 * 测试专用注入函数
 * @param {BaseRuntimeAdapter|null} adapter 
 */
export function setRuntimeAdapterForTest(adapter) {
  activeAdapter = adapter;
}

/**
 * 重置适配器单例
 */
export function resetRuntimeAdapter() {
  activeAdapter = null;
}
