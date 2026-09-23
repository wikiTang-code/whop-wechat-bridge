/**
 * CHG-061 live loops. Production ingest is scripts/ingest_runner.js, not server.js.
 * HOT 2s / WARM 5s / COLD 30s. Backpressure stretches COLD only.
 * Housekeeping (news/persona) runs on the COLD tick, never on HOT.
 */
import { getEffectivePollIntervalSec, getBackpressureStatus } from '../../monitoring/backpressure-controller.js';
import {
  loadChannelRegistry,
  channelsForTier,
  intersectEnvChannels,
  getPollIntervalMs
} from './channel_poll_config.js';

const pollerState = {
  hot: { timeout: null, syncing: false },
  warm: { timeout: null, syncing: false },
  cold: { timeout: null, syncing: false }
};
const bootTimers = [];
let stopped = true;
let hooks = {};

export function isWideSessionHours(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    weekday: 'short',
    hour: 'numeric'
  });
  const parts = {};
  for (const p of formatter.formatToParts(now)) parts[p.type] = p.value;
  const weekday = parts.weekday;
  const hour = (parseInt(parts.hour, 10) || 0) % 24;
  if (weekday === 'Sun') return false;
  if (weekday === 'Sat') return hour < 8;
  if (weekday === 'Mon') return hour >= 16;
  return true;
}

function envChannelIds() {
  const channelIdsStr = process.env.WHOP_CHAT_CHANNEL_IDS || process.env.WHOP_CHAT_CHANNEL_ID || '';
  return channelIdsStr.split(',').map((s) => s.trim()).filter(Boolean);
}

export function channelsForLiveTier(tier) {
  try {
    loadChannelRegistry();
  } catch (err) {
    console.error('[CHG-061] load channel_registry failed:', err.message);
    return [];
  }
  return intersectEnvChannels(channelsForTier(tier), envChannelIds());
}

export function describeLiveTiers(now = new Date()) {
  const isTrading = isWideSessionHours(now);
  const bp = getBackpressureStatus();
  return ['hot', 'warm', 'cold'].map((tier) => {
    const throttleCold = tier === 'cold' && bp.tier !== 'NORMAL';
    const group = channelsForLiveTier(tier);
    return {
      tier,
      names: group.map((c) => c.name),
      ids: group.map((c) => c.id),
      limit: group[0]?.poll_limit || (tier === 'hot' ? 5 : tier === 'warm' ? 10 : 20),
      intervalMs: getPollIntervalMs(tier, {
        isTrading,
        throttleCold,
        coldThrottleMs: throttleCold ? getEffectivePollIntervalSec() * 1000 : null
      })
    };
  });
}

function clearTimers() {
  for (const tier of Object.keys(pollerState)) {
    if (pollerState[tier].timeout) {
      clearTimeout(pollerState[tier].timeout);
      pollerState[tier].timeout = null;
    }
  }
  while (bootTimers.length) clearTimeout(bootTimers.pop());
}

export function stopTierPollers() {
  stopped = true;
  clearTimers();
}

async function defaultSyncGroup(group, limit) {
  const { syncChannelGroup } = await import('../../monitor.js');
  return syncChannelGroup(group, { limit, skipReport: true });
}

async function runTierPoller(tier, { runHousekeeping = false } = {}) {
  if (stopped) return;
  const state = pollerState[tier];
  const scheduleNext = () => {
    if (stopped) return;
    const row = describeLiveTiers().find((r) => r.tier === tier);
    state.timeout = setTimeout(() => runTierPoller(tier, { runHousekeeping }), row?.intervalMs || 30_000);
  };

  if (state.syncing) {
    scheduleNext();
    return;
  }

  state.syncing = true;
  const started = Date.now();
  let result = null;
  let error = null;
  try {
    const group = channelsForLiveTier(tier);
    if (group.length > 0) {
      const limit = group[0].poll_limit || (tier === 'hot' ? 5 : tier === 'warm' ? 10 : 20);
      const syncGroup = hooks.syncGroup || defaultSyncGroup;
      result = await syncGroup(group, limit);
      if (result && result.success) {
        const { setLastSyncTime } = await import('../../database.js');
        setLastSyncTime(Date.now());
      }
      const n = result?.newMessagesCount || 0;
      if (n > 0) {
        const row = describeLiveTiers().find((r) => r.tier === tier);
        console.log(`[CHG-061 ${tier}] +${n} new · next ${row?.intervalMs}ms`);
      }
    }
    if (runHousekeeping && typeof hooks.runHousekeeping === 'function') {
      await hooks.runHousekeeping();
    }
  } catch (err) {
    error = err;
    console.error(`[CHG-061 ${tier}] poll failed:`, err.message);
  } finally {
    state.syncing = false;
    if (typeof hooks.onTick === 'function') {
      try {
        await hooks.onTick({ tier, result, error, pollMs: Date.now() - started });
      } catch (hookErr) {
        console.error('[CHG-061] onTick failed:', hookErr.message);
      }
    }
  }
  scheduleNext();
}

export function startTierPollers(nextHooks = {}) {
  stopTierPollers();
  stopped = false;
  hooks = nextHooks;
  const plan = describeLiveTiers();
  for (const row of plan) {
    console.log(`[CHG-061 ${row.tier}] ${row.names.join(', ') || '(none)'} · ${row.intervalMs}ms · limit ${row.limit}`);
  }
  console.log('Starting CHG-061 HOT/WARM/COLD pollers. HOT fires immediately. Housekeeping is COLD-only.');
  runTierPoller('hot', { runHousekeeping: false });
  bootTimers.push(setTimeout(() => runTierPoller('warm', { runHousekeeping: false }), 2000));
  bootTimers.push(setTimeout(() => runTierPoller('cold', { runHousekeeping: true }), 4000));
  return plan;
}
