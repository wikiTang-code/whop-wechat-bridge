/**
 * P0-4: Local 14B SSH-tunnel probe + circuit breaker (Q1/Q2).
 * When open: SUSPEND task_queue head consumption, no retry-storm, no Gemini dump for bulk.
 * Alert-only soft degrade (R5). Side-path; feature-flaggable via AI_TUNNEL_CIRCUIT.
 */
import net from 'net';
import { sendAlert } from './alert-sink.js';
import { registerAiTunnelHealthGetter } from './health.js';
import { LOCAL_LM_DEFAULT_BASE } from '../ai-router-policy.js';

const DEFAULT_PROBE_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 1500;
const FAIL_THRESHOLD = 2;
const RECOVERY_THRESHOLD = 2;

let state = 'closed'; // closed | open | half-open
let failStreak = 0;
let successStreak = 0;
let lastProbe = {
  reachable: null,
  at: null,
  detail: '',
  host: '127.0.0.1',
  port: 8080,
};
let started = false;
let probeTimer = null;

function enabled() {
  return process.env.AI_TUNNEL_CIRCUIT !== '0';
}

function parseBase(baseUrl) {
  try {
    const u = new URL(baseUrl || LOCAL_LM_DEFAULT_BASE);
    return { host: u.hostname || '127.0.0.1', port: Number(u.port) || 8080 };
  } catch {
    return { host: '127.0.0.1', port: 8080 };
  }
}

export function probeLocalLmPort(host = '127.0.0.1', port = 8080, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true, 'connect'));
    socket.on('timeout', () => done(false, 'timeout'));
    socket.on('error', (err) => done(false, err.code || err.message));
    try {
      socket.connect(port, host);
    } catch (err) {
      done(false, err.message);
    }
  });
}

export function getAiTunnelStatus() {
  return {
    enabled: enabled(),
    status: state,
    suspended: state === 'open',
    failStreak,
    successStreak,
    lastProbe: { ...lastProbe },
  };
}

export function isAiTunnelSuspended() {
  return enabled() && state === 'open';
}

/** Force state (tests / ops). */
export function _setAiTunnelStateForTests(next) {
  state = next;
  failStreak = next === 'open' ? FAIL_THRESHOLD : 0;
  successStreak = next === 'closed' ? RECOVERY_THRESHOLD : 0;
}

async function transitionToOpen(detail) {
  if (state === 'open') return;
  state = 'open';
  console.warn(`[AiTunnelCircuit] OPEN — suspend queue consumption. ${detail}`);
  await sendAlert({
    subsystem: 'ai_tunnel',
    level: 'critical',
    title: '本地 14B 隧道不可达',
    detail: `127.0.0.1:8080 探活失败，已悬挂 task_queue 队头消费（不重试、不转抛 Gemini）。\n${detail}`,
    evidence: getAiTunnelStatus(),
    suggestion: '检查本机 LM Studio 与 ssh -R 隧道；恢复后自动续消费',
    key: 'ai_tunnel',
  });
}

async function transitionToClosed(detail) {
  if (state === 'closed') return;
  const prev = state;
  state = 'closed';
  console.log(`[AiTunnelCircuit] CLOSED — resume queue consumption. ${detail}`);
  if (prev === 'open' || prev === 'half-open') {
    await sendAlert({
      subsystem: 'ai_tunnel',
      level: 'ok',
      title: '本地 14B 隧道',
      detail: `隧道已恢复，队列消费恢复。${detail}`,
      evidence: getAiTunnelStatus(),
      key: 'ai_tunnel',
    });
  }
}

export async function runAiTunnelProbeOnce() {
  if (!enabled()) {
    return { skipped: true, status: getAiTunnelStatus() };
  }

  const base = process.env.LM_STUDIO_BASE_URL || LOCAL_LM_DEFAULT_BASE;
  const { host, port } = parseBase(base);
  const result = await probeLocalLmPort(host, port, Number(process.env.AI_TUNNEL_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  lastProbe = {
    reachable: result.ok,
    at: new Date().toISOString(),
    detail: result.detail,
    host,
    port,
  };

  if (result.ok) {
    failStreak = 0;
    successStreak += 1;
    if (state === 'open') {
      state = 'half-open';
    }
    if (state === 'half-open' && successStreak >= RECOVERY_THRESHOLD) {
      await transitionToClosed(result.detail);
    } else if (state === 'closed') {
      successStreak = RECOVERY_THRESHOLD;
    }
  } else {
    successStreak = 0;
    failStreak += 1;
    if (failStreak >= FAIL_THRESHOLD) {
      await transitionToOpen(`${host}:${port} ${result.detail}`);
    }
  }

  return { ok: result.ok, status: getAiTunnelStatus() };
}

/** Called when a live request hits ECONNREFUSED — trip faster. */
export async function notifyAiTunnelFailure(errOrText) {
  if (!enabled()) return;
  const msg = String(errOrText?.message || errOrText || '');
  if (!/ECONNREFUSED|ETIMEDOUT|socket hang up|fetch failed/i.test(msg)) return;
  failStreak = Math.max(failStreak + 1, FAIL_THRESHOLD);
  successStreak = 0;
  lastProbe = {
    ...lastProbe,
    reachable: false,
    at: new Date().toISOString(),
    detail: `live-fail:${msg.slice(0, 120)}`,
  };
  await transitionToOpen(lastProbe.detail);
}

export function startAiTunnelCircuit({
  intervalMs = Number(process.env.AI_TUNNEL_PROBE_MS || DEFAULT_PROBE_MS),
} = {}) {
  if (started) return { already: true };
  started = true;

  registerAiTunnelHealthGetter(() => getAiTunnelStatus());

  if (!enabled()) {
    console.log('[AiTunnelCircuit] disabled (AI_TUNNEL_CIRCUIT=0)');
    return { started: true, enabled: false };
  }

  const tick = () => {
    runAiTunnelProbeOnce().catch((e) => console.warn('[AiTunnelCircuit] probe error:', e.message));
  };
  tick();
  probeTimer = setInterval(tick, intervalMs);
  if (typeof probeTimer.unref === 'function') probeTimer.unref();

  console.log(`[AiTunnelCircuit] started (probe every ${intervalMs}ms; suspend queue when open)`);
  return { started: true, enabled: true };
}
