/**
 * REQ-004: GEX latest.json → gcp-vm SCP sync (validate-first).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { syncLatestToGcp } from '../tools/gex-sidecar/sync_latest_to_gcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.join(here, 'scratch_gex_sync_req004');

function cleanup() {
  if (fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true });
}

cleanup();
fs.mkdirSync(scratch, { recursive: true });

const goodPath = path.join(scratch, 'latest.json');
const badName = path.join(scratch, 'heatseeker_gex.html');
const good = {
  generated_at: '2026-09-14T18:49:27',
  session: 'closed_or_pre',
  source: 'futu-opend',
  zero_dte: { SPY: { spot: 1 } },
};
fs.writeFileSync(goodPath, JSON.stringify(good), 'utf8');
fs.writeFileSync(badName, '<html></html>', 'utf8');

console.log('===========================================================');
console.log('🧪 [Test REQ-004] GEX latest.json → GCP SCP sync');
console.log('===========================================================\n');

const dry = await syncLatestToGcp({
  localPath: goodPath,
  dryRun: true,
  host: 'gcp-vm',
  remotePath: '/tmp/latest.json',
});
assert.strictEqual(dry.ok, true);
assert.strictEqual(dry.dry_run, true);
assert.ok(dry.sha256);
console.log('✅ dry-run validate OK');

let threw = false;
try {
  await syncLatestToGcp({ localPath: badName, dryRun: true });
} catch (e) {
  threw = /latest\.json|HTML|forbidden/i.test(e.message);
}
assert.strictEqual(threw, true, 'html path rejected');
console.log('✅ HTML path rejected');

const missing = await syncLatestToGcp({
  localPath: path.join(scratch, 'no_such_dir', 'latest.json'),
  dryRun: true,
});
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.code, 'missing_local');
console.log('✅ missing local handled');

let scpArgs = null;
const spawnImpl = (cmd, argv) => {
  assert.strictEqual(cmd, 'scp');
  scpArgs = argv;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', 0));
  return child;
};

const live = await syncLatestToGcp({
  localPath: goodPath,
  host: 'gcp-vm',
  remotePath: '/home/wikitang628/whop-wechat-bridge/data/gex/latest.json',
  spawnImpl,
});
assert.strictEqual(live.ok, true);
assert.strictEqual(live.dry_run, false);
assert.ok(scpArgs.includes(goodPath));
assert.ok(scpArgs.some((a) => String(a).startsWith('gcp-vm:')));
console.log('✅ mocked scp OK');

cleanup();
console.log('\n🎉 REQ-004 sync_latest_to_gcp PASS');
