/**
 * P0-3: Simple 3-tier stepped backpressure controller.
 * Feeds on event-loop p99 and health probe metrics.
 * Protects HTTP dashboard and prevents queue avalanche without auto pm2 restart (R2).
 */

const BASE_POLL_INTERVAL_SEC = 25;
const THROTTLE_L1_INTERVAL_SEC = 60;
const THROTTLE_L2_INTERVAL_SEC = 120;

let currentTier = 'NORMAL'; // 'NORMAL' | 'THROTTLED_L1' | 'THROTTLED_L2'
let highStreak = 0;       // count of consecutive p99 > 1s
let criticalStreak = 0;   // count of consecutive p99 > 5s or HTTP down
let healthyStreak = 0;    // count of consecutive p99 < 50ms

/**
 * Update backpressure state with latest snapshot from event-loop or health check.
 *
 * @param {object} params
 * @param {number} params.p99Ms - Event loop p99 delay in ms
 * @param {boolean} [params.httpOk=true] - Whether HTTP /health probe succeeded
 */
export function updateBackpressureMetrics({ p99Ms, httpOk = true }) {
  const p99 = Number(p99Ms) || 0;

  if (!httpOk || p99 >= 5000) {
    criticalStreak++;
    highStreak++;
    healthyStreak = 0;
  } else if (p99 >= 1000) {
    highStreak++;
    criticalStreak = 0;
    healthyStreak = 0;
  } else if (p99 <= 50 && httpOk) {
    healthyStreak++;
    highStreak = 0;
    criticalStreak = 0;
  } else {
    // intermediate range (50ms - 1000ms)
    highStreak = 0;
    criticalStreak = 0;
    healthyStreak = 0;
  }

  // Tier transitions
  if (criticalStreak >= 1) {
    currentTier = 'THROTTLED_L2';
  } else if (highStreak >= 2) {
    currentTier = 'THROTTLED_L1';
  } else if (healthyStreak >= 3) {
    // Stepped recovery: L2 -> L1 -> NORMAL
    if (currentTier === 'THROTTLED_L2') {
      currentTier = 'THROTTLED_L1';
      healthyStreak = 0; // reset to require another 3 healthy ticks to return to NORMAL
    } else if (currentTier === 'THROTTLED_L1') {
      currentTier = 'NORMAL';
      healthyStreak = 0;
    }
  }

  return getBackpressureStatus();
}

/**
 * Returns effective polling interval in seconds.
 */
export function getEffectivePollIntervalSec() {
  switch (currentTier) {
    case 'THROTTLED_L2':
      return THROTTLE_L2_INTERVAL_SEC;
    case 'THROTTLED_L1':
      return THROTTLE_L1_INTERVAL_SEC;
    default:
      return BASE_POLL_INTERVAL_SEC;
  }
}

/**
 * Whether background secondary workers (media download, offline windowing) should be paused.
 */
export function shouldPauseSecondaryWorkers() {
  return currentTier === 'THROTTLED_L1' || currentTier === 'THROTTLED_L2';
}

/**
 * Current backpressure state snapshot for diagnostics.
 */
export function getBackpressureStatus() {
  return {
    tier: currentTier,
    pollIntervalSec: getEffectivePollIntervalSec(),
    pauseSecondaryWorkers: shouldPauseSecondaryWorkers(),
    highStreak,
    criticalStreak,
    healthyStreak,
  };
}

export function _resetBackpressureForTests() {
  currentTier = 'NORMAL';
  highStreak = 0;
  criticalStreak = 0;
  healthyStreak = 0;
}
