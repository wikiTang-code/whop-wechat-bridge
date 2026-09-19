/**
 * test/test_wsl_ai_cutover_chg023.js
 * Fingerprint + default backend = wsl (no live LMS kill in CI).
 */
import assert from 'assert';
import {
  fingerprintFromModelsJson,
  WIN_BASE
} from '../tools/wsl-ai-cutover.js';
import {
  getRuntimeAdapter,
  resetRuntimeAdapter,
  WslLlamaAdapter,
  WindowsLmsAdapter
} from '../tools/ai-runtime-adapter.js';

const lmsBody = JSON.stringify({
  object: 'list',
  data: [{ id: 'qwen2.5-14b-instruct', object: 'model', owned_by: 'organization_owner' }]
});
assert.strictEqual(fingerprintFromModelsJson(lmsBody).kind, 'lms');

const wslBody = JSON.stringify({
  object: 'list',
  data: [{
    id: '/mnt/c/Users/86597/.lmstudio/models/x.gguf',
    object: 'model',
    owned_by: 'llamacpp'
  }]
});
assert.strictEqual(fingerprintFromModelsJson(wslBody).kind, 'wsl_llama');

assert.strictEqual(fingerprintFromModelsJson('not-json').kind, 'unknown');
assert.ok(WIN_BASE.includes('8080'));

const prev = process.env.AI_RUNTIME_BACKEND;
delete process.env.AI_RUNTIME_BACKEND;
resetRuntimeAdapter();
assert.ok(getRuntimeAdapter() instanceof WslLlamaAdapter, 'default backend must be wsl');
resetRuntimeAdapter();
assert.ok(getRuntimeAdapter('lms') instanceof WindowsLmsAdapter);
resetRuntimeAdapter();
if (prev === undefined) delete process.env.AI_RUNTIME_BACKEND;
else process.env.AI_RUNTIME_BACKEND = prev;

console.log('test_wsl_ai_cutover_chg023: PASS');
