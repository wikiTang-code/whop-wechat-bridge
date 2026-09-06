/**
 * @file test/test_data_consistency_probe.js
 * @description P2-13C: 数据一致性巡检探针完整单测 (静态红线 + 动态 C1/C2/C3/Skip + TTL 缓存)
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  probeDataConsistency,
  getDataConsistencySnapshot,
  refreshDataConsistencySnapshot,
  _resetDataConsistencyCacheForTest,
} from '../monitoring/data-consistency-probe.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 P2-13C 测试: test_data_consistency_probe ---');

  // 1. 静态红线核验 (只读铁律、无 pm2、无删库/自动修改行为)
  console.log('1. 验证静态红线 (只读模式 / 无写操作 / 无 pm2)...');
  const probeSrcPath = path.resolve('monitoring/data-consistency-probe.js');
  const probeSrc = fs.readFileSync(probeSrcPath, 'utf8');
  const codeOnly = probeSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  assert(!codeOnly.includes('getDb('), 'data-consistency-probe must NEVER call writable getDb()');
  assert(!codeOnly.includes('pm2 restart'), 'data-consistency-probe must NEVER call pm2 restart');
  assert(!codeOnly.includes('pm2 stop'), 'data-consistency-probe must NEVER call pm2 stop');
  assert(!codeOnly.includes('unlinkSync'), 'data-consistency-probe must NEVER delete files');
  assert(!codeOnly.includes('rmSync'), 'data-consistency-probe must NEVER remove directories');
  console.log('   ✅ 静态红线核验通过：杜绝可写 getDb()、杜绝 pm2 重启、杜绝物理删修数据');

  // 2. 构造动态隔离测试沙箱
  console.log('2. 搭建动态测试隔离沙箱...');
  const sandboxDir = path.resolve('data/test_consistency_sandbox');
  if (fs.existsSync(sandboxDir)) fs.rmSync(sandboxDir, { recursive: true, force: true });
  fs.mkdirSync(sandboxDir, { recursive: true });

  const testDbPath = path.join(sandboxDir, 'test_archive.db');
  const testManifestPath = path.join(sandboxDir, 'media_manifest.json');
  const mediaDir = path.join(sandboxDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  // 初始化测试 SQLite 数据库并插入基础结构
  const testDb = new Database(testDbPath);
  testDb.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      content TEXT,
      attachments TEXT,
      created_at INTEGER
    );
  `);

  // 创建一个真实的二进制测试图片
  const realImg1 = path.join(mediaDir, 'real_img_1.jpg');
  fs.writeFileSync(realImg1, Buffer.from('FAKE_IMAGE_DATA_1234567890'));

  const realImg2 = path.join(mediaDir, 'real_img_2.jpg');
  fs.writeFileSync(realImg2, Buffer.from('ANOTHER_FAKE_IMAGE_DATA'));

  try {
    // 3. 场景 A: 全绿测试 (All Consistent)
    console.log('3. 场景 A: 验证数据全部一致时的 ok 状态...');
    const insertMsg = testDb.prepare(`
      INSERT INTO messages (id, content, attachments, created_at) VALUES (?, ?, ?, ?)
    `);

    insertMsg.run(
      'msg_001',
      'hello with real image',
      JSON.stringify([{ local_path: realImg1, url: 'https://whop.com/img1.jpg' }]),
      1700000001000
    );

    const manifestData = [
      {
        message_id: 'msg_001',
        local_path: realImg1,
        status: 'ok',
        bytes: fs.statSync(realImg1).size,
      },
    ];
    fs.writeFileSync(testManifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

    const resA = await probeDataConsistency({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      projectRoot: sandboxDir,
      sampleSize: 10,
    });

    assert(resA.status === 'ok', `resA status should be ok, got: ${resA.status}`);
    assert(resA.mismatchCount === 0, `mismatchCount should be 0, got: ${resA.mismatchCount}`);
    assert(resA.checked === 1, `checked should be 1, got: ${resA.checked}`);
    assert(resA.categories.dbHasAttachMissingFile === 0, 'C1 should be 0');
    assert(resA.categories.manifestMissingFile === 0, 'C2 should be 0');
    assert(resA.categories.dbAttachParseError === 0, 'C3 should be 0');
    console.log('   ✅ 场景 A 通过：全一致时严格返回 status=ok, mismatchCount=0');

    // 4. 场景 B: C1 偏差 (dbHasAttachMissingFile) 单条触发 warn
    console.log('4. 场景 B: 验证 DB 有记录但磁盘文件缺失 (C1 -> warn)...');
    const fakeMissingPath = path.join(mediaDir, 'non_existent_img.jpg');
    insertMsg.run(
      'msg_002',
      'missing file',
      JSON.stringify([{ local_path: fakeMissingPath, url: 'https://whop.com/fake.jpg' }]),
      1700000002000
    );

    const resB = await probeDataConsistency({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      projectRoot: sandboxDir,
      sampleSize: 10,
    });

    assert(resB.status === 'warn', `resB status should be warn, got: ${resB.status}`);
    assert(resB.categories.dbHasAttachMissingFile === 1, `C1 count should be 1, got: ${resB.categories.dbHasAttachMissingFile}`);
    assert(resB.mismatchCount === 1, `mismatchCount should be 1, got: ${resB.mismatchCount}`);
    assert(resB.examples.length >= 1, 'examples should have entries');
    assert(resB.examples[0].issue === 'dbHasAttachMissingFile', 'example issue should match C1');
    assert(resB.examples[0].messageId === 'msg_002', 'example messageId should match msg_002');
    console.log('   ✅ 场景 B 通过：单条缺失物理文件准确识别为 C1 并判定 warn');

    // 5. 场景 C: C1 偏差累积升级至 critical (>= 3 缺失)
    console.log('5. 场景 C: 验证缺失累积达到阈值时升级为 critical...');
    insertMsg.run(
      'msg_003',
      'missing 2',
      JSON.stringify([{ local_path: path.join(mediaDir, 'missing_2.jpg') }]),
      1700000003000
    );
    insertMsg.run(
      'msg_004',
      'missing 3',
      JSON.stringify([{ local_path: path.join(mediaDir, 'missing_3.jpg') }]),
      1700000004000
    );

    const resC = await probeDataConsistency({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      projectRoot: sandboxDir,
      sampleSize: 10,
    });

    assert(resC.status === 'critical', `resC status should be critical, got: ${resC.status}`);
    assert(resC.categories.dbHasAttachMissingFile === 3, `C1 count should be 3, got: ${resC.categories.dbHasAttachMissingFile}`);
    console.log('   ✅ 场景 C 通过：C1 累积达到 3 条时准确提升评级至 critical');

    // 6. 场景 D: C2 偏差 (manifestMissingFile)
    console.log('6. 场景 D: 验证 manifest 条目指向缺失磁盘文件 (C2)...');
    const badManifest = [
      {
        message_id: 'msg_999',
        local_path: path.join(mediaDir, 'manifest_lost.jpg'),
        status: 'ok',
      },
    ];
    fs.writeFileSync(testManifestPath, JSON.stringify(badManifest, null, 2), 'utf8');

    const resD = await probeDataConsistency({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      projectRoot: sandboxDir,
      sampleSize: 1, // 仅查一条最新的
    });

    assert(resD.categories.manifestMissingFile >= 1, `C2 should be >= 1, got ${resD.categories.manifestMissingFile}`);
    assert(resD.examples.some(e => e.issue === 'manifestMissingFile'), 'examples must contain manifestMissingFile');
    console.log('   ✅ 场景 D 通过：manifest 指向不存在文件准确记入 C2');

    // 7. 场景 E: C3 偏差 (dbAttachParseError 畸形 JSON)
    console.log('7. 场景 E: 验证 attachments 畸形 JSON 解析失败 (C3)...');
    insertMsg.run('msg_005', 'broken json attachments', '{bad_json_string', 1700000005000);

    const resE = await probeDataConsistency({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      projectRoot: sandboxDir,
      sampleSize: 1, // 最新的就是 msg_005
    });

    assert(resE.categories.dbAttachParseError === 1, `C3 should be 1, got ${resE.categories.dbAttachParseError}`);
    assert(resE.examples.some(e => e.issue === 'dbAttachParseError'), 'examples must contain dbAttachParseError');
    console.log('   ✅ 场景 E 通过：畸形 JSON 宽容捕获并记入 C3，探针自身零崩溃');

    // 8. 场景 F: 跳过纯远程 URL (skippedRemoteOnly，避免假阳性)
    console.log('8. 场景 F: 验证纯远程未下载 URL 优雅跳过 (防假阳性)...');
    insertMsg.run(
      'msg_006',
      'remote only attachment',
      JSON.stringify(['https://whop.com/remote_only.png']),
      1700000006000
    );

    // 仅针对 msg_006 查
    const isolatedDb = new Database(':memory:');
    isolatedDb.exec(`
      CREATE TABLE messages (id TEXT, content TEXT, attachments TEXT, created_at INTEGER);
      INSERT INTO messages VALUES ('msg_remote', 'test', '["https://whop.com/file.png"]', 100);
    `);

    const resF = await probeDataConsistency({
      dbInstance: isolatedDb,
      manifestPath: path.join(sandboxDir, 'no_manifest.json'),
      sampleSize: 10,
    });

    assert(resF.status === 'ok', `status should remain ok, got: ${resF.status}`);
    assert(resF.mismatchCount === 0, `mismatchCount should be 0, got: ${resF.mismatchCount}`);
    assert(resF.skippedRemoteOnly === 1, `skippedRemoteOnly should be 1, got: ${resF.skippedRemoteOnly}`);
    isolatedDb.close();
    console.log('   ✅ 场景 F 通过：未落盘的远程 URL 纯引用安全跳过，绝无假阳性');

    // 9. 场景 G: 验证 TTL 缓存与刷新机制
    console.log('9. 验证 TTL 缓存与刷新机制...');
    _resetDataConsistencyCacheForTest();

    const t0 = 1000000;
    const snap1 = await getDataConsistencySnapshot({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      nowMs: t0,
      ttlMs: 30000,
    });

    const snap2 = await getDataConsistencySnapshot({
      dbInstance: testDb,
      manifestPath: testManifestPath,
      nowMs: t0 + 5000, // 5秒后，应命中缓存
      ttlMs: 30000,
    });

    assert(snap1 === snap2, 'snap1 and snap2 must be identical instance within TTL');

    const snap3 = await refreshDataConsistencySnapshot({
      dbInstance: testDb,
      manifestPath: testManifestPath,
    });

    assert(snap1 !== snap3, 'refreshDataConsistencySnapshot must generate new snapshot instance');
    _resetDataConsistencyCacheForTest();
    console.log('   ✅ 场景 G 通过：TTL 内存缓存生效且支持显式 force 刷新');

    // 10. 场景 H: 真实项目数据库抽样无报错回归
    console.log('10. 验证在项目真实环境下的只读稳健执行...');
    const realProbeResult = await probeDataConsistency();
    assert(typeof realProbeResult === 'object', 'real probe result must be an object');
    assert(
      ['ok', 'warn', 'critical', 'unknown'].includes(realProbeResult.status),
      `status must be one of ok/warn/critical/unknown, got: ${realProbeResult.status}`
    );
    assert(realProbeResult.notes.includes('sampled_only'), 'notes must specify sampled_only');
    console.log(`   ✅ 场景 H 通过：真实环境抽样执行耗时极低，结果状态: ${realProbeResult.status} (checked=${realProbeResult.checked}, mismatches=${realProbeResult.mismatchCount})`);

  } finally {
    testDb.close();
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  console.log('\n🎉 ALL P2-13C TESTS PASSED: test_data_consistency_probe\n');
}

run().catch((err) => {
  console.error('❌ P2-13C 测试失败:', err);
  process.exit(1);
});
