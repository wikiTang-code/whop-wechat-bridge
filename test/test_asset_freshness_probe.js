/**
 * @file test/test_asset_freshness_probe.js
 * @description P1-9 / T3 单元测试：资产新鲜度探针 + News 休市/交易日行为
 */
import { checkAssetFreshness, getAssetFreshnessSnapshot } from '../monitoring/asset-freshness-probe.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P1-9 测试: test_asset_freshness_probe ---');

  console.log('1. 验证真实库资产新鲜度只读探测...');
  const snap = checkAssetFreshness();
  assert(snap && typeof snap.status === 'string', 'snapshot should have status');
  assert(snap.assets?.persona && snap.assets?.l2a_watermark && snap.assets?.news, 'assets keys');
  console.log(`   ✅ ${snap.summary}`);
  console.log(`      News: ${snap.assets.news.status} (${snap.assets.news.description})`);

  const snap2 = getAssetFreshnessSnapshot();
  assert(snap2.status === snap.status, 'snapshot cache');
  console.log('   ✅ 快照缓存读取通过！');

  console.log('3. 休市空窗免检...');
  const closedSnap = checkAssetFreshness({ isMarketClosed: true });
  assert(closedSnap.assets.news.status === 'ok', 'news ok when closed');
  assert(String(closedSnap.assets.news.description).includes('休市空窗免检'), 'exemption text');
  console.log(`   ✅ ${closedSnap.assets.news.description}`);

  console.log('4. 交易日未生成 → warn...');
  const openSnap = checkAssetFreshness({ isMarketClosed: false });
  if (!openSnap.assets.news.lastUpdated) {
    assert(openSnap.assets.news.status === 'warn', 'missing news warns');
    assert(String(openSnap.assets.news.description).includes('交易日缺失'), 'trading-day missing text');
    console.log('   ✅ 交易日未生成 → warn');
  } else {
    console.log(`   ⏭ 库内已有 News: ${openSnap.assets.news.description}`);
  }

  console.log('\n🎉 ALL P1-9 / T3 TESTS PASSED: test_asset_freshness_probe\n');
}

run().catch((err) => {
  console.error('❌ P1-9 测试失败:', err);
  process.exit(1);
});
