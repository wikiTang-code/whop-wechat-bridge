/**
 * P0-3: Event-loop delay probe via perf_hooks.monitorEventLoopDelay.
 * Side-path only — read metrics; soft-degrade alerts; never process-restart (R5/R6).
 */
import { monitorEventLoopDelay } from 'perf_hooks';
import { sendAlert, formatBeijingTime } from './alert-sink.js';
import { updateBackpressureMetrics } from './backpressure-controller.js';

const WARN_NS = 1e9;      // 1s
const CRITICAL_NS = 5e9;  // 5s
const SAMPLE_MS = 10_000;

let histogram = null;
let started = false;
let lastLevel = 'ok';
let lastSnapshot = {
  enabled: false,
  meanMs: 0,
  maxMs: 0,
  p99Ms: 0,
  level: 'ok',
  checkedAt: null,
};

function nsToMs(ns) {
  return Math.round((Number(ns) / 1e6) * 100) / 100;
}

export function getEventLoopSnapshot() {
  return { ...lastSnapshot };
}

export function classifyEventLoopLevel(p99Ns, maxNs, warnNs, criticalNs) {
  // 1. 真实系统大面积挂起：99% 的 tick 全部超标
  if (p99Ns >= criticalNs) return 'critical';
  // 2. 持续性显著延迟且伴随极端毛刺
  if (p99Ns >= warnNs && maxNs >= criticalNs) return 'critical';
  // 3. 轻度延迟或单点毛刺（如 p99 仍正常但仅单次 GC 产生瞬时 max）
  if (p99Ns >= warnNs || maxNs >= warnNs) return 'warn';
  return 'ok';
}

export function startEventLoopProbe({
  warnMs = 1000,
  criticalMs = 5000,
  intervalMs = SAMPLE_MS,
  enableAlerts = true,
} = {}) {
  if (started) return { already: true };
  started = true;

  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const warnNs = warnMs * 1e6;
  const criticalNs = criticalMs * 1e6;

  const tick = async () => {
    try {
      const mean = histogram.mean;
      const max = histogram.max;
      const p99 = histogram.percentile(99);
      histogram.reset();

      const level = classifyEventLoopLevel(p99, max, warnNs, criticalNs);

      lastSnapshot = {
        enabled: true,
        meanMs: nsToMs(mean),
        maxMs: nsToMs(max),
        p99Ms: nsToMs(p99),
        level,
        thresholds: { warnMs, criticalMs },
        checkedAt: formatBeijingTime(),
      };

      // Feed metrics into backpressure controller
      updateBackpressureMetrics({
        p99Ms: lastSnapshot.p99Ms,
        httpOk: level !== 'critical',
      });

      if (!enableAlerts) {
        lastLevel = level;
        return;
      }

      if (level === 'critical' && lastLevel !== 'critical') {
        await sendAlert({
          subsystem: 'event_loop',
          level: 'critical',
          title: '事件循环严重延迟',
          detail: `p99=${lastSnapshot.p99Ms}ms max=${lastSnapshot.maxMs}ms (阈值 critical>${criticalMs}ms)`,
          evidence: lastSnapshot,
          suggestion: '检查主线程同步阻塞（大查询/同步 IO）；勿自动 pm2 restart',
        });
      } else if (level === 'warn' && lastLevel === 'ok') {
        await sendAlert({
          subsystem: 'event_loop',
          level: 'warn',
          title: '事件循环延迟升高',
          detail: `p99=${lastSnapshot.p99Ms}ms max=${lastSnapshot.maxMs}ms (阈值 warn>${warnMs}ms)`,
          evidence: lastSnapshot,
        });
      } else if (level === 'ok' && lastLevel !== 'ok') {
        await sendAlert({
          subsystem: 'event_loop',
          level: 'ok',
          title: '事件循环延迟',
          detail: `已恢复 p99=${lastSnapshot.p99Ms}ms max=${lastSnapshot.maxMs}ms`,
          evidence: lastSnapshot,
        });
      }
      lastLevel = level;
    } catch (err) {
      console.warn('[EventLoopProbe] tick error:', err.message);
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Prime one sample window before first alert evaluation
  setTimeout(tick, Math.min(intervalMs, 3000)).unref?.();

  console.log(`[EventLoopProbe] started (warn>${warnMs}ms critical>${criticalMs}ms every ${intervalMs}ms)`);
  return { started: true };
}

// Exported for tests / docs
export const EVENT_LOOP_DEFAULTS = {
  warnNs: WARN_NS,
  criticalNs: CRITICAL_NS,
  sampleMs: SAMPLE_MS,
};
