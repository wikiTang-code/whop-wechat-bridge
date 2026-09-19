#!/usr/bin/env node
/**
 * tools/wsl-localhost-bridge.js — CHG-023
 * Userspace TCP bridge: Windows 127.0.0.1:8080 -> WSL_IP:8080
 * Used when netsh portproxy is unavailable (no Admin).
 *
 *   node tools/wsl-localhost-bridge.js --target 172.21.130.3:8080
 */
import net from 'net';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
function argVal(flag, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || '').trim() : fallback;
}

const listenHost = argVal('--listen-host', '127.0.0.1');
const listenPort = parseInt(argVal('--listen-port', process.env.LLAMA_SERVER_PORT || '8080'), 10);
const target = argVal('--target', process.env.WSL_BRIDGE_TARGET || '');
if (!target || !target.includes(':')) {
  console.error('Usage: node tools/wsl-localhost-bridge.js --target <wslIp>:8080');
  process.exit(1);
}
const [targetHost, targetPortStr] = target.split(':');
const targetPort = parseInt(targetPortStr, 10);

const pidDir = path.resolve('data/runtime');
const pidFile = path.join(pidDir, 'wsl-localhost-bridge.pid');

try {
  fs.mkdirSync(pidDir, { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
} catch (_) {}

const server = net.createServer((client) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const fail = () => {
    try { client.destroy(); } catch (_) {}
    try { upstream.destroy(); } catch (_) {}
  };
  client.on('error', fail);
  upstream.on('error', fail);
  client.on('close', () => { try { upstream.destroy(); } catch (_) {} });
  upstream.on('close', () => { try { client.destroy(); } catch (_) {} });
});

server.on('error', (err) => {
  console.error('[wsl-localhost-bridge]', err.message);
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`[wsl-localhost-bridge] ${listenHost}:${listenPort} -> ${targetHost}:${targetPort} (pid ${process.pid})`);
});

function cleanup() {
  try { fs.unlinkSync(pidFile); } catch (_) {}
  try { server.close(); } catch (_) {}
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
