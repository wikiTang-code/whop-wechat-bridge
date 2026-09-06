/**
 * @file test/test_route_coverage_probe.js
 * @description P2-12c unit tests for route coverage probe
 */

import {
  probeRouteCoverage,
  setCachedRouteCoverageSnapshot,
  getRouteCoverageSnapshot,
  DEFAULT_ROUTE_COVERAGE_PATHS,
} from '../monitoring/route-coverage-probe.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- P2-12c: test_route_coverage_probe ---');

  assert(DEFAULT_ROUTE_COVERAGE_PATHS.includes('/api/l2b/drycut20'), 'must include drycut20');
  assert(DEFAULT_ROUTE_COVERAGE_PATHS.includes('/review_workbench.html'), 'must include workbench page');

  // All OK
  const okFetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ success: true }),
  });
  const okSnap = await probeRouteCoverage({
    baseUrl: 'http://127.0.0.1:9',
    paths: ['/api/l2a/dates', '/api/l2b/drycut20'],
    fetchImpl: okFetch,
    nowMs: 1000,
  });
  assert(okSnap.status === 'ok', 'all 200 → ok');
  assert(okSnap.failCount === 0, 'failCount 0');
  console.log('   ✅ all mounted → ok');

  // One Cannot GET → warn
  const oneMissing = async (url) => {
    if (String(url).includes('drycut20')) {
      return { status: 404, text: async () => 'Cannot GET /api/l2b/drycut20' };
    }
    return { status: 200, text: async () => '{}' };
  };
  const warnSnap = await probeRouteCoverage({
    baseUrl: 'http://127.0.0.1:9',
    paths: ['/api/l2a/dates', '/api/l2b/drycut20'],
    fetchImpl: oneMissing,
  });
  assert(warnSnap.status === 'warn', '1 miss → warn');
  assert(warnSnap.failCount === 1, 'failCount 1');
  assert(warnSnap.paths.find((p) => p.path.includes('drycut')).unmounted === true, 'unmounted flag');
  console.log('   ✅ single miss → warn');

  // Two misses → critical
  const twoMissing = async () => ({
    status: 404,
    text: async () => '<!DOCTYPE html><pre>Cannot GET</pre>',
  });
  const critSnap = await probeRouteCoverage({
    baseUrl: 'http://127.0.0.1:9',
    paths: ['/a', '/b'],
    fetchImpl: twoMissing,
  });
  assert(critSnap.status === 'critical', '2 miss → critical');
  console.log('   ✅ two misses → critical');

  // Unreachable
  const boom = async () => {
    throw new Error('ECONNREFUSED');
  };
  const downSnap = await probeRouteCoverage({
    baseUrl: 'http://127.0.0.1:9',
    paths: ['/a', '/b'],
    fetchImpl: boom,
  });
  assert(downSnap.status === 'critical', 'unreachable → critical');
  console.log('   ✅ unreachable → critical');

  // Cache helper
  setCachedRouteCoverageSnapshot(okSnap, { ttlMs: 60_000, nowMs: 5000 });
  const cached = getRouteCoverageSnapshot({ nowMs: 5100 });
  assert(cached.status === 'ok', 'cache hit');
  console.log('   ✅ cache helpers');

  console.log('\n🎉 ALL P2-12c ROUTE COVERAGE TESTS PASSED\n');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
