/**
 * test/test_batch_vision_req038_t1.js
 * 验证 REQ-038-T1 432张真图云端轻量 VL 离线批跑管道与 07 门禁项
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  scanValidDiskImages,
  filterPendingImages,
  sanitizeVlOutput,
  runBatchVisionPipeline,
  MIN_VALID_BYTES,
  VALID_EXTS,
} from '../tools/knowledge/batch_vision_pipeline.js';
import { saveMessageVisionMeta } from '../database.js';

console.log('===========================================================');
console.log('🧪 [Test REQ-038-T1] 432张真图云端 VL 离线批跑与门禁验证测试套件');
console.log('===========================================================');

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_vision_meta (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      attach_index INTEGER NOT NULL DEFAULT 0,
      local_path TEXT,
      chart_type TEXT,
      ticker TEXT,
      timeframe TEXT,
      patterns_json TEXT,
      support_resistance_json TEXT,
      hand_drawn_annotation TEXT,
      schema_json TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'stub',
      status TEXT NOT NULL DEFAULT 'stubbed',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(message_id, attach_index)
    );
  `);
  return db;
}

// --- 测试 1: 磁盘图片扫描器与门禁过滤验证 ---
console.log('\n--- 1. 验证磁盘真图扫描门禁 (size > 15KB 且非 .bin) ---');
const diskImages = scanValidDiskImages();
assert(Array.isArray(diskImages), 'diskImages should be an array');
assert(diskImages.length >= 400, `Expected at least 400 valid images, got ${diskImages.length}`);

for (const img of diskImages.slice(0, 20)) {
  assert(img.size > MIN_VALID_BYTES, `Image ${img.filename} size ${img.size} must be > 15KB`);
  const ext = '.' + img.filename.split('.').pop().toLowerCase();
  assert(VALID_EXTS.has(ext), `Extension ${ext} must be valid image ext`);
  assert(!img.filename.endsWith('.bin'), 'Must not include .bin files');
  assert(img.message_id.startsWith('post_'), 'message_id should start with post_');
}
console.log(`✅ 磁盘真图扫描通过，共识别出 ${diskImages.length} 张合规大文件真图`);

// --- 测试 2: 严格白名单清洗与安全红线过滤 ---
console.log('\n--- 2. 验证白名单字段清洗与交易指令物理拦截 ---');
const mockRawWithViolation = {
  ticker: 'tsla',
  timeframe: '1D',
  action: 'BUY', // 越界指令
  recommendation: 'STRONG_BUY', // 越界推荐
  support_resistance: {
    support: [210.5, 'invalid', 200],
    resistance: [230],
  },
  patterns: ['双底突破', '强力 BUY 信号', ''],
  hand_drawn_annotation: '阻力线 230，建议买入做多',
};

const sanitized = sanitizeVlOutput(mockRawWithViolation);
assert.strictEqual(sanitized.ok, true);
assert.strictEqual(sanitized.data.ticker, 'TSLA');
assert.strictEqual(sanitized.data.timeframe, '1D');
assert.deepStrictEqual(sanitized.data.support_resistance.support, [210.5, 200]);
assert.deepStrictEqual(sanitized.data.patterns, ['双底突破', '强力 [FILTERED] 信号']);
assert.strictEqual(sanitized.data.hand_drawn_annotation, '阻力线 230，[建议已过滤]');

const oob = sanitizeVlOutput({
  ticker: 'TSLA',
  support_resistance: { support: [0.06, 350], resistance: [18.3, 370] }
});
assert.deepStrictEqual(oob.data.support_resistance.support, [350]);
assert.deepStrictEqual(oob.data.support_resistance.resistance, [370]);

// 严查违规字段是否被彻底剔除
assert.strictEqual(sanitized.data.action, undefined, 'Must strip action field');
assert.strictEqual(sanitized.data.recommendation, undefined, 'Must strip recommendation field');
console.log('✅ 白名单字段校验通过，任何 BUY/SELL 字段与文本指令均被物理切除脱敏');

// --- 测试 3: 失败场景与 status='failed' 契约规范 ---
console.log('\n--- 3. 验证抽取失败标 status=\'failed\' 门禁契约 ---');
const testDb = setupTestDb();
const failedMeta = {
  id: 'vmeta_test_fail_0',
  message_id: 'post_test_fail',
  attach_index: 0,
  local_path: 'data/media/zhao/sample_corrupt.png',
  chart_type: 'UNKNOWN',
  ticker: null,
  timeframe: null,
  patterns: [],
  support_resistance: null,
  hand_drawn_annotation: 'extract_failed: TIMEOUT',
  provider: 'cloud_vl',
  status: 'failed', // 必须为 failed，不可自创 vision_status
  created_at: Date.now(),
  updated_at: Date.now(),
};

saveMessageVisionMeta(failedMeta, testDb);
const rowInDb = testDb.prepare('SELECT * FROM message_vision_meta WHERE id = ?').get('vmeta_test_fail_0');
assert.strictEqual(rowInDb.status, 'failed', 'status column must be exactly failed');
assert.strictEqual(rowInDb.provider, 'cloud_vl');
console.log('✅ status=\'failed\' 契约落库验证通过');

// --- 测试 4: 预算超限熔断与断点续跑验证 ---
console.log('\n--- 4. 验证预算超限熔断与断点续跑 ---');
let costErrorCaught = false;
try {
  await runBatchVisionPipeline({
    limit: 100,
    maxCostUsd: 0.01, // 设置极低预算阈值触发熔断
    dbInstance: testDb,
  });
} catch (e) {
  if (e.message.includes('COST_EXCEEDED')) {
    costErrorCaught = true;
  }
}
assert(costErrorCaught, 'Should throw COST_EXCEEDED when budget is exceeded');
console.log('✅ 预算防护超限熔断验证通过');

// 断点续跑：成功写入一条 status='ok' 后，不应出现在待跑队列
saveMessageVisionMeta({
  id: 'vmeta_post_1CXYCpXPkLs5VVnU5aBkJe_0',
  message_id: 'post_1CXYCpXPkLs5VVnU5aBkJe',
  attach_index: 0,
  provider: 'cloud_vl',
  status: 'ok',
  created_at: Date.now(),
  updated_at: Date.now(),
}, testDb);

const pendingBefore = filterPendingImages(diskImages, testDb);
const hit = pendingBefore.find(i => i.id === 'vmeta_post_1CXYCpXPkLs5VVnU5aBkJe_0');
assert(!hit, 'Successfully processed image (status=ok) must be excluded from pending queue');
console.log('✅ 幂等断点续跑与已入库去重验证通过');

testDb.close();
console.log('\n===========================================================');
console.log('🎉 REQ-038-T1 432张真图云端 VL 离线批跑门禁测试全部 PASS！');
console.log('===========================================================');
