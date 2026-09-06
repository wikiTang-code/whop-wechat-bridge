/**
 * @file monitoring/route-coverage-probe.js
 * @description P2-12c: 关键页 API 路由覆盖探针（防双进程「壳绿 API 死」）
 *
 * - 只打本机 baseUrl（默认 127.0.0.1），不走 Tunnel
 * - TTL 缓存，避免 /health 每次打爆自己
 * - 不写库；不触发 pm2；失败仅反映在 snapshot.status
 */

export const DEFAULT_ROUTE_COVERAGE_PATHS = [
  '/api/messages?limit=1',
  '/api/monitoring/dashboard',
  '/api/l2a/dates',
  '/api/l2b/drycut20',
  '/api/review/queue?date=2026-06-26',
  '/api/pipeline/queue-status',
  '/review_workbench.html',
  '/monitoring',
];

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 2_500;

let cachedSnapshot = null;
let cacheExpiresAtMs = 0;
let refreshInFlight = null;

function classifyMountFailure(httpStatus, bodyText) {
  const text = String(bodyText || '');
  if (text.includes('Cannot GET') || text.includes('Cannot HEAD')) return true;
  // Express default 404 HTML / plain
  if (httpStatus === 404 && /<!DOCTYPE html>|Cannot GET/i.test(text)) return true;
  if (httpStatus === 404) return true;
  return false;
}

/**
 * Pure-ish evaluator for tests (inject fetchImpl).
 * @returns {Promise<object>}
 */
export async function probeRouteCoverage({
  baseUrl = 'http://127.0.0.1:8085',
  paths = DEFAULT_ROUTE_COVERAGE_PATHS,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  nowMs = Date.now(),
} = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const results = [];

  for (const path of paths) {
    const url = `${root}${path.startsWith('/') ? path : `/${path}`}`;
    const started = Date.now();
    let httpStatus = 0;
    let bodyText = '';
    let error = null;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      const res = await fetchImpl(url, {
        method: 'GET',
        signal: ctrl?.signal,
        headers: { Accept: 'application/json,text/html,*/*' },
      });
      if (timer) clearTimeout(timer);
      httpStatus = res.status;
      bodyText = await res.text().catch(() => '');
    } catch (err) {
      error = err?.message || String(err);
    }
    const ms = Date.now() - started;
    const unmounted = !error && classifyMountFailure(httpStatus, bodyText);
    const unreachable = Boolean(error);
    const ok = !unreachable && !unmounted && httpStatus > 0 && httpStatus < 500;
    results.push({
      path,
      httpStatus: httpStatus || null,
      ok,
      ms,
      unmounted,
      unreachable,
      error,
    });
  }

  const failCount = results.filter((r) => !r.ok).length;
  let status = 'ok';
  if (failCount >= 2) status = 'critical';
  else if (failCount === 1) status = 'warn';
  if (results.every((r) => r.unreachable)) status = 'critical';

  const failedPaths = results.filter((r) => !r.ok).map((r) => r.path);
  let description = '关键页 API 路由覆盖正常';
  if (status === 'warn') {
    description = `1 条关键路径异常: ${failedPaths.join(', ')}（疑似漏挂/页壳假绿）`;
  } else if (status === 'critical') {
    description = `${failCount} 条关键路径异常: ${failedPaths.join(', ')}（疑似漏挂/页壳假绿）`;
  }

  return {
    status,
    checkedAtMs: nowMs,
    baseUrl: root,
    failCount,
    paths: results,
    description,
  };
}

export function getCachedRouteCoverageSnapshot() {
  return cachedSnapshot;
}

export function setCachedRouteCoverageSnapshot(snapshot, { ttlMs = DEFAULT_TTL_MS, nowMs = Date.now() } = {}) {
  cachedSnapshot = snapshot;
  cacheExpiresAtMs = nowMs + ttlMs;
  return cachedSnapshot;
}

/**
 * Return cache if fresh; otherwise kick async refresh and return stale/unknown.
 * Safe to call from sync buildHealthPayload.
 */
export function getRouteCoverageSnapshot({ nowMs = Date.now() } = {}) {
  if (cachedSnapshot && nowMs < cacheExpiresAtMs) {
    return cachedSnapshot;
  }
  // Stale-while-revalidate: keep last, trigger background refresh elsewhere
  if (cachedSnapshot) {
    return { ...cachedSnapshot, stale: true };
  }
  return {
    status: 'unknown',
    checkedAtMs: nowMs,
    baseUrl: null,
    failCount: 0,
    paths: [],
    description: 'routeCoverage 尚未完成首次探测',
  };
}

/**
 * Refresh cache (deduped). Call from web_runner /health or interval.
 */
export async function refreshRouteCoverageSnapshot(options = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const snap = await probeRouteCoverage(options);
      setCachedRouteCoverageSnapshot(snap, {
        ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
        nowMs: options.nowMs ?? Date.now(),
      });
      return snap;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
