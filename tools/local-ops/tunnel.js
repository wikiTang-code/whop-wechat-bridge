/**
 * Managed reverse SSH tunnel: local LM :8080 -> gcp-vm :8080.
 * Process is detached so it outlives MCP/CLI invocations.
 * State file: tools/local-ops/state/lm-tunnel.json
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const DEFAULT_LOCAL = { host: '127.0.0.1', port: 8080 };
const DEFAULT_REMOTE = { host: '127.0.0.1', port: 8080 };

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState(statePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeState(statePath, data) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function clearState(statePath) {
  try {
    fs.unlinkSync(statePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function createTunnelManager({
  statePath,
  sshHost = 'gcp-vm',
  local = DEFAULT_LOCAL,
  remote = DEFAULT_REMOTE,
  spawnImpl = spawn,
  nowFn = () => Date.now(),
} = {}) {
  if (!statePath) throw new Error('tunnel statePath required');

  function status() {
    const st = readState(statePath);
    if (!st?.pid) {
      return { running: false, pid: null, started_at: null, ssh_host: sshHost, mapping: `${remote.host}:${remote.port}->${local.host}:${local.port}` };
    }
    const alive = isPidAlive(st.pid);
    if (!alive) {
      clearState(statePath);
      return { running: false, pid: null, started_at: null, stale_pid: st.pid, ssh_host: sshHost, mapping: `${remote.host}:${remote.port}->${local.host}:${local.port}` };
    }
    return {
      running: true,
      pid: st.pid,
      started_at: st.started_at || null,
      ssh_host: st.ssh_host || sshHost,
      mapping: st.mapping || `${remote.host}:${remote.port}->${local.host}:${local.port}`,
    };
  }

  function start() {
    const cur = status();
    if (cur.running) {
      return { ok: true, already_running: true, ...cur };
    }

    const remoteSpec = `${remote.host}:${remote.port}:${local.host}:${local.port}`;
    const argv = [
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-R', remoteSpec,
      sshHost,
    ];

    const outLog = path.join(path.dirname(statePath), 'lm-tunnel.out.log');
    const errLog = path.join(path.dirname(statePath), 'lm-tunnel.err.log');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const outFd = fs.openSync(outLog, 'a');
    const errFd = fs.openSync(errLog, 'a');

    const child = spawnImpl('ssh', argv, {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    });
    child.unref();
    try { fs.closeSync(outFd); } catch { /* ignore */ }
    try { fs.closeSync(errFd); } catch { /* ignore */ }

    if (!child.pid) {
      throw new Error('failed to spawn ssh tunnel (no pid)');
    }

    const record = {
      pid: child.pid,
      started_at: new Date(nowFn()).toISOString(),
      ssh_host: sshHost,
      mapping: remoteSpec,
      argv: ['ssh', ...argv],
    };
    writeState(statePath, record);
    return { ok: true, already_running: false, running: true, pid: child.pid, started_at: record.started_at, mapping: remoteSpec, ssh_host: sshHost };
  }

  function stop() {
    const st = readState(statePath);
    if (!st?.pid) {
      clearState(statePath);
      return { ok: true, stopped: false, reason: 'not_running' };
    }
    const pid = st.pid;
    const alive = isPidAlive(pid);
    if (alive) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        // On Windows SIGTERM may still work for ssh; fall through
        if (process.platform === 'win32') {
          try {
            spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
    clearState(statePath);
    return { ok: true, stopped: true, was_alive: alive, pid };
  }

  return { status, start, stop };
}
