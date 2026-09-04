/**
 * Lightweight slow operation tracker with ring buffer (20 entries).
 * Tracks critical synchronous / heavy async operations (saveMessages, FTS, regex).
 * Side-path only — zero DB I/O, zero V8 profiler overhead.
 */

const RING_MAX = 20;
const SLOW_THRESHOLD_MS = 300;

/** @type {Array<{ fn: string, batchSize: number, durationMs: number, at: number, timeStr: string }>} */
const slowOpsRing = [];

function formatBeijingTime(date = new Date()) {
  return new Date(date).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' (北京时间)';
}

/**
 * Record a slow operation directly into the ring buffer.
 */
export function recordSlowOp({ fn, batchSize = 0, durationMs }) {
  const roundedDuration = Math.round(durationMs * 100) / 100;
  const entry = {
    fn,
    batchSize: Number(batchSize) || 0,
    durationMs: roundedDuration,
    at: Date.now(),
    timeStr: formatBeijingTime(),
  };
  slowOpsRing.push(entry);
  if (slowOpsRing.length > RING_MAX) {
    slowOpsRing.shift();
  }
  return entry;
}

/**
 * Track an async or sync operation and record if it exceeds threshold.
 *
 * @param {string} fnName
 * @param {number} batchSize
 * @param {Function} fn
 * @param {number} [thresholdMs]
 */
export function trackSlowOp(fnName, batchSize, fn, thresholdMs = SLOW_THRESHOLD_MS) {
  const t0 = performance.now();
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        (val) => {
          const durationMs = performance.now() - t0;
          if (durationMs >= thresholdMs) {
            recordSlowOp({ fn: fnName, batchSize, durationMs });
          }
          return val;
        },
        (err) => {
          const durationMs = performance.now() - t0;
          if (durationMs >= thresholdMs) {
            recordSlowOp({ fn: fnName, batchSize, durationMs });
          }
          throw err;
        }
      );
    }
    const durationMs = performance.now() - t0;
    if (durationMs >= thresholdMs) {
      recordSlowOp({ fn: fnName, batchSize, durationMs });
    }
    return result;
  } catch (err) {
    const durationMs = performance.now() - t0;
    if (durationMs >= thresholdMs) {
      recordSlowOp({ fn: fnName, batchSize, durationMs });
    }
    throw err;
  }
}

/**
 * Get recent slow operations formatted for alert evidence.
 * @param {number} limit
 */
export function getRecentSlowOps(limit = 3) {
  return slowOpsRing.slice(-limit).reverse();
}

/**
 * Get full slow ops ring snapshot.
 */
export function getSlowOpsRing() {
  return slowOpsRing.slice();
}

export function _resetSlowOpsForTests() {
  slowOpsRing.length = 0;
}
