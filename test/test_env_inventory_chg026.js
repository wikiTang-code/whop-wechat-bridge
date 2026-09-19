/**
 * CHG-026 / REQ-039: environment contract + inventory safety (no prod writes)
 */
import assert from 'assert';
import {
  loadSpec,
  assertPromoteSafety,
  classify,
  countTables,
  remoteProbeSource
} from '../tools/knowledge/env_inventory.js';

console.log('🧪 [CHG-026] env inventory');

const spec = loadSpec();
assertPromoteSafety(spec);

const ids = new Set(spec.workloads.map((w) => w.id));
for (const need of [
  'ingest-archive',
  'gex-collect',
  'gex-dashboard-replica',
  'knowledge-distill',
  'knowledge-vl-batch',
  'slm-lora-flywheel',
  'media-files'
]) {
  assert.ok(ids.has(need), `missing workload ${need}`);
}

const distill = spec.workloads.find((w) => w.id === 'knowledge-distill');
assert.strictEqual(distill.compute, 'wsl-gpu');
assert.strictEqual(distill.sor, 'gcp-vm');

const lora = spec.workloads.find((w) => w.id === 'slm-lora-flywheel');
assert.strictEqual(lora.sor, 'wsl-gpu');
assert.notStrictEqual(lora.sor, 'gcp-vm');

const ingest = spec.workloads.find((w) => w.id === 'ingest-archive');
assert.strictEqual(ingest.compute, 'gcp-vm');
assert.strictEqual(ingest.sor, 'gcp-vm');

assert.ok(spec.promote_never.includes('messages'));
assert.ok(!spec.promote_allowlist.includes('messages'));
assert.ok(spec.promote_allowlist.includes('ontology_card'));

const local = {
  sqlite: {
    tables: { ontology_card: 10, messages: 100, ontology_distill_scanned: 4, message_vision_meta: 1, semantic_cu: 0 }
  },
  media: { files: 441 },
  lora: { present: true, files: [{ name: 'adapter_model.safetensors', bytes: 1 }] }
};
const remote = {
  sqlite: { tables: { ontology_card: 0, messages: 200, ontology_distill_scanned: 0, message_vision_meta: 0, semantic_cu: 0 } },
  media: { files: 403 }
};
const drifts = classify(spec, local, remote);
assert.ok(drifts.some((d) => d.id === 'ontology_card' && d.kind === 'knowledge-local-only'));
assert.ok(drifts.some((d) => d.id === 'messages' && d.kind === 'prod-ahead'));
assert.ok(drifts.some((d) => d.id === 'slm-lora-flywheel' && d.kind === 'expected-local'));
assert.ok(drifts.some((d) => d.id === 'media-files'));

const empty = countTables('/no/such.db', ['messages']);
assert.strictEqual(empty.missing, true);
assert.strictEqual(empty.tables.messages, null);

const probeSrc = remoteProbeSource(['ontology_card', 'messages']);
assert.ok(probeSrc.includes("SELECT COUNT(*) AS c FROM ' + t"), 'probe SQL uses bound table loop');
assert.ok(!probeSrc.includes('node --input-type=module -e'), 'win-host must not use ssh node -e');

console.log('✅ [CHG-026] env inventory PASS');
