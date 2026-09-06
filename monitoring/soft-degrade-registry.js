/**
 * P2-15: Soft-degrade action registry (R2/R5).
 * In-memory whitelist of active soft-degrade actions for /health observability.
 * Never invokes pm2 restart/stop or destructive DB ops.
 *
 * 15D mounts getSoftDegradeSnapshot(); 15C wires record/clear from controllers.
 */
import { getBackpressureStatus } from './backpressure-controller.js';

export const ALLOWED_ACTIONS = Object.freeze([
  'backpressure_throttle_poll',
  'backpressure_pause_secondary',
  'ai_tunnel_suspend_probe',
  'offline_sync_spawn_weekend',
  'log_tmp_cleanup',
]);

export const FORBIDDEN_ACTIONS = Object.freeze([
  'pm2_restart',
  'pm2_stop',
  'process_kill',
  'db_destructive',
]);

const ACTIVE_ACTIONS_CAP = 8;
const NOTES = 'safe_soft_degrade_only, zero_pm2_restart, process_local';

/** @type {Map<string, { id: string, level: string, sinceMs: number, reason: string, detail?: string }>} */
const activeActionsMap = new Map();

/** @type {Array<() => Array<object>>} */
const extraGetters = [];

/** Optional: 15C / process boot registers AI circuit / offline heal mirrors (avoid import cycles). */
export function registerSoftDegradeExtraActionsGetter(fn) {
  if (typeof fn === 'function') extraGetters.push(fn);
}

/**
 * @param {{ id: string, reason?: string, detail?: string, level?: string, nowMs?: number }} action
 * @returns {{ ok: boolean, error?: string }}
 */
export function recordSoftDegradeAction(action = {}) {
  const id = action.id;
  if (!id || typeof id !== 'string') {
    return { ok: false, error: 'missing_id' };
  }
  if (FORBIDDEN_ACTIONS.includes(id)) {
    return { ok: false, error: 'forbidden_action' };
  }
  if (!ALLOWED_ACTIONS.includes(id)) {
    return { ok: false, error: 'not_in_allowlist' };
  }
  const nowMs = Number.isFinite(action.nowMs) ? action.nowMs : Date.now();
  const prev = activeActionsMap.get(id);
  activeActionsMap.set(id, {
    id,
    level: action.level === 'critical' ? 'warn' : (action.level || 'warn'),
    sinceMs: prev?.sinceMs ?? nowMs,
    reason: action.reason || 'unspecified',
    detail: action.detail || '',
  });
  return { ok: true };
}

export function clearSoftDegradeAction(id) {
  if (!id) return { ok: false, error: 'missing_id' };
  activeActionsMap.delete(id);
  return { ok: true };
}

function deriveFromBackpressure(nowMs, seenIds) {
  const out = [];
  let bp;
  try {
    bp = getBackpressureStatus();
  } catch {
    return out;
  }
  if (!bp) return out;

  if (bp.tier && bp.tier !== 'NORMAL' && !seenIds.has('backpressure_throttle_poll')) {
    out.push({
      id: 'backpressure_throttle_poll',
      level: 'warn',
      sinceMs: nowMs,
      reason: `backpressure_${bp.tier}`,
      detail: `Ingest poll throttled (tier=${bp.tier}, intervalSec=${bp.pollIntervalSec})`,
    });
  }
  if (bp.pauseSecondaryWorkers && !seenIds.has('backpressure_pause_secondary')) {
    out.push({
      id: 'backpressure_pause_secondary',
      level: 'warn',
      sinceMs: nowMs,
      reason: `backpressure_${bp.tier || 'THROTTLED'}`,
      detail: 'Secondary workers paused due to backpressure',
    });
  }
  return out;
}

/**
 * Sync snapshot for buildHealthPayload (no async).
 * Iron rule: activeActions non-empty ⇒ status at least warn (no false green).
 */
export function getSoftDegradeSnapshot({ nowMs = Date.now() } = {}) {
  const merged = [];
  const seen = new Set();

  for (const action of activeActionsMap.values()) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    merged.push({ ...action });
  }

  for (const derived of deriveFromBackpressure(nowMs, seen)) {
    seen.add(derived.id);
    merged.push(derived);
  }

  for (const getter of extraGetters) {
    let extras = [];
    try {
      extras = getter() || [];
    } catch {
      extras = [];
    }
    for (const action of extras) {
      if (!action?.id || seen.has(action.id)) continue;
      if (!ALLOWED_ACTIONS.includes(action.id)) continue;
      seen.add(action.id);
      merged.push({
        id: action.id,
        level: 'warn',
        sinceMs: action.sinceMs ?? nowMs,
        reason: action.reason || 'extra_source',
        detail: action.detail || '',
      });
    }
  }

  const activeActions = merged.slice(0, ACTIVE_ACTIONS_CAP);
  const status = activeActions.length > 0 ? 'warn' : 'ok';
  const description = activeActions.length === 0
    ? 'System operating normally with no soft-degrade actions active'
    : `${activeActions.length} soft-degrade action(s) active: ${activeActions.map((a) => a.id).join(', ')}`;

  return {
    status,
    checkedAtMs: nowMs,
    activeActions,
    allowedActions: [...ALLOWED_ACTIONS],
    forbidden: [...FORBIDDEN_ACTIONS],
    description,
    notes: NOTES,
  };
}

export function _resetSoftDegradeForTests() {
  activeActionsMap.clear();
  extraGetters.length = 0;
}
