import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import {
  buildGexLatestPayload,
  computeAgeAndStale,
  readGexLatestFile,
  GEX_MATRIX_ALLOW,
  GEX_MATRIX_DEFAULT,
} from '../../../monitoring/gex-readonly.js';

const ZERO_DTE_ALLOW = new Set(['SPY', 'QQQ', 'SPX', 'VIX', 'NDX']);
const MATRIX_ALLOW = new Set(GEX_MATRIX_ALLOW);
const HTML_ALLOW = Object.freeze({
  heatseeker: 'heatseeker_gex.html',
  ...Object.fromEntries(
    [...MATRIX_ALLOW].map((t) => [`matrix_${t}`, `gex_matrix_${t}.html`]),
  ),
});
const SKIP_FLAG = path.join('data', 'gex', '.skip_open_session');

function errorCount(raw) {
  return Array.isArray(raw?.errors) ? raw.errors.length : 0;
}

function parseTickerList(value, allow, fallback) {
  if (value == null || value === '') return [...fallback];
  const list = Array.isArray(value)
    ? value
    : String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const raw of list) {
    const t = String(raw).toUpperCase();
    if (!allow.has(t)) {
      throw new Error(`ticker not in allowlist: ${t} (allowed: ${[...allow].join(',')})`);
    }
    if (!out.includes(t)) out.push(t);
  }
  if (out.length === 0) throw new Error('ticker list empty after validation');
  return out;
}

function probeTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

function defaultOpen(target, spawnImpl) {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      child = spawnImpl('cmd', ['/c', 'start', '', target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      const bin = process.platform === 'darwin' ? 'open' : 'xdg-open';
      child = spawnImpl(bin, [target], { detached: true, stdio: 'ignore' });
    }
    child.on('error', reject);
    child.unref();
    resolve({ opened: true, target });
  });
}

export function createGexAdapter({
  rootDir,
  nowFn = () => Date.now(),
  readLatest,
  spawnImpl = spawn,
  openImpl,
  collectTimeoutMs = 15 * 60 * 1000,
} = {}) {
  const load = readLatest || ((dir) => readGexLatestFile(dir));
  const opener = openImpl || ((target) => defaultOpen(target, spawnImpl));

  async function runCollect(args = {}) {
    const host = process.env.FUTU_OPEND_HOST || '127.0.0.1';
    const port = Number(process.env.FUTU_OPEND_PORT || 11111);
    const reachable = await probeTcp(host, port);
    if (!reachable) {
      return {
        ok: false,
        exit_code: 1,
        error: 'opend_unreachable',
        opend: { host, port, reachable: false },
        zero_dte: [],
        matrix: [],
        stderr_tail: `Futu OpenD 未监听 ${host}:${port}。请先启动并登录 OpenD（美股期权 API 权限），再 /ops collect。`,
        do_not_use_as_order: true,
      };
    }

    const zero = parseTickerList(args.zero_dte, ZERO_DTE_ALLOW, ['SPY', 'QQQ', 'SPX']);
    const skipMatrix = args.skip_matrix === true;
    const matrix = skipMatrix
      ? []
      : parseTickerList(args.matrix, MATRIX_ALLOW, [...GEX_MATRIX_DEFAULT]);
    const expiries = args.expiries == null ? 5 : Number(args.expiries);
    if (!Number.isInteger(expiries) || expiries < 1 || expiries > 10) {
      throw new Error('expiries must be integer 1..10');
    }

    const script = path.join(rootDir, 'tools', 'gex-sidecar', 'collect_futu.py');
    const argv = [
      script,
      '--zero-dte', zero.join(','),
      '--expiries', String(expiries),
    ];
    if (skipMatrix || matrix.length === 0) argv.push('--skip-matrix');
    else argv.push('--matrix', matrix.join(','));

    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      LONGBRIDGE_REGION: process.env.LONGBRIDGE_REGION || 'global',
    };

    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawnImpl('python', argv, {
        cwd: rootDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        reject(new Error(`gex.collect timeout after ${collectTimeoutMs}ms`));
      }, collectTimeoutMs);
      child.stdout.on('data', (b) => { if (stdout.length < 16000) stdout += b.toString('utf8'); });
      child.stderr.on('data', (b) => { if (stderr.length < 16000) stderr += b.toString('utf8'); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ code: exitCode, stdout, stderr });
      });
    });

    const { raw, missing } = await load(rootDir);
    return {
      exit_code: code,
      ok: code === 0 && !missing && raw?.collection?.ok === true,
      zero_dte: zero,
      matrix,
      expiries,
      skip_matrix: skipMatrix || matrix.length === 0,
      generated_at: raw?.generated_at ?? null,
      source: raw?.source ?? null,
      error_count: errorCount(raw),
      stderr_tail: String(stderr || '').slice(-1500),
      stdout_tail: String(stdout || '').slice(-800),
      do_not_use_as_order: true,
    };
  }

  return {
    async invoke(id, args = {}) {
      if (id === 'gex.collect') return runCollect(args);

      if (id === 'gex.skip_open_session') {
        const flagPath = path.join(rootDir, SKIP_FLAG);
        const action = String(args.action || 'create').toLowerCase();
        if (action === 'create') {
          await fs.mkdir(path.dirname(flagPath), { recursive: true });
          await fs.writeFile(flagPath, `skip ${new Date().toISOString()}\n`, 'utf8');
          return { ok: true, action: 'create', path: SKIP_FLAG, exists: true };
        }
        if (action === 'remove') {
          try {
            await fs.unlink(flagPath);
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
          return { ok: true, action: 'remove', path: SKIP_FLAG, exists: false };
        }
        throw new Error('action must be create|remove');
      }

      if (id === 'gex.open_html') {
        const which = String(args.report || 'heatseeker');
        const fileName = HTML_ALLOW[which];
        if (!fileName) {
          throw new Error(`report must be one of ${Object.keys(HTML_ALLOW).join(',')}`);
        }
        const htmlPath = path.join(rootDir, 'data', 'gex', fileName);
        try {
          await fs.access(htmlPath);
        } catch {
          throw new Error(`missing html: data/gex/${fileName}`);
        }
        const opened = await opener(htmlPath);
        return { ...opened, report: which, file: `data/gex/${fileName}` };
      }

      const { raw, missing } = await load(rootDir);
      const now = nowFn();

      if (id === 'gex.freshness') {
        const { age_minutes, stale } = computeAgeAndStale(raw?.generated_at, raw?.session, now);
        return {
          generated_at: raw?.generated_at ?? null,
          age_minutes,
          session: raw?.session ?? null,
          stale: missing ? true : stale,
          rating: missing || stale ? 'stale' : 'fresh',
          error_count: errorCount(raw),
          missing: Boolean(missing),
          do_not_use_as_order: true,
        };
      }

      if (id === 'gex.status') {
        const payload = buildGexLatestPayload(raw, { now, symbol: 'TSLA', reports: [] });
        return {
          ok: payload.ok,
          missing: payload.missing,
          stale: payload.stale,
          age_minutes: payload.age_minutes,
          generated_at: payload.generated_at,
          session: payload.session,
          source: payload.source,
          collection_ok: payload.collection?.ok ?? null,
          error_count: errorCount(raw),
          oi_as_of: payload.oi_as_of,
          do_not_use_as_order: true,
        };
      }

      if (id === 'gex.summarize') {
        const payload = buildGexLatestPayload(raw, { now, symbol: 'TSLA', reports: [] });
        return {
          ...payload,
          do_not_use_as_order: true,
        };
      }

      throw new Error(`gex adapter cannot handle ${id}`);
    },
  };
}
