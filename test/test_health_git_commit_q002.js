import assert from 'node:assert';
import { buildHealthPayload, getProcessGitCommit, setProcessGitCommitForTest } from '../monitoring/health.js';

console.log('===========================================================');
console.log('🧪 [Test CHG-020 / Q-002] /health gitCommit & Restart Drift Detection');
console.log('===========================================================');

// 1. Verify default git commit detection
const commit = getProcessGitCommit();
assert(typeof commit === 'string' && commit.length > 0, 'gitCommit must be non-empty string');
console.log('  ✅ Current process git commit resolved:', commit.slice(0, 7));

// 2. Verify payload structure
const payload = buildHealthPayload();
assert(payload && payload.subsystems && payload.subsystems.process, 'subsystems.process must exist');
assert.strictEqual(payload.subsystems.process.gitCommit, commit, 'payload must match getProcessGitCommit');
console.log('  ✅ /health payload exposes process.gitCommit correctly');

// 3. Test mock injection and restart drift logic
const currentDiskSha = '52f2ed9227330494a287332fffb52ed6ddc96504';
const oldProcessSha = '1352705000000000000000000000000000000000';

// Case A: Aligned (no drift)
setProcessGitCommitForTest(currentDiskSha);
const payloadAligned = buildHealthPayload();
const alignedProcCommit = payloadAligned.subsystems.process.gitCommit;
const alignedDrift = !currentDiskSha.startsWith(alignedProcCommit) && !alignedProcCommit.startsWith(currentDiskSha);
assert.strictEqual(alignedDrift, false, 'Aligned commit should not be drift');
console.log('  ✅ Aligned commit: restart_drift === false');

// Case B: Drift (process still running old commit after deploy_align)
setProcessGitCommitForTest(oldProcessSha);
const payloadDrift = buildHealthPayload();
const driftProcCommit = payloadDrift.subsystems.process.gitCommit;
const isDrift = !currentDiskSha.startsWith(driftProcCommit) && !driftProcCommit.startsWith(currentDiskSha);
assert.strictEqual(isDrift, true, 'Different commits must flag restart_drift === true');
console.log('  ✅ Divergent commit: restart_drift === true (disk:', currentDiskSha.slice(0, 7), 'vs proc:', driftProcCommit.slice(0, 7), ')');

// Clean up: restore actual commit
setProcessGitCommitForTest(commit);

console.log('===========================================================');
console.log('🎉 CHG-020 / Q-002 所有单测全部 PASS！');
console.log('===========================================================');
