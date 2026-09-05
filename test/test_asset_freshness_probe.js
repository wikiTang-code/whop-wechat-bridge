/**
 * @file test/test_asset_freshness_probe.js
 * @description P1-9 单元测试：验证离线资产新鲜度探针与滞后告警
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { checkAssetFreshness, getAssetFreshnessSnapshot } from '../monitoring/asset-freshness-probe.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P1-9 测试: test_asset_freshness_probe ---');

  // 1. 验证常规探测
  console.log('1. 验证真实库资产新鲜度只读探测...');
  const snap = checkAssetFreshness();
  assert(snap && typeof snap.status === 'string', 'snapshot should have status');
  assert(snap.assets, 'snapshot should have assets dictionary');
  assert(snap.assets.persona, 'assets should contain persona');
  assert(snap.assets.l2a_watermark, 'assets should contain l2a_watermark');
  assert(snap.assets.news, 'assets should contain news');

  console.log(`   ✅ 资产探针现场数据: ${snap.summary}`);
  console.log(`      - Persona 状态: ${snap.assets.persona.status} (${snap.assets.persona.description})`);
  console.log(`      - L2a 水位状态: ${snap.assets.l2a_watermark.status} (${snap.assets.l2a_watermark.description})`);
  console.log(`      - News 新闻状态: ${snap.assets.news.status} (${snap.assets.news.description})`);

  // 2. 验证快照读取
  const snap2 = getAssetFreshnessSnapshot();
  assert(snap2.status === snap.status, 'getAssetFreshnessSnapshot should match checkAssetFreshness');
  console.log('   ✅ 快照缓存读取通过！');

  // 3. 休市空窗：News 未生成也不应拖成 warn
  console.log('3. 验证周末/节假日 News 休市空窗免检...');
  const closedSnap = checkAssetFreshness({ isMarketClosed: true });
  assert(closedSnap.assets.news.status === 'ok', 'news should be ok when market closed');
  assert(
    String(closedSnap.assets.news.description).includes('休市空窗免检'),
    'news description should declare holiday exemption'
  );
  assert(closedSnap.assets.news.marketClosed === true, 'news.marketClosed should be true');
  console.log(`   ✅ 休市免检: ${closedSnap.assets.news.description}`);

  // 4. 交易日：从未生成仍应 warn（可观测 ≠ 业务闭环）
  console.log('4. 验证交易日 News 未生成仍报 warn...');
  const openSnap = checkAssetFreshness({ isMarketClosed: false });
  if (!openSnap.assets.news.lastUpdated) {
    assert(openSnap.assets.news.status === 'warn', 'missing news on trading day should warn');
    console.log('   ✅ 交易日未生成 → warn');
  } else {
    console.log(`   ⏭ 跳过（库内已有 News: ${openSnap.assets.news.description}）`);
  }

  console.log('\n🎉 ALL P1-9 TESTS PASSED: test_asset_freshness_probe\n');
}

run().catch(err => {
  console.error('❌ P1-9 测试失败:', err);
  process.exit(1);
});
