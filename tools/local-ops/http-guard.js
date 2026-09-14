/**
 * REQ-034 — localhost ops HTTP gate (CSRF / Origin / DNS rebinding).
 * WeCom callback path stays outside this gate (has its own crypto auth).
 */
import crypto from 'crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackRemote(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

export function parseHostHeader(hostHeader) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0) return null;
    const host = raw.slice(0, end + 1);
    const rest = raw.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : null;
    if (rest && !rest.startsWith(':')) return null;
    if (port != null && !Number.isFinite(port)) return null;
    return { host, port };
  }
  const idx = raw.lastIndexOf(':');
  if (idx > 0 && raw.indexOf(':') === idx) {
    const host = raw.slice(0, idx);
    const port = Number(raw.slice(idx + 1));
    if (!Number.isFinite(port)) return null;
    return { host, port };
  }
  return { host: raw, port: null };
}

export function isLoopbackHostHeader(hostHeader, listenPort) {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed || !LOOPBACK_HOSTS.has(parsed.host)) return false;
  if (parsed.port != null && listenPort != null && Number(parsed.port) !== Number(listenPort)) {
    return false;
  }
  return true;
}

export function isLoopbackOrigin(origin, listenPort) {
  const raw = String(origin || '').trim();
  if (!raw || raw === 'null') return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  const normalized = host === '[::1]' ? '[::1]' : host;
  if (!LOOPBACK_HOSTS.has(normalized) && host !== '::1') return false;
  if (listenPort != null && u.port) {
    if (Number(u.port) !== Number(listenPort)) return false;
  } else if (listenPort != null && !u.port) {
    // default http 80 / https 443 — ops listens on 18789, reject implicit defaults
    return false;
  }
  return true;
}

export function hasLocalOpsHeader(req) {
  const v = req.headers?.['x-local-ops'];
  return String(v || '') === '1';
}

/**
 * Gate for /ui and /api/ops/* (not /wecom/*).
 * Allows: loopback Origin/Referer, OR X-Local-Ops:1 without foreign Origin.
 */
export function checkLocalOpsHttpGate(req, { listenPort, csrfToken = null, requireCsrf = false } = {}) {
  if (!isLoopbackRemote(req.socket?.remoteAddress)) {
    return { ok: false, code: 'localhost_only', status: 403 };
  }
  if (!isLoopbackHostHeader(req.headers?.host, listenPort)) {
    return { ok: false, code: 'bad_host', status: 403 };
  }

  const origin = req.headers?.origin;
  const referer = req.headers?.referer;
  const localHeader = hasLocalOpsHeader(req);

  if (origin) {
    if (!isLoopbackOrigin(origin, listenPort)) {
      return { ok: false, code: 'bad_origin', status: 403 };
    }
  } else if (referer) {
    if (!isLoopbackOrigin(referer, listenPort)) {
      return { ok: false, code: 'bad_referer', status: 403 };
    }
  } else if (!localHeader) {
    return { ok: false, code: 'csrf_origin_required', status: 403 };
  }

  // Foreign Origin must never be rescued by X-Local-Ops
  if (origin && !isLoopbackOrigin(origin, listenPort)) {
    return { ok: false, code: 'bad_origin', status: 403 };
  }

  if (requireCsrf && csrfToken) {
    const sent = String(req.headers?.['x-csrf-token'] || '').trim();
    if (!sent || sent !== csrfToken) {
      return { ok: false, code: 'bad_csrf', status: 403 };
    }
  }

  return { ok: true };
}

export function mintCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}
