import { spawn } from 'child_process';
import path from 'path';
import { probeLocalLmPort } from '../../../monitoring/ai-tunnel-circuit.js';
import { LOCAL_LM_DEFAULT_BASE } from '../../../ai-router-policy.js';
import { createTunnelManager } from '../tunnel.js';

const MODEL_ALLOW = new Set([
  'qwen2.5-14b-instruct',
  'text-embedding-nomic-embed-text-v1.5',
]);

function parseBase(baseUrl) {
  try {
    const u = new URL(baseUrl || LOCAL_LM_DEFAULT_BASE);
    return { host: u.hostname || '127.0.0.1', port: Number(u.port) || 8080 };
  } catch {
    return { host: '127.0.0.1', port: 8080 };
  }
}

function runCmd(spawnImpl, cmd, argv, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (b) => { if (stdout.length < 12000) stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { if (stderr.length < 12000) stderr += b.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function createLmAdapter({
  probe = probeLocalLmPort,
  fetchImpl = fetch,
  healthUrl = 'http://127.0.0.1:8085/health',
  lmBase = process.env.LM_STUDIO_BASE_URL || LOCAL_LM_DEFAULT_BASE,
  spawnImpl = spawn,
  tunnelManager,
  stateDir,
  sshHost = 'gcp-vm',
} = {}) {
  const { host, port } = parseBase(lmBase);
  const tunnel = tunnelManager || createTunnelManager({
    statePath: path.join(stateDir || path.join(process.cwd(), 'tools', 'local-ops', 'state'), 'lm-tunnel.json'),
    sshHost,
    spawnImpl,
  });

  async function probeLm() {
    const started = Date.now();
    const result = await probe(host, port, 1500);
    return {
      reachable: Boolean(result?.ok),
      host,
      port,
      rtt_ms: Date.now() - started,
      detail: result?.detail || '',
    };
  }

  async function listModels() {
    const url = `${lmBase.replace(/\/$/, '')}/v1/models`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    try {
      const res = await fetchImpl(url, { signal: ac.signal });
      if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
      const body = await res.json();
      const models = Array.isArray(body?.data)
        ? body.data.map((m) => m.id).filter(Boolean).slice(0, 12)
        : [];
      return { models, error: null };
    } catch (err) {
      return { models: [], error: err.name === 'AbortError' ? 'timeout' : (err.message || 'fetch_failed') };
    } finally {
      clearTimeout(t);
    }
  }

  async function readHealthTunnel() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    try {
      const res = await fetchImpl(healthUrl, { signal: ac.signal });
      if (!res.ok) return { available: false, status: null };
      const body = await res.json();
      const tunnelStatus = body?.subsystems?.aiTunnel || body?.aiTunnel || null;
      return { available: true, status: tunnelStatus };
    } catch {
      return { available: false, status: null };
    } finally {
      clearTimeout(t);
    }
  }

  async function lmsPs() {
    try {
      const { code, stdout, stderr } = await runCmd(spawnImpl, 'lms', ['ps'], { timeoutMs: 15000 });
      return {
        ok: code === 0,
        output: String(stdout || stderr || '').slice(0, 4000),
      };
    } catch (err) {
      return { ok: false, output: err.message };
    }
  }

  return {
    async invoke(id, args = {}) {
      if (id === 'lm.status') {
        const local_probe = await probeLm();
        const models = local_probe.reachable ? await listModels() : { models: [], error: 'unreachable' };
        const ps = await lmsPs();
        return { ...local_probe, ...models, lms_ps: ps };
      }

      if (id === 'lm.circuit_status') {
        const local_probe = await probeLm();
        const health = await readHealthTunnel();
        const managed = tunnel.status();
        return { local_probe, health_ai_tunnel: health, managed_tunnel: managed };
      }

      if (id === 'lm.tunnel.status') {
        return tunnel.status();
      }

      if (id === 'lm.tunnel.start') {
        return tunnel.start();
      }

      if (id === 'lm.tunnel.stop') {
        return tunnel.stop();
      }

      if (id === 'lm.load') {
        const model = String(args.model || 'qwen2.5-14b-instruct');
        if (!MODEL_ALLOW.has(model)) {
          throw new Error(`model must be one of ${[...MODEL_ALLOW].join(',')}`);
        }
        const gpu = String(args.gpu || 'max');
        if (!['max', 'off'].includes(gpu) && !/^(0(\.\d+)?|1(\.0+)?)$/.test(gpu)) {
          throw new Error('gpu must be max|off|0..1');
        }
        const argv = ['load', model, '-y', '--gpu', gpu];
        const { code, stdout, stderr } = await runCmd(spawnImpl, 'lms', argv, { timeoutMs: 300_000 });
        const local_probe = await probeLm();
        return {
          ok: code === 0,
          exit_code: code,
          model,
          gpu,
          stdout_tail: String(stdout || '').slice(-2000),
          stderr_tail: String(stderr || '').slice(-2000),
          local_probe,
        };
      }

      if (id === 'lm.unload') {
        const { code, stdout, stderr } = await runCmd(spawnImpl, 'lms', ['unload', '--all'], { timeoutMs: 120_000 });
        const local_probe = await probeLm();
        return {
          ok: code === 0,
          exit_code: code,
          stdout_tail: String(stdout || '').slice(-2000),
          stderr_tail: String(stderr || '').slice(-2000),
          local_probe,
        };
      }

      throw new Error(`lm adapter cannot handle ${id}`);
    },
  };
}
