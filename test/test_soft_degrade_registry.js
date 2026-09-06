/**
 * P2-15D / registry unit tests for soft-degrade snapshot contract.
 */
import assert from 'assert';
import {
  ALLOWED_ACTIONS,
  FORBIDDEN_ACTIONS,
  recordSoftDegradeAction,
  clearSoftDegradeAction,
  getSoftDegradeSnapshot,
  _resetSoftDegradeForTests,
} from '../monitoring/soft-degrade-registry.js';
import { buildHealthPayload, setSoftDegradeHealthEnabled } from '../monitoring/health.js';
import {
  updateBackpressureMetrics,
  _resetBackpressureForTests,
} from '../monitoring/backpressure-controller.js';

console.log('--- test_soft_degrade_registry ---');

_resetSoftDegradeForTests();
_resetBackpressureForTests();

const empty = getSoftDegradeSnapshot({ nowMs: 1 });
assert.strictEqual(empty.status, 'ok');
assert.strictEqual(empty.activeActions.length, 0);
assert.deepStrictEqual(empty.allowedActions, [...ALLOWED_ACTIONS]);
assert.deepStrictEqual(empty.forbidden, [...FORBIDDEN_ACTIONS]);
assert.ok(String(empty.notes).includes('zero_pm2_restart'));

const bad = recordSoftDegradeAction({ id: 'pm2_restart', reason: 'nope' });
assert.strictEqual(bad.ok, false);
assert.strictEqual(bad.error, 'forbidden_action');

const unknown = recordSoftDegradeAction({ id: 'not_a_real_action' });
assert.strictEqual(unknown.ok, false);

const okRec = recordSoftDegradeAction({
  id: 'ai_tunnel_suspend_probe',
  reason: 'ai_tunnel_circuit_open',
  detail: 'test',
  nowMs: 100,
});
assert.strictEqual(okRec.ok, true);

const warned = getSoftDegradeSnapshot({ nowMs: 200 });
assert.strictEqual(warned.status, 'warn', 'activeActions non-empty must be warn (no false green)');
assert.strictEqual(warned.activeActions.length, 1);
assert.strictEqual(warned.activeActions[0].id, 'ai_tunnel_suspend_probe');
assert.strictEqual(warned.activeActions[0].sinceMs, 100);

clearSoftDegradeAction('ai_tunnel_suspend_probe');
assert.strictEqual(getSoftDegradeSnapshot({ nowMs: 300 }).status, 'ok');

// Derive from backpressure without explicit record
updateBackpressureMetrics({ p99Ms: 6000, httpOk: true });
const derived = getSoftDegradeSnapshot({ nowMs: 400 });
assert.strictEqual(derived.status, 'warn');
assert.ok(derived.activeActions.some((a) => a.id === 'backpressure_throttle_poll'));
assert.ok(derived.activeActions.some((a) => a.id === 'backpressure_pause_secondary'));

_resetBackpressureForTests();
_resetSoftDegradeForTests();

setSoftDegradeHealthEnabled(true);
recordSoftDegradeAction({ id: 'log_tmp_cleanup', reason: 'test', nowMs: 500 });
const health = buildHealthPayload();
assert.ok(health.subsystems.softDegrade, 'health must expose softDegrade');
assert.strictEqual(health.subsystems.softDegrade.status, 'warn');
assert.strictEqual(health.status, 'warn', 'softDegrade only raises overall to warn');
assert.strictEqual(health.ok, false);

_resetSoftDegradeForTests();
console.log('🎉 ALL test_soft_degrade_registry PASSED\n');
