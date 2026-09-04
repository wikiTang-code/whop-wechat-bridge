/**
 * P0-3 smoke tests: health payload shape + event-loop defaults.
 */
import { buildHealthPayload, registerAiTunnelHealthGetter } from '../monitoring/health.js';
import { getEventLoopSnapshot, EVENT_LOOP_DEFAULTS, classifyEventLoopLevel } from '../monitoring/event-loop-probe.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(EVENT_LOOP_DEFAULTS.warnNs === 1e9, 'warn threshold 1s');
assert(EVENT_LOOP_DEFAULTS.criticalNs === 5e9, 'critical threshold 5s');

// 验证指标分级与抗偶发毛刺能力：
// 1. 场景 A: 单点 11.5s 偶发毛刺 (p99=22ms) 绝不能被误判为 critical，必须定性为 warn
const levelSpike = classifyEventLoopLevel(22 * 1e6, 11517 * 1e6, 1e9, 5e9);
assert(levelSpike === 'warn', `Spike should be warn, got: ${levelSpike}`);

// 2. 场景 B: 真实全量停摆 (p99=40s max=40s) 必须定性为 critical
const levelFreeze = classifyEventLoopLevel(40936 * 1e6, 40936 * 1e6, 1e9, 5e9);
assert(levelFreeze === 'critical', `Real freeze should be critical, got: ${levelFreeze}`);

// 3. 场景 C: 整体延迟升高且有严重毛刺 (p99=1.5s max=6s) 必须定性为 critical
const levelHeavy = classifyEventLoopLevel(1500 * 1e6, 6000 * 1e6, 1e9, 5e9);
assert(levelHeavy === 'critical', `Heavy lag should be critical, got: ${levelHeavy}`);

// 4. 场景 D: 平稳运行 (p99=20ms max=25ms) 必须定性为 ok
const levelNormal = classifyEventLoopLevel(20 * 1e6, 25 * 1e6, 1e9, 5e9);
assert(levelNormal === 'ok', `Normal lag should be ok, got: ${levelNormal}`);

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
