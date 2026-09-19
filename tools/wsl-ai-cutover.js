#!/usr/bin/env node
/**
 * tools/wsl-ai-cutover.js — CHG-023
 * 把 Windows 宿主机 http://127.0.0.1:8080 固定到 WSL llama-server（独占），
 * 结束「Windows=LMS / WSL=llama.cpp」双栈并存。
 *
 *   node tools/wsl-ai-cutover.js              # 切流（停 LMS + 起 WSL server + portproxy）
 *   node tools/wsl-ai-cutover.js --status     # 只探测双端指纹
 *   node tools/wsl-ai-cutover.js --rollback   # 拆 portproxy（不自动启 LMS）
 *
 * Env:
 *   LLAMA_SERVER_BIN / LLAMA_SERVER_PORT / WSL_AI_MODEL_PATH
 *   AI_CUTOVER_SKIP_KILL_LMS=1  仅探测+桥接，不杀 LMS（端口被占时会失败）
 */

import { execSync, spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveLlamaServerBin, shellSingleQuote } from './wsl-llama-supervisor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
function pathResolve(...parts) { return path.resolve(repoRoot, ...parts); }
function fsRead(p) { return fs.readFileSync(p, 'utf8'); }
function fsUnlink(p) { fs.unlinkSync(p); }

export const WIN_BASE = 'http://127.0.0.1:8080';
export const DEFAULT_MODEL_PATH =
  process.env.WSL_AI_MODEL_PATH ||
  '/mnt/c/Users/86597/.lmstudio/models/lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF/Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf';

const PORT = parseInt(process.env.LLAMA_SERVER_PORT || '8080', 10);

export function fingerprintFromModelsJson(bodyText) {
  const raw = String(bodyText || '');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'unknown', detail: 'non-json' };
  }
  const owned = [];
  const ids = [];
  if (Array.isArray(data?.data)) {
    for (const m of data.data) {
      if (m?.owned_by) owned.push(String(m.owned_by));
      if (m?.id) ids.push(String(m.id));
    }
  }
  if (Array.isArray(data?.models)) {
    for (const m of data.models) {
      if (m?.model) ids.push(String(m.model));
      if (m?.name) ids.push(String(m.name));
    }
  }
  const blob = `${owned.join(' ')} ${ids.join(' ')} ${raw.slice(0, 400)}`.toLowerCase();
  if (blob.includes('organization_owner') || blob.includes('lm studio')) {
    return { kind: 'lms', detail: 'organization_owner', ids };
  }
  if (blob.includes('llamacpp') || blob.includes('.gguf') || data?.object === 'list' && ids.some((i) => i.includes('/mnt/'))) {
    return { kind: 'wsl_llama', detail: 'llamacpp/gguf', ids };
  }
  if (ids.length || owned.length) {
    return { kind: 'other', detail: owned[0] || ids[0] || 'unknown-api', ids };
  }
  return { kind: 'down', detail: 'empty' };
}

export function httpGetJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: buf });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, body: '', error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: '', error: 'timeout' });
    });
  });
}

export async function probeWin8080() {
  const res = await httpGetJson(`${WIN_BASE}/v1/models`);
  if (!res.ok) return { reachable: false, fingerprint: { kind: 'down', detail: res.error || `http_${res.status}` } };
  return { reachable: true, fingerprint: fingerprintFromModelsJson(res.body) };
}

export function getWslIp() {
  try {
    const out = execSync('wsl -e bash -lc "hostname -I"', { encoding: 'utf-8', timeout: 8000 }).trim();
    const ip = out.split(/\s+/).find((p) => /^\d+\.\d+\.\d+\.\d+$/.test(p));
    return ip || null;
  } catch {
    return null;
  }
}

export async function probeWsl8080(wslIp) {
  if (!wslIp) return { reachable: false, fingerprint: { kind: 'down', detail: 'no_wsl_ip' } };
  const res = await httpGetJson(`http://${wslIp}:${PORT}/v1/models`);
  if (!res.ok) return { reachable: false, fingerprint: { kind: 'down', detail: res.error || `http_${res.status}` } };
  return { reachable: true, fingerprint: fingerprintFromModelsJson(res.body) };
}

