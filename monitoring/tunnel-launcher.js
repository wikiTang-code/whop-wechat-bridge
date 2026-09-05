/**
 * @file monitoring/tunnel-launcher.js
 * @description P1-11 / T16: Cloudflare Tunnel 启动与生命周期管理器 (挂载于 Web 看板进程)
 *
 * 开关规范:
 * - 默认关闭 (off): 仅当 process.env.ENABLE_TUNNEL === '1' 时显式拉起
 * - 进程绑定: 挂载于 whop-web-dashboard，Ingest 进程绝不起 Tunnel
 * - 优雅清理: 在进程退出或收到信号时安全杀掉子进程
 */

import { spawn } from 'child_process';

let tunnelProcess = null;

export function isTunnelEnabled() {
  return process.env.ENABLE_TUNNEL === '1';
}

export function startCloudflareTunnel(port = 8085) {
  if (!isTunnelEnabled()) {
    console.log('[Cloudflare Tunnel] ENABLE_TUNNEL 未开启 (默认 off)，跳过 Tunnel 启动');
    return null;
  }

  console.log('[Cloudflare Tunnel] 正在启动 Cloudflare quick tunnel，目标端口:', port);

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
        console.log(`=================================================`);
        console.log(`[Cloudflare Tunnel] 公网访问链接已生成: ${tunnelUrl}`);
        console.log(`=================================================`);

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
    });

    tunnelProcess.on('error', (err) => {
      console.warn('[Cloudflare Tunnel] 进程启动异常:', err.message);
    });

    return tunnelProcess;
  } catch (err) {
    console.warn('[Cloudflare Tunnel] 无法拉起 cloudflared:', err.message);
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
  }
}

process.on('exit', () => stopCloudflareTunnel());
process.on('SIGINT', () => stopCloudflareTunnel());
process.on('SIGTERM', () => stopCloudflareTunnel());
