/**
 * DEBT-014 — resolveLlamaServerBin / mock gate (no WSL spawn required).
 */
import assert from 'assert';
import {
  resolveLlamaServerBin,
  shellSingleQuote,
  allowMockFallback,
  WslLlamaSupervisor
} from '../tools/wsl-llama-supervisor.js';

assert.strictEqual(shellSingleQuote("a'b"), `'a'\\''b'`);

const fromEnv = resolveLlamaServerBin({
  envBin: '/opt/llama-server',
  execSyncFn: () => { throw new Error('should not call'); }
});
assert.strictEqual(fromEnv, '/opt/llama-server');

const fromWhich = resolveLlamaServerBin({
  envBin: '',
  execSyncFn: (cmd) => {
    if (String(cmd).includes('command -v')) return '/usr/local/bin/llama-server\n';
    throw new Error('unexpected');
  }
});
assert.strictEqual(fromWhich, '/usr/local/bin/llama-server');

const prev = process.env.WSL_SUPERVISOR_ALLOW_MOCK;
delete process.env.WSL_SUPERVISOR_ALLOW_MOCK;
assert.strictEqual(allowMockFallback(), false);

const sup = new WslLlamaSupervisor({ resolveBin: () => null });
const denied = await sup.loadModel('qwen2.5-14b-instruct');
assert.strictEqual(denied.success, false, `expected deny without mock, got ${JSON.stringify(denied)}`);
assert.ok(String(denied.message).includes('llama-server not found'));

process.env.WSL_SUPERVISOR_ALLOW_MOCK = '1';
assert.strictEqual(allowMockFallback(), true);

if (prev === undefined) delete process.env.WSL_SUPERVISOR_ALLOW_MOCK;
else process.env.WSL_SUPERVISOR_ALLOW_MOCK = prev;

console.log('test_wsl_supervisor_resolve_debt014: PASS');
