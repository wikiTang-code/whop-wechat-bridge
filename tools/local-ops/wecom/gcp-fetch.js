/**
 * Fetch WeCom APIs via ssh gcp-vm curl, so egress IP is the stable GCP public IP.
 *
 * URL is base64-encoded into the remote script so `&` / `?` never hit the login shell.
 */
import { spawn } from 'child_process';

/** POSIX single-quote escape for remote bash -c. */
export function shSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteCurlScript(url, { method = 'GET' } = {}) {
  const b64 = Buffer.from(String(url), 'utf8').toString('base64');
  const m = String(method || 'GET').toUpperCase();
  // Decode URL, then curl; -w appends \n + http_code after body.
  let script = `u=$(printf '%s' ${shSingleQuote(b64)} | base64 -d) && `;
  if (m === 'GET') {
    script += `curl -sS -m 30 -w $'\\n%{http_code}' -- "$u"`;
  } else {
    script += `curl -sS -m 30 -w $'\\n%{http_code}' -X ${m} `
      + `-H 'Content-Type: application/json' --data-binary @- -- "$u"`;
  }
  return script;
}

export function createGcpSshFetch({
  sshHost = process.env.LOCAL_OPS_SSH_HOST || 'gcp-vm',
  spawnImpl = spawn,
  timeoutMs = 45_000,
} = {}) {
  return async function gcpSshFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body != null ? String(init.body) : '';
    const script = buildRemoteCurlScript(url, { method });
    const remote = `bash -lc ${shSingleQuote(script)}`;

    const { stdout, stderr, code } = await new Promise((resolve, reject) => {
      const child = spawnImpl('ssh', [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=12',
        '-o', 'StrictHostKeyChecking=accept-new',
        sshHost,
        '--',
        remote,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        reject(new Error(`gcp ssh fetch timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (b) => { if (stdout.length < 256_000) stdout += b.toString('utf8'); });
      child.stderr.on('data', (b) => { if (stderr.length < 32_000) stderr += b.toString('utf8'); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: exitCode });
      });
      if (method !== 'GET') {
        child.stdin.write(body);
      }
      child.stdin.end();
    });

    if (code !== 0) {
      throw new Error(`gcp ssh curl failed code=${code}: ${stderr.slice(-400) || stdout.slice(-200)}`);
    }
    const nl = stdout.lastIndexOf('\n');
    const statusText = nl >= 0 ? stdout.slice(nl + 1).trim() : '200';
    const raw = nl >= 0 ? stdout.slice(0, nl) : stdout;
    const status = Number(statusText) || 0;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return JSON.parse(raw || '{}');
      },
      async text() {
        return raw;
      },
    };
  };
}
