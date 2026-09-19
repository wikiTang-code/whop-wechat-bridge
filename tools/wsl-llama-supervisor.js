/**
 * tools/wsl-llama-supervisor.js
 * WSL2 AI 运行时进程守护与模型生命周期管理器 (WSL Llama Supervisor)
 *
 * 职责：
 * 1. 进程级管控：优先拉起真实 `llama-server`；仅当允许 mock 时回退 sleep 保活进程
 * 2. 显存排空：unload 时终止受管进程（SIGTERM + 端口/特征 pkill）
 * 3. 复用宿主机 GGUF：`/mnt/c/.../.lmstudio/models` 只读挂载
 * 4. 控制面：默认 `:18080`；推理面默认 `:8080`（与 LMS 互斥，切流后独占）
 *
 * Env:
 *   WSL_SUPERVISOR_PORT      控制面端口（默认 18080）
 *   LLAMA_SERVER_BIN         显式指定 WSL 内 llama-server 路径
 *   LLAMA_SERVER_PORT        推理端口（默认 8080）
 *   WSL_SUPERVISOR_ALLOW_MOCK=1  无二进制时允许 sleep-mock（单测默认开）
 */

import http from 'http';
import { spawn, execSync } from 'child_process';

const SUPERVISOR_PORT = parseInt(process.env.WSL_SUPERVISOR_PORT || '18080', 10);
const DEFAULT_INFER_PORT = parseInt(process.env.LLAMA_SERVER_PORT || '8080', 10);

const MODEL_REGISTRY = {
  'qwen2.5-14b-instruct': {
    path: '/mnt/c/Users/86597/.lmstudio/models/Qwen/Qwen2.5-14B-Instruct-GGUF/qwen2.5-14b-instruct-q8_0-00001-of-00004.gguf',
    sizeBytes: 15701597984,
    contextSize: 16384,
    ngpuLayers: 99
  },
  'qwen2.5-coder-1.5b-instruct': {
    path: '/mnt/c/Users/86597/.lmstudio/models/lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF/Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf',
    sizeBytes: 1646573056,
    contextSize: 8192,
    ngpuLayers: 99
  }
};

const CANDIDATE_BINS = [
  '/usr/local/bin/llama-server',
  '/usr/bin/llama-server',
  '/root/llama.cpp/build/bin/llama-server',
  '/root/llama.cpp/build-cpu/bin/llama-server',
  '/root/.local/bin/llama-server'
];

/** Escape for single-quoted bash strings */
export function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve llama-server binary path inside WSL.
 * @returns {string|null} absolute path or null
 */
export function resolveLlamaServerBin(options = {}) {
  const envBin = options.envBin ?? process.env.LLAMA_SERVER_BIN;
  if (envBin && String(envBin).trim()) return String(envBin).trim();

  const run = options.execSyncFn || ((cmd, opts) => execSync(cmd, opts));
  try {
    const found = run('wsl bash -c "command -v llama-server"', {
      encoding: 'utf-8',
      timeout: 8000
    }).trim();
    if (found && !found.includes('not found')) return found.split(/\r?\n/)[0].trim();
  } catch (_) {}

  // Expand ~ / $HOME candidates inside WSL (do not pass literal $HOME to test -x)
  try {
    const homeBins = run(
      'wsl bash -lc "echo \\$HOME/llama.cpp/build/bin/llama-server; echo \\$HOME/.local/bin/llama-server"',
      { encoding: 'utf-8', timeout: 5000 }
    )
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of homeBins) {
      try {
        const check = run(`wsl bash -lc "test -x ${shellSingleQuote(p)} && echo ${shellSingleQuote(p)}"`, {
          encoding: 'utf-8',
          timeout: 5000
        }).trim();
        if (check) return check.split(/\r?\n/)[0].trim();
      } catch (_) {}
    }
  } catch (_) {}

  for (const cand of CANDIDATE_BINS) {
    try {
      const check = run(`wsl bash -lc "test -x ${shellSingleQuote(cand)} && echo ${shellSingleQuote(cand)}"`, {
        encoding: 'utf-8',
        timeout: 5000
      }).trim();
      if (check) return check.split(/\r?\n/)[0].trim();
    } catch (_) {}
  }
  return null;
}

export function allowMockFallback() {
  return process.env.WSL_SUPERVISOR_ALLOW_MOCK === '1';
}

class WslLlamaSupervisor {
  constructor(options = {}) {
    this.currentProcess = null;
    this.activeModel = null;
    this.engineMode = null; // 'llama-server' | 'mock'
    this.serverPort = options.serverPort || DEFAULT_INFER_PORT;
    this.startedAt = null;
    this.httpServer = null;
    this.resolveBin = options.resolveBin || resolveLlamaServerBin;
  }

  getStatus() {
    const isRunning = Boolean(this.currentProcess && !this.currentProcess.killed);
    return {
      running: isRunning,
      pid: isRunning ? this.currentProcess.pid : null,
      activeModel: isRunning ? this.activeModel : null,
      engineMode: isRunning ? this.engineMode : null,
      serverPort: this.serverPort,
      uptimeSeconds: isRunning && this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      models: isRunning && this.activeModel ? [
        {
          identifier: this.activeModel,
          modelKey: this.activeModel,
          sizeBytes: MODEL_REGISTRY[this.activeModel]?.sizeBytes || 15 * 1024 * 1024 * 1024
        }
      ] : []
    };
  }