export function stopWindowsLmStudio() {
  if (process.env.AI_CUTOVER_SKIP_KILL_LMS === '1') {
    return { skipped: true, killed: [] };
  }
  const names = [
    'LM Studio.exe',
    'LM Studio',
    'lms.exe'
  ];
  const killed = [];
  for (const name of names) {
    try {
      execSync(`taskkill /IM "${name}" /F`, { encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
      killed.push(name);
    } catch (_) {
      // not running
    }
  }
  // Electron helpers sometimes linger
  try {
    const list = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 10000 });
    for (const line of list.split(/\r?\n/)) {
      if (/LM Studio/i.test(line) || /lm-studio/i.test(line)) {
        const m = line.match(/"(\d+)"/);
        if (m) {
          try {
            execSync(`taskkill /PID ${m[1]} /F`, { timeout: 10000, stdio: 'ignore' });
            killed.push(`pid:${m[1]}`);
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return { skipped: false, killed };
}

export function waitPortFree(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const out = execSync(`netstat -ano | findstr ":${PORT}"`, { encoding: 'utf-8', timeout: 5000 });
      if (!/LISTENING/i.test(out)) return true;
    } catch {
      return true; // findstr exit 1 = no match
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  return false;
}

export function ensurePortProxy(wslIp) {
  if (!wslIp) throw new Error('WSL IP required for portproxy');
  try {
    execSync(`netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=${PORT}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (_) {}
  try {
    execSync(
      `netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=${PORT} connectaddress=${wslIp} connectport=${PORT}`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return { mode: 'portproxy', listen: `127.0.0.1:${PORT}`, connect: `${wslIp}:${PORT}` };
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    return { mode: 'portproxy_failed', error: msg.slice(0, 240) };
  }
}

export function stopUserspaceBridge() {
  const pidFile = pathResolve('data/runtime/wsl-localhost-bridge.pid');
  try {
    const pid = parseInt(fsRead(pidFile), 10);
    if (pid > 0) {
      try { execSync(`taskkill /PID ${pid} /F`, { timeout: 8000, stdio: 'ignore' }); } catch (_) {}
    }
  } catch (_) {}
  try { fsUnlink(pidFile); } catch (_) {}
}

export function ensureUserspaceBridge(wslIp) {
  stopUserspaceBridge();
  waitPortFree(5000);
  const bridgeJs = pathResolve('tools/wsl-localhost-bridge.js');
  const child = spawn(process.execPath, [bridgeJs, '--target', `${wslIp}:${PORT}`], {
    detached: true,
    stdio: 'ignore',
    cwd: pathResolve('.')
  });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  return { mode: 'userspace_bridge', pid: child.pid, connect: `${wslIp}:${PORT}` };
}

export function removePortProxy() {
  stopUserspaceBridge();
  try {
    execSync(`netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=${PORT}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

export function ensureWslLlamaServer(options = {}) {
  const modelPath = options.modelPath || DEFAULT_MODEL_PATH;
  const bin = resolveLlamaServerBin();
  if (!bin) {
    throw new Error('llama-server not found in WSL; build CPU/HIP binary first (DEBT-014)');
  }

  // Already healthy?
  try {
    const body = execSync(
      `wsl -e bash -lc "curl -sS -m 3 http://127.0.0.1:${PORT}/v1/models"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const fp = fingerprintFromModelsJson(body);
    if (fp.kind === 'wsl_llama') {
      return { action: 'already_running', bin, fingerprint: fp };
    }
  } catch (_) {}

  // Start detached inside WSL
  const ngl = process.env.LLAMA_N_GPU_LAYERS != null ? String(process.env.LLAMA_N_GPU_LAYERS) : '0';
  const cmd =
    `nohup ${shellSingleQuote(bin)} -m ${shellSingleQuote(modelPath)} ` +
    `--host 0.0.0.0 --port ${PORT} -ngl ${ngl} -c 4096 -t 8 ` +
    `>/tmp/llama-server-cutover.log 2>&1 & echo $!`;
  const pid = execSync(`wsl -e bash -lc ${shellSingleQuote(cmd)}`, {
    encoding: 'utf-8',
    timeout: 15000
  }).trim();

  // Wait ready
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const body = execSync(
        `wsl -e bash -lc "curl -sS -m 3 http://127.0.0.1:${PORT}/v1/models"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      const fp = fingerprintFromModelsJson(body);
      if (fp.kind === 'wsl_llama') {
        return { action: 'started', pid, bin, fingerprint: fp };
      }
    } catch (_) {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  throw new Error(`WSL llama-server started (pid=${pid}) but /v1/models not ready; see /tmp/llama-server-cutover.log`);
}

export async function runStatus() {
  const wslIp = getWslIp();
  const win = await probeWin8080();
  const wsl = await probeWsl8080(wslIp);
  return {
    wslIp,
    windows: win,
    wsl,
    cutoverOk: win.reachable && win.fingerprint.kind === 'wsl_llama'
  };
}

export async function runCutover(options = {}) {
  const report = {
    steps: [],
    ok: false
  };

  report.steps.push({ stopLms: stopWindowsLmStudio() });
  waitPortFree(10000);

  const server = ensureWslLlamaServer(options);
  report.steps.push({ wslServer: server });

  const wslIp = getWslIp();
  if (!wslIp) throw new Error('Cannot resolve WSL IP');
  report.wslIp = wslIp;

  // If Windows already sees WSL (mirrored), skip proxy
  let win = await probeWin8080();
  if (win.fingerprint?.kind === 'wsl_llama') {
    report.steps.push({ bridge: 'skipped_mirrored_localhost' });
  } else {
    const proxy = ensurePortProxy(wslIp);
    if (proxy.mode === 'portproxy') {
      report.steps.push({ bridge: proxy });
    } else {
      report.steps.push({ portproxy: proxy });
      const bridge = ensureUserspaceBridge(wslIp);
      report.steps.push({ bridge });
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    win = await probeWin8080();
  }

  report.windows = win;
  report.ok = win.reachable && win.fingerprint.kind === 'wsl_llama';
  if (!report.ok) {
    throw new Error(
      `Cutover incomplete: Windows :${PORT} fingerprint=${win.fingerprint?.kind} (${win.fingerprint?.detail}). ` +
        'Close LM Studio manually and re-run as Administrator if portproxy failed.'
    );
  }
  return report;
}

export async function runRollback() {
  removePortProxy();
  return { portproxyRemoved: true, note: 'LMS not auto-started; set AI_RUNTIME_BACKEND=lms to rollback control plane' };
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node tools/wsl-ai-cutover.js [--status|--rollback]\nDefault: full cutover`);
    process.exit(0);
  }
  try {
    if (args.includes('--status')) {
      printJson(await runStatus());
      process.exit(0);
    }
    if (args.includes('--rollback')) {
      printJson(await runRollback());
      process.exit(0);
    }
    const report = await runCutover();
    printJson({
      ok: report.ok,
      wslIp: report.wslIp,
      windowsFingerprint: report.windows?.fingerprint,
      steps: report.steps,
      hint: 'Default control plane: AI_RUNTIME_BACKEND=wsl ; base URL stays http://127.0.0.1:8080'
    });
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/wsl-ai-cutover.js');
if (isMain) {
  main();
}
