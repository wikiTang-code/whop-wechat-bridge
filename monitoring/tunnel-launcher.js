/**
 * @file monitoring/tunnel-launcher.js
 * @description P1-11 / T16 / P2-12e: Cloudflare Tunnel 启动、生命周期管理与 URL 状态持久化 (挂载于 Web 看板进程)
 *
 * 开关规范:
 * - 默认关闭 (off): 仅当 process.env.ENABLE_TUNNEL === '1' 时显式拉起
 * - 进程绑定: 挂载于 whop-web-dashboard，Ingest 进程绝不起 Tunnel
 * - 优雅清理: 在进程退出或收到信号时安全杀掉子进程
 * - 可观测性 (P2-12e): URL 落盘至 data/runtime/tunnel_url.json，并在 /health.subsystems.tunnel 暴露状态
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

let tunnelProcess = null;
let currentTunnelUrl = null;
let tunnelUpdatedAtMs = null;

export function getTunnelStateFilePath() {
  return process.env.TUNNEL_STATE_FILE || path.resolve('data/runtime/tunnel_url.json');
}

export function isTunnelEnabled() {
  return process.env.ENABLE_TUNNEL === '1';
}

/**
 * 将 Tunnel 状态持久化到磁盘文件 (原子写入)
 */
function persistTunnelState({ url = null, status = 'off', port = null, description = '' } = {}) {
  try {
    const filePath = getTunnelStateFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const now = Date.now();
    const beijingStr = new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const payload = {
      status,
      url,
      port,
      description,
      updatedAtMs: now,
      updatedAtBeijing: beijingStr,
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Cloudflare Tunnel] 持久化 Tunnel 状态文件异常:', err.message);
  }
}

/**
 * 获取当前 Tunnel 运行与 URL 状态 (供 /health 探针及 dashboard 调用)
 */
export function getTunnelStatus() {
  const enabled = isTunnelEnabled();
  if (!enabled) {
    return {
      status: 'off',
      enabled: false,
      url: null,
      updatedAtMs: null,
    };
  }

  // 若内存已有有效 URL
  if (currentTunnelUrl) {
    return {
      status: 'ok',
      enabled: true,
      url: currentTunnelUrl,
      updatedAtMs: tunnelUpdatedAtMs,
    };
  }

  // 尝试从状态文件 fallback 读取 (例如跨测试或进程重启场景)
  try {
    const filePath = getTunnelStateFilePath();
    if (fs.existsSync(filePath)) {
      const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (fileData && fileData.url) {
        currentTunnelUrl = fileData.url;
        tunnelUpdatedAtMs = fileData.updatedAtMs;
        return {
          status: fileData.status || 'ok',
          enabled: true,
          url: fileData.url,
          updatedAtMs: fileData.updatedAtMs,
        };
      }
    }
  } catch (_) {}

  // Tunnel 启用但未获得有效 URL 时判定为 warn
  return {
    status: 'warn',
    enabled: true,
    url: null,
    updatedAtMs: null,
    description: 'Tunnel 已启用但尚未提取到有效公网 URL',
  };
}

/**
 * 测试夹具辅助函数：显式设置 mock Tunnel URL
 */
export function setMockTunnelState({ url = null, status = 'ok', updatedAtMs = Date.now() } = {}) {
  currentTunnelUrl = url;
  tunnelUpdatedAtMs = updatedAtMs;
  persistTunnelState({ url, status, description: 'Mock state for testing' });
}

export function startCloudflareTunnel(port = 8085) {
  if (!isTunnelEnabled()) {
    console.log('[Cloudflare Tunnel] ENABLE_TUNNEL 未开启 (默认 off)，跳过 Tunnel 启动');
    persistTunnelState({ url: null, status: 'off', port, description: 'ENABLE_TUNNEL=0 (off)' });
    return null;
  }

  console.log('[Cloudflare Tunnel] 正在启动 Cloudflare quick tunnel，目标端口:', port);
  persistTunnelState({ url: null, status: 'starting', port, description: 'Tunnel launching...' });

  try {
    tunnelProcess = spawn('npx', ['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], { shell: true });

    let urlFound = false;
    const handleData = async (data) => {
      const output = data.toString();
      if (urlFound) return;

      const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        const tunnelUrl = match[0];
        urlFound = true;
        currentTunnelUrl = tunnelUrl;
        tunnelUpdatedAtMs = Date.now();

        console.log(`=================================================`);
        console.log(`[Cloudflare Tunnel] 公网访问链接已生成: ${tunnelUrl}`);
        console.log(`=================================================`);

        // P2-12e: URL 成功提取后原子写盘
        persistTunnelState({
          url: tunnelUrl,
          status: 'ok',
          port,
          description: 'TryCloudflare quick tunnel active',
        });

        const wechatWebhook = process.env.WECHAT_WORK_WEBHOOK_URL;
        if (wechatWebhook) {
          try {
            const msgText = `### 🌐 Whop 看板服务启动成功\n\n已成功启动 Web 看板，并通过 Cloudflare Tunnel 穿透公网。\n\n**公网地址**: [点击访问](${tunnelUrl})\n**本地端口**: http://localhost:${port}`;
            await fetch(wechatWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ msgtype: 'markdown', markdown: { content: msgText } })
            });
          } catch (err) {
            console.warn('[Cloudflare Tunnel] 企微推送公网地址失败:', err.message);
          }
        }
      }
    };

    if (tunnelProcess.stdout) tunnelProcess.stdout.on('data', handleData);
    if (tunnelProcess.stderr) tunnelProcess.stderr.on('data', handleData);

    tunnelProcess.on('close', (code) => {
      console.log(`[Cloudflare Tunnel] 进程已退出，代码: ${code}`);
      tunnelProcess = null;
      persistTunnelState({
        url: currentTunnelUrl,
        status: 'stopped',
        port,
        description: `Process exited with code ${code}`,
      });
    });

    tunnelProcess.on('error', (err) => {
      console.warn('[Cloudflare Tunnel] 进程启动异常:', err.message);
      persistTunnelState({
        url: null,
        status: 'error',
        port,
        description: `Process error: ${err.message}`,
      });
    });

    return tunnelProcess;
  } catch (err) {
    console.warn('[Cloudflare Tunnel] 无法拉起 cloudflared:', err.message);
    persistTunnelState({
      url: null,
      status: 'error',
      port,
      description: `Spawn failed: ${err.message}`,
    });
    return null;
  }
}

export function stopCloudflareTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch (_) {}
    tunnelProcess = null;
    console.log('[Cloudflare Tunnel] 已停止');
    persistTunnelState({
      url: currentTunnelUrl,
      status: 'stopped',
      description: 'Stopped manually or signal received',
    });
  }
}

process.on('exit', () => stopCloudflareTunnel());
process.on('SIGINT', () => stopCloudflareTunnel());
process.on('SIGTERM', () => stopCloudflareTunnel());