  async loadModel(modelKey, options = {}) {
    const cleanKey = String(modelKey || '').trim();
    if (this.currentProcess && !this.currentProcess.killed && this.activeModel === cleanKey) {
      return { success: true, action: 'already_loaded', pid: this.currentProcess.pid, engineMode: this.engineMode };
    }

    if (this.currentProcess && !this.currentProcess.killed) {
      await this.unloadModel();
    }

    const meta = MODEL_REGISTRY[cleanKey] || {
      path: cleanKey,
      sizeBytes: 10 * 1024 * 1024 * 1024,
      contextSize: 8192,
      ngpuLayers: 99
    };

    const bin = this.resolveBin();
    const useMock = !bin && allowMockFallback();

    if (!bin && !useMock) {
      return {
        success: false,
        message: 'llama-server not found in WSL. Set LLAMA_SERVER_BIN or install llama.cpp; for tests set WSL_SUPERVISOR_ALLOW_MOCK=1'
      };
    }

    console.log(`[WSL Supervisor] 🚀 拉起受管进程: ${cleanKey} (mode=${bin ? 'llama-server' : 'mock'})...`);
    this.activeModel = cleanKey;
    this.startedAt = Date.now();

    try {
      let child;
      if (bin) {
        const host = process.env.LLAMA_SERVER_HOST || '0.0.0.0';
        const ngl = Number.isFinite(meta.ngpuLayers) ? meta.ngpuLayers : 99;
        const ctx = Number.isFinite(meta.contextSize) ? meta.contextSize : 8192;
        const cmd = [
          shellSingleQuote(bin),
          '-m', shellSingleQuote(meta.path),
          '--host', host,
          '--port', String(this.serverPort),
          '-ngl', String(ngl),
          '-c', String(ctx)
        ].join(' ');
        child = spawn('wsl', ['--', 'bash', '-c', cmd], {
          stdio: 'ignore',
          detached: false
        });
        this.engineMode = 'llama-server';
      } else {
        child = spawn('wsl', [
          '--', 'bash', '-c',
          `echo "WSL Supervisor active mock: ${cleanKey}"; while true; do sleep 3600; done`
        ], {
          stdio: 'ignore',
          detached: false
        });
        this.engineMode = 'mock';
      }

      this.currentProcess = child;
      child.on('exit', () => {
        if (this.currentProcess === child) {
          this.currentProcess = null;
          this.activeModel = null;
          this.engineMode = null;
          this.startedAt = null;
        }
      });

      console.log(`[WSL Supervisor] ✅ 子进程已启动 (PID: ${child.pid}, mode=${this.engineMode})`);
      return {
        success: true,
        action: 'loaded',
        pid: child.pid,
        model: cleanKey,
        engineMode: this.engineMode
      };
    } catch (err) {
      console.error(`[WSL Supervisor] 启动失败:`, err.message);
      this.currentProcess = null;
      this.activeModel = null;
      this.engineMode = null;
      return { success: false, message: err.message };
    }
  }

  async unloadModel() {
    const mode = this.engineMode;
    const port = this.serverPort;

    if (this.currentProcess && !this.currentProcess.killed) {
      console.log(`[WSL Supervisor] 🛑 终止受管进程 (PID: ${this.currentProcess.pid}, mode=${mode})...`);
      try {
        this.currentProcess.kill('SIGTERM');
      } catch (_) {}
    }

    try {
      if (mode === 'llama-server') {
        execSync(
          `wsl bash -c "pkill -f 'llama-server.*--port ${port}' 2>/dev/null || pkill -f llama-server 2>/dev/null || true"`,
          { timeout: 5000 }
        );
      } else {
        execSync(
          `wsl bash -c "pkill -f 'WSL Supervisor active mock' 2>/dev/null || true"`,
          { timeout: 3000 }
        );
      }
    } catch (_) {}

    this.currentProcess = null;
    this.activeModel = null;
    this.engineMode = null;
    this.startedAt = null;
    console.log('[WSL Supervisor] ✅ 显存/进程已排空');
    return { success: true, message: 'unloaded' };
  }

  startServer(port = SUPERVISOR_PORT) {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'GET' && url.pathname === '/health') {
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: 'ok',
            supervisor: 'wsl-llama-supervisor',
            llamaServerBin: this.resolveBin(),
            allowMock: allowMockFallback(),
            timestamp: Date.now()
          }));
        }

        if (req.method === 'GET' && url.pathname === '/status') {
          res.writeHead(200);
          return res.end(JSON.stringify(this.getStatus()));
        }

        if (req.method === 'POST' && url.pathname === '/load') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = body ? JSON.parse(body) : {};
              const result = await this.loadModel(data.modelKey || 'qwen2.5-14b-instruct', data);
              res.writeHead(result.success ? 200 : 500);
              res.end(JSON.stringify(result));
            } catch (e) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/unload') {
          const result = await this.unloadModel();
          res.writeHead(200);
          return res.end(JSON.stringify(result));
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not_found' }));
      });

      this.httpServer.on('error', reject);
      this.httpServer.listen(port, '127.0.0.1', () => {
        console.log(`[WSL Supervisor] 监听就绪: http://127.0.0.1:${port}`);
        resolve(this.httpServer);
      });
    });
  }

  stopServer() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

export const supervisor = new WslLlamaSupervisor();
export { WslLlamaSupervisor, MODEL_REGISTRY };

if (process.argv[1] && process.argv[1].endsWith('wsl-llama-supervisor.js')) {
  supervisor.startServer().catch((err) => {
    console.error('[WSL Supervisor] 启动异常:', err.message);
    process.exit(1);
  });
}
