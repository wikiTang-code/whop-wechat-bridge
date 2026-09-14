/**
 * SSH is transport only. Never interpolates user strings into a remote shell.
 * Recipe files are read from the local repo and piped to `bash -s`.
 * Optional args are passed only as validated LOCAL_OPS_* environment variables.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { redactText } from '../redact.js';

const HOST_RE = /^[A-Za-z0-9._-]+$/;
const ROOT_RE = /^\/[A-Za-z0-9/._-]+$/;
const RECIPE_RE = /^[a-z][a-z0-9_]*$/;
const MAX_OUT = 32 * 1024;

const PM2_NAMES = new Set([
  'whop-web-dashboard',
  'whop-ingest-worker',
  'whop-wechat-bridge',
]);

function parseJsonOrText(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty_remote_output' };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: redactText(trimmed) };
  }
}

function buildEnvArgs(id, args = {}) {
  const env = [];
  if (id === 'gcp.logs' || id === 'gcp.pm2_restart') {
    const name = String(args.name || (id === 'gcp.pm2_restart' ? '' : 'whop-web-dashboard'));
    if (!PM2_NAMES.has(name)) {
      throw new Error(`name must be one of ${[...PM2_NAMES].join(',')}`);
    }
    env.push(`LOCAL_OPS_PM2_NAME=${name}`);
    if (id === 'gcp.logs') {
      const lines = args.lines == null ? 40 : Number(args.lines);
      if (!Number.isInteger(lines) || lines < 1 || lines > 80) {
        throw new Error('lines must be integer 1..80');
      }
      env.push(`LOCAL_OPS_LOG_LINES=${lines}`);
    }
  }
  if (id === 'gcp.deploy_align') {
    const sha = String(args.sha || '');
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error('sha must be 40 lowercase hex chars');
    }
    env.push(`LOCAL_OPS_GIT_SHA=${sha}`);
  }
  return env;
}

export function createSshAdapter({
  recipesDir,
  host = 'gcp-vm',
  remoteRoot = '/home/wikitang628/whop-wechat-bridge',
  spawnImpl = spawn,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  timeoutMs = 45_000,
} = {}) {
  if (!HOST_RE.test(host)) throw new Error('invalid ssh host');
  if (!ROOT_RE.test(remoteRoot)) throw new Error('invalid remote_root');

  return {
    async invoke(id, args = {}, cap) {
      const recipe = cap?.recipe;
      if (!RECIPE_RE.test(recipe || '')) {
        throw new Error(`invalid recipe for ${id}`);
      }
      const scriptPath = path.join(recipesDir, `${recipe}.sh`);
      let script;
      try {
        script = String(readFile(scriptPath)).replace(/\r\n/g, '\n');
      } catch {
        throw new Error(`missing recipe script: ${recipe}.sh`);
      }
      if (/pm2\s+(delete|kill)\b/i.test(script)) {
        throw new Error(`recipe ${recipe} contains forbidden pm2 delete/kill`);
      }
      if (/pm2\s+stop\b/i.test(script)) {
        throw new Error(`recipe ${recipe} contains forbidden pm2 stop`);
      }
      if (/pm2\s+restart\b/i.test(script) && recipe !== 'gcp_pm2_restart') {
        throw new Error(`recipe ${recipe} contains forbidden pm2 restart`);
      }
      if (/bash\s+-lc/.test(script)) {
        throw new Error(`recipe ${recipe} contains forbidden bash -lc`);
      }

      const extraEnv = buildEnvArgs(id, args);
      const argv = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=8',
        host,
        '--',
        '/usr/bin/env',
        `LOCAL_OPS_REMOTE_ROOT=${remoteRoot}`,
        ...extraEnv,
        '/bin/bash',
        '-s',
      ];

      const { stdout, stderr, code } = await new Promise((resolve, reject) => {
        const child = spawnImpl('ssh', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          reject(new Error(`ssh timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on('data', (buf) => {
          if (stdout.length < MAX_OUT) stdout += buf.toString('utf8');
        });
        child.stderr.on('data', (buf) => {
          if (stderr.length < MAX_OUT) stderr += buf.toString('utf8');
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: exitCode });
        });
        child.stdin.write(script);
        child.stdin.end();
      });

      const payload = parseJsonOrText(stdout);
      if (code !== 0) {
        return {
          ok: false,
          exit_code: code,
          error: 'ssh_recipe_failed',
          stderr: redactText(stderr).slice(0, 2000),
          data: payload,
        };
      }
      return payload;
    },
  };
}
