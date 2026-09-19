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

import { execSync, spawnSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNC_CLIENT_PATH = path.join(__dirname, 'http-sync-client.mjs');

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
/**
 * 同步 HTTP 请求辅助函数 (利用独立脚本传参执行，杜绝命令行引号转义问题)
 */
export function syncHttpRequest(options, bodyData = null) {
  const bodyStr = bodyData ? JSON.stringify(bodyData) : '';
  try {
    const res = spawnSync(process.execPath, [
      SYNC_CLIENT_PATH,
      options.url,
      options.method || 'GET',
      bodyStr
    ], {
      encoding: 'utf-8',
      timeout: (options.timeout || 5000) + 2000
    });
    if (res.stdout && res.stdout.trim()) {
      return JSON.parse(res.stdout.trim());
    }
    return {
      status: 500,
      ok: false,
      error: `spawnSync error: code=${res.status}, signal=${res.signal}, stderr=${res.stderr}, err=${res.error?.message || 'none'}`
    };
  } catch (err) {
    return { status: 500, ok: false, error: err.message };
  }
}

/**
 * Resolve WSL eth IP for Windows→WSL Supervisor hops (CHG-024).
 * Cached briefly; override with WSL_SUPERVISOR_HOST / WSL_HOST_IP.
 */
let cachedWslIp = { ip: null, at: 0 };
export function resolveWslSupervisorHost(explicitHost) {
  if (explicitHost) return explicitHost;
  if (process.env.WSL_SUPERVISOR_HOST) return process.env.WSL_SUPERVISOR_HOST.trim();
  if (process.env.WSL_HOST_IP) return process.env.WSL_HOST_IP.trim();
  // Inside WSL, Supervisor listens on WSL loopback
  if (process.platform === 'linux' && fsExistsProcVersionWsl()) {
    return '127.0.0.1';
  }
  if (process.platform !== 'win32') return '127.0.0.1';
  const now = Date.now();
  if (cachedWslIp.ip && now - cachedWslIp.at < 60_000) return cachedWslIp.ip;
  try {
    const out = execSync('wsl -e bash -lc "hostname -I"', { encoding: 'utf-8', timeout: 8000 }).trim();
    const ip = out.split(/\s+/).find((p) => /^\d+\.\d+\.\d+\.\d+$/.test(p));
    if (ip) {
      cachedWslIp = { ip, at: now };
      return ip;
    }
  } catch (_) {}
  return '127.0.0.1';
}

function fsExistsProcVersionWsl() {
  try {
    const v = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return v.includes('microsoft') || v.includes('wsl');
  } catch {
    return false;
  }
}

export class WslLlamaAdapter extends BaseRuntimeAdapter {
  constructor(options = {}) {
    super('wsl-llama-server');
    // CHG-024: on Windows, prefer WSL eth IP for :18080 so unload works without localhost bridge
    this.host = resolveWslSupervisorHost(options.host);
    this.port = options.port || 8080;
    this.supervisorPort = options.supervisorPort || parseInt(process.env.WSL_SUPERVISOR_PORT || '18080', 10);
  }

  ps() {
    // 1. 优先向 WSL Supervisor 进程守护服务拉取进程状态
    const supRes = syncHttpRequest({
      url: `http://${this.host}:${this.supervisorPort}/status`,
      method: 'GET',
      timeout: 2000
    });
    if (supRes.ok && supRes.body) {
      try {
        const data = JSON.parse(supRes.body);
        if (data && Array.isArray(data.models)) {
          return data.models;
        }
      } catch (_) {}
    }

    // 2. 备选：探测标准 OpenAI /v1/models 接口
    const apiRes = syncHttpRequest({
      url: `http://${this.host}:${this.port}/v1/models`,
      method: 'GET',
      timeout: 2000
    });
    if (apiRes.ok && apiRes.body) {
      try {
        const data = JSON.parse(apiRes.body);
        if (data && Array.isArray(data.data)) {
          return data.data.map(m => ({
            identifier: m.id,
            modelKey: m.id,
            sizeBytes: m.sizeBytes || 15 * 1024 * 1024 * 1024
          }));
        }
      } catch (_) {}
    }

    return [];
  }

  load(modelKey, options = {}) {
    const cleanKey = String(modelKey || '').trim();
    // 向 Supervisor 派发真实进程拉起指令
    const res = syncHttpRequest({
      url: `http://${this.host}:${this.supervisorPort}/load`,
      method: 'POST',
      timeout: 10000
    }, { modelKey: cleanKey, ...options });

    if (res.ok && res.body) {
      try {
        const data = JSON.parse(res.body);
        return {
          success: Boolean(data.success),
          message: data.message || `Loaded ${cleanKey} via supervisor (PID: ${data.pid || 'n/a'})`
        };
      } catch (_) {}
    }

    return {
      success: false,
      message: res.error || `Supervisor load failed (status: ${res.status})`
    };
  }

  unload(identifier) {
    // 向 Supervisor 派发真实进程终止与显存排空指令
    const res = syncHttpRequest({
      url: `http://${this.host}:${this.supervisorPort}/unload`,
      method: 'POST',
      timeout: 10000
    }, { identifier });

    if (res.ok && res.body) {
      try {
        const data = JSON.parse(res.body);
        return {
          success: Boolean(data.success),
          message: data.message || `Unloaded ${identifier} via supervisor`
        };
      } catch (_) {}
    }

    return {
      success: false,
      message: res.error || `Supervisor unload failed (status: ${res.status})`
    };
  }

  healthCheck() {
    const res = syncHttpRequest({
      url: `http://${this.host}:${this.supervisorPort}/health`,
      method: 'GET',
      timeout: 2000
    });
    return res.status === 200;
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

  // CHG-023: default WSL llama-server; set AI_RUNTIME_BACKEND=lms only for rollback
  const backend = backendOverride || process.env.AI_RUNTIME_BACKEND || 'wsl';

  if (backend === 'mock') {
    activeAdapter = new MockRuntimeAdapter();
  } else if (backend === 'wsl_llama' || backend === 'wsl') {
    activeAdapter = new WslLlamaAdapter();
  } else if (backend === 'lms' || backend === 'windows_lms') {
    activeAdapter = new WindowsLmsAdapter();
  } else {
    activeAdapter = new WslLlamaAdapter();
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
