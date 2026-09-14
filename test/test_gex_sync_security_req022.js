/**
 * test_gex_sync_security_req022.js - REQ-022 GEX→GCP 只读同步安全专节单元测试
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateGexPayload,
  scanForSensitiveData,
  calculateChecksum,
  atomicWriteGexFile
} from '../tools/gex-sidecar/gex-sync-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_DIR = path.join(__dirname, 'scratch_gex_test');

function cleanupScratch() {
  if (fs.existsSync(SCRATCH_DIR)) {
    fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  }
}

console.log('===========================================================');
console.log('🧪 [Test REQ-022] GEX→GCP 只读同步安全规程与防护验证套件');
console.log('===========================================================\n');

cleanupScratch();
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

try {
  // 1. 测试合法 Payload 结构验证
  console.log('--- 1. 验证合法 GEX 快照结构 ---');
  const validSnapshot = {
    generated_at: '2026-09-14T18:49:27',
    session: 'closed_or_pre',
    source: 'futu-opend',
    zero_dte: {
      SPY: { spot: 764.29, king: { strike: 764.0, net_gex: -39015728.52 } },
      QQQ: { spot: 502.10, king: { strike: 500.0, net_gex: 12500000.00 } }
    }
  };

  const validRes = validateGexPayload(validSnapshot);
  assert.strictEqual(validRes.valid, true, '合法 payload 应该顺利通过');
  assert.deepStrictEqual(validRes.metadata.tickers, ['SPY', 'QQQ']);
  console.log('✅ 合法结构与 metadata 提取验证通过');

  // 2. 测试敏感信息/凭证泄漏拦截 (Security Redline)
  console.log('\n--- 2. 验证敏感凭证泄漏防御阻断 ---');
  const leakingPayloads = [
    {
      name: '包含 token 键',
      payload: { ...validSnapshot, access_token: 'secret_token_12345' }
    },
    {
      name: '嵌套包含 secret 键',
      payload: {
        ...validSnapshot,
        extra: { webhook_secret: 'whsec_9999' }
      }
    },
    {
      name: '包含 password 键',
      payload: { ...validSnapshot, user_password: 'super_secret_pw' }
    },
    {
      name: '包含私钥头字符串',
      payload: {
        ...validSnapshot,
        custom_cert: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...'
      }
    }
  ];

  for (const item of leakingPayloads) {
    const leakRes = validateGexPayload(item.payload);
    assert.strictEqual(leakRes.valid, false, `${item.name} 必须被安全拦截`);
    assert(leakRes.error.includes('Security violation'), '必须明确指出安全违规');
  }
  console.log('✅ 敏感 key 与私钥字符串深度防泄漏扫描验证通过');

  // 3. 测试残缺与格式错误拦截
  console.log('\n--- 3. 验证非合法格式与残缺字段拦截 ---');
  const badSyntaxRes = validateGexPayload('{ broken json:');
  assert.strictEqual(badSyntaxRes.valid, false);
  assert(badSyntaxRes.error.includes('Invalid JSON syntax'));

  const missingRes = validateGexPayload({ generated_at: '2026-09-14' }); // 缺少 source 和 zero_dte
  assert.strictEqual(missingRes.valid, false);
  assert(missingRes.error.includes('Schema validation failed'));
  console.log('✅ 语法错误与残缺 payload 拦截验证通过');

  // 4. 测试安全原子写入 (Atomic Write)
  console.log('\n--- 4. 验证原子写入与完整性哈希保障 ---');
  const targetFile = path.join(SCRATCH_DIR, 'latest.json');
  const writeRes = atomicWriteGexFile(targetFile, validSnapshot);

  assert.strictEqual(writeRes.success, true);
  assert(fs.existsSync(targetFile), '目标文件必须已生成');
  
  // 验证无任何 .tmp 临时文件遗留
  const dirFiles = fs.readdirSync(SCRATCH_DIR);
  assert.strictEqual(dirFiles.length, 1);
  assert.strictEqual(dirFiles[0], 'latest.json');

  // 验证内容与哈希完全吻合
  const contentOnDisk = fs.readFileSync(targetFile, 'utf-8');
  assert.strictEqual(calculateChecksum(contentOnDisk), writeRes.sha256);
  console.log('✅ 临时文件写入 -> 回读哈希校验 -> 原子重命名全闭环通过');

  // 5. 测试对现有仓库 data/gex/latest.json 进行真实回归测试
  console.log('\n--- 5. 验证本地入库 data/gex/latest.json 安全合规性 ---');
  const repoLatestPath = path.join(__dirname, '..', 'data', 'gex', 'latest.json');
  if (fs.existsSync(repoLatestPath)) {
    const repoContent = fs.readFileSync(repoLatestPath, 'utf-8');
    const repoCheck = validateGexPayload(repoContent);
    assert.strictEqual(repoCheck.valid, true, `本地 latest.json 校验失败: ${repoCheck.error}`);
    console.log(`✅ 本地最新快照合规: generated_at=${repoCheck.metadata.generated_at}, source=${repoCheck.metadata.source}, tickers=${repoCheck.metadata.tickers.join(',')}`);
  }

  console.log('\n🎉 REQ-022 GEX→GCP 只读同步安全验证套件全部 PASS！\n');
} finally {
  cleanupScratch();
}
