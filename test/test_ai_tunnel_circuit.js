/**
 * P0-4: AI tunnel circuit unit tests (no live LM required).
 */
import {
  getAiTunnelStatus,
  isAiTunnelSuspended,
  _setAiTunnelStateForTests,
} from '../monitoring/ai-tunnel-circuit.js';
import { shouldBlockGeminiForLocalDown } from '../ai-router-policy.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

_setAiTunnelStateForTests('closed');
assert(isAiTunnelSuspended() === false, 'closed not suspended');
assert(getAiTunnelStatus().status === 'closed', 'status closed');

_setAiTunnelStateForTests('open');
assert(isAiTunnelSuspended() === true, 'open is suspended');
assert(getAiTunnelStatus().suspended === true, 'suspended flag');
assert(shouldBlockGeminiForLocalDown({ circuitOpen: true, allowSparseGemini: false }) === true, 'policy blocks gemini');

_setAiTunnelStateForTests('closed');
assert(isAiTunnelSuspended() === false, 'reset closed');

console.log('test_ai_tunnel_circuit: PASS');
