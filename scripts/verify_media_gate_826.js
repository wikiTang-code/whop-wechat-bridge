import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('========================================================================================');
console.log('🛡️ 执行 8/26 战法实盘图门禁真实质检 (Media Gate: Size > 15KB & Valid SHA & Non-Skeleton)');
console.log('========================================================================================\n');

const dir826 = path.resolve('data/media/zhao/2026-08-26');

if (!fs.existsSync(dir826)) {
  console.error(`❌ 目录不存在: ${dir826}`);
  process.exit(1);
}

const files = fs.readdirSync(dir826).filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'));
console.log(`📁 8/26 目录内共检测到附件文件: ${files.length} 个\n`);

const passed = [];
const rejected = [];
const seenShas = new Set();

const KNOWN_SKELETON_SHAS = new Set([
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // empty
]);

for (const file of files) {
  const fullPath = path.join(dir826, file);
  const stat = fs.statSync(fullPath);
  const sizeBytes = stat.size;
  const sizeKb = (sizeBytes / 1024).toFixed(1);

  const fileBuf = fs.readFileSync(fullPath);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  const shortSha = sha256.slice(0, 8);

  // 门禁规则：
  // 1. 物理大小必须严格 > 15KB (15360 字节)
  // 2. SHA 不在已知骨架屏黑名单
  // 3. 非重复图片
  if (sizeBytes <= 15360) {
    rejected.push({
      file,
      sizeKb,
      sizeBytes,
      sha: shortSha,
      reason: `文件过小 (<=15KB)，判定为占位图/表情包/骨架屏拦截`
    });
    continue;
  }

  if (KNOWN_SKELETON_SHAS.has(sha256)) {
    rejected.push({
      file,
      sizeKb,
      sizeBytes,
      sha: shortSha,
      reason: `命中骨架屏哈希黑名单`
    });
    continue;
  }

  if (seenShas.has(sha256)) {
    rejected.push({
      file,
      sizeKb,
      sizeBytes,
      sha: shortSha,
      reason: `同批次内重复 SHA 附件`
    });
    continue;
  }

  seenShas.add(sha256);
  passed.push({
    file,
    sizeKb,
    sizeBytes,
    sha: shortSha,
    fullPath
  });
}

console.log('----------------------------------------------------------------------------------------');
console.log(`📊 门禁质检结果汇总：`);
console.log(`   - 待检文件总数: ${files.length} 张`);
console.log(`   - ✅ 真实过关张数: ${passed.length} 张`);
console.log(`   - ❌ 拦截淘汰张数: ${rejected.length} 张`);
console.log('----------------------------------------------------------------------------------------\n');

console.log('✅ 过关合规战法图明细表 (Size > 15KB & 独立有效 SHA):');
passed.forEach((p, idx) => {
  console.log(`   [${idx + 1}] ${p.file.padEnd(38)} | 大小: ${p.sizeKb.padStart(6)} KB | SHA: ${p.sha}`);
});

if (rejected.length > 0) {
  console.log('\n❌ 拦截淘汰文件明细表:');
  rejected.forEach((r, idx) => {
    console.log(`   [${idx + 1}] ${r.file.padEnd(38)} | 大小: ${r.sizeKb.padStart(6)} KB | 原因: ${r.reason}`);
  });
}

const report = {
  gate_name: 'Media Gate v1.0 (8/26 Verification)',
  target_date: '2026-08-26',
  total_files_scanned: files.length,
  passed_count: passed.length,
  rejected_count: rejected.length,
  pass_rate: `${((passed.length / (files.length || 1)) * 100).toFixed(1)}%`,
  passed_files: passed,
  rejected_files: rejected
};

fs.writeFileSync('data/media/zhao/media_gate_report_826.json', JSON.stringify(report, null, 2), 'utf-8');
console.log(`\n📄 质检报告已落盘: data/media/zhao/media_gate_report_826.json\n`);
