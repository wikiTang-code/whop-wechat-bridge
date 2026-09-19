/**
 * CHG-027: knowledge promote adapter never auto-writes prod unless apply id.
 */
import assert from 'assert';
import { createKnowledgeAdapter } from '../tools/local-ops/adapters/knowledge.js';

console.log('🧪 [CHG-027] knowledge promote adapter');

const calls = [];
const adapter = createKnowledgeAdapter({
  rootDir: '/repo',
  spawnImpl: (cmd, argv) => {
    calls.push({ cmd, argv });
    return { status: 0, stdout: JSON.stringify({ ok: true, argv }), stderr: '' };
  }
});

await adapter.invoke('knowledge.promote.plan');
assert.ok(!calls[0].argv.includes('--allow-prod-write'), 'plan must not allow prod write');
assert.ok(!calls[0].argv.includes('--apply'), 'plan must not apply');

await adapter.invoke('knowledge.promote.dump');
assert.ok(calls[1].argv.includes('--dump'));
assert.ok(!calls[1].argv.includes('--allow-prod-write'), 'dump must not allow prod write');

await adapter.invoke('knowledge.promote.apply');
assert.ok(calls[2].argv.includes('--remote'));
assert.ok(calls[2].argv.includes('--apply'));
assert.ok(calls[2].argv.includes('--allow-prod-write'), 'apply after HITL may pass flag to CLI');

let threw = false;
try {
  await adapter.invoke('knowledge.promote.hack');
} catch {
  threw = true;
}
assert.ok(threw, 'unknown id rejected');

console.log('✅ [CHG-027] knowledge promote adapter PASS');
