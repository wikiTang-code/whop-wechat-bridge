/**
 * P0-3 smoke tests: health payload shape + event-loop defaults.
 */
import { buildHealthPayload, registerAiTunnelHealthGetter } from '../monitoring/health.js';
import { getEventLoopSnapshot, EVENT_LOOP_DEFAULTS } from '../monitoring/event-loop-probe.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(EVENT_LOOP_DEFAULTS.warnNs === 1e9, 'warn threshold 1s');
assert(EVENT_LOOP_DEFAULTS.criticalNs === 5e9, 'critical threshold 5s');

const snap = getEventLoopSnapshot();
assert(typeof snap.enabled === 'boolean', 'snapshot has enabled');
assert('meanMs' in snap && 'maxMs' in snap && 'p99Ms' in snap, 'snapshot lag fields');

registerAiTunnelHealthGetter(() => ({ enabled: true, status: 'closed', reachable: true }));
const health = buildHealthPayload();
assert(health.ok === true || health.status === 'ok' || health.status === 'warn' || health.status === 'critical', 'overall status');
assert(health.subsystems.process, 'process subsystem');
assert(health.subsystems.eventLoop, 'eventLoop subsystem');
assert(health.subsystems.aiTunnel.status === 'closed', 'aiTunnel injected');
assert(health.subsystems.eventLoop.meanMs !== undefined, 'event loop meanMs present');

console.log('test_health_event_loop: PASS');
