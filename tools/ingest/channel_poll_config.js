/**
 * CHG-061 — channel poll tiers from config/channel_registry.json.
 * HOT 2s / WARM 5s / COLD 30s (off-hours HOT+WARM 60s, COLD 120s).
 * 不用翻墙美股发布 is a realtime signal → WARM 5s (not HOT 2s).
 * 日内波段信号检测 → WARM 5s.
 */
import fs from 'fs';
import path from 'path';

export const TIER_INTERVAL_MS = {
  hot: { trading: 2_000, idle: 60_000 },
  warm: { trading: 5_000, idle: 60_000 },
  cold: { trading: 30_000, idle: 120_000 }
};

export const TIER_DEFAULT_LIMIT = { hot: 5, warm: 10, cold: 20 };

let cachedRegistry = null;

export function loadChannelRegistry(registryPath = null) {
  const p = registryPath || path.join(process.cwd(), 'config', 'channel_registry.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
  cachedRegistry = raw;
  return raw;
}

export function getChannelRegistry() {
  return cachedRegistry || loadChannelRegistry();
}

export function channelsForTier(tier, registry = getChannelRegistry()) {
  const t = String(tier || '').toLowerCase();
  return Object.entries(registry)
    .filter(([, info]) => String(info?.poll_tier || 'cold').toLowerCase() === t)
    .map(([id, info]) => ({
      id,
      name: info?.name || id,
      poll_limit: Number(info?.poll_limit) || TIER_DEFAULT_LIMIT[t] || 20
    }));
}

export function intersectEnvChannels(tierChannels, envIds) {
  const allow = new Set((envIds || []).filter(Boolean));
  if (allow.size === 0) return tierChannels;
  return tierChannels.filter((ch) => allow.has(ch.id));
}

export function getPollIntervalMs(tier, { isTrading = true, throttleCold = false, coldThrottleMs = null } = {}) {
  const t = String(tier || 'cold').toLowerCase();
  const spec = TIER_INTERVAL_MS[t] || TIER_INTERVAL_MS.cold;
  if (!isTrading) return spec.idle;
  if (t === 'cold' && throttleCold && Number(coldThrottleMs) > 0) {
    return Math.max(spec.trading, Number(coldThrottleMs));
  }
  return spec.trading;
}

export function shouldSkipUnchangedFeed(cachedLastId, newestRemoteId) {
  if (!cachedLastId || !newestRemoteId) return false;
  return String(cachedLastId) === String(newestRemoteId);
}

const lastSeenRemoteId = new Map();

export function getLastSeenRemoteId(channelId) {
  return lastSeenRemoteId.get(channelId) || null;
}

export function setLastSeenRemoteId(channelId, messageId) {
  if (channelId && messageId) lastSeenRemoteId.set(channelId, messageId);
  return messageId;
}

export function _resetLastSeenForTests() {
  lastSeenRemoteId.clear();
  cachedRegistry = null;
}
