/**
 * @file monitoring/dashboard-basic-auth.js
 * @description 看板 Basic Auth 中间件（从 server.js 抽出，供 web_runner 与单体共用）
 *
 * 行为对齐现网：
 * - 依赖 DASHBOARD_USERNAME / DASHBOARD_PASSWORD；未配置则放行（本地开发）
 * - /health 等白名单免鉴权（看门狗）
 * - timing-safe 比较；失败 401 + WWW-Authenticate
 */

const authAttempts = new Map();
const AUTH_RATE_LIMIT = 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

function checkAuthRateLimit(ip) {
  if (
    !ip ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.')
  ) {
    return true;
  }
  const now = Date.now();
  const record = authAttempts.get(ip);
  if (!record || now - record.windowStart > AUTH_WINDOW_MS) {
    authAttempts.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= AUTH_RATE_LIMIT;
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function isDashboardAuthBypassPath(pathname) {
  return (
    pathname === '/webhook' ||
    pathname === '/health' ||
    pathname.startsWith('/media/zhao') ||
    pathname === '/review_workbench.html' ||
    pathname.startsWith('/api/l2') ||
    pathname === '/ticker_timeline.html' ||
    pathname.startsWith('/api/ticker_timeline') ||
    pathname.startsWith('/api/ticker_kline')
  );
}

/**
 * Express middleware: Basic Auth for dashboard surfaces.
 */
export function dashboardBasicAuthMiddleware(req, res, next) {
  if (isDashboardAuthBypassPath(req.path)) {
    return next();
  }

  const authUser = process.env.DASHBOARD_USERNAME;
  const authPass = process.env.DASHBOARD_PASSWORD;

  if (!authUser || !authPass) {
    return next();
  }

  const clientIp = req.ip || req.connection?.remoteAddress || '';

  if (!checkAuthRateLimit(clientIp)) {
    console.warn(`[Auth] Rate limit exceeded for IP: ${clientIp}`);
    return res.status(429).send('Too many authentication attempts. Please try again later.');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Dashboard"');
    return res.status(401).send('Authentication required.');
  }

  try {
    const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) throw new Error('Invalid auth format');

    const user = decoded.substring(0, colonIndex);
    const pass = decoded.substring(colonIndex + 1);

    if (safeCompare(user, authUser) && safeCompare(pass, authPass)) {
      authAttempts.delete(clientIp);
      return next();
    }
  } catch (_) {
    // fall through to 401
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Dashboard"');
  return res.status(401).send('Invalid credentials.');
}
