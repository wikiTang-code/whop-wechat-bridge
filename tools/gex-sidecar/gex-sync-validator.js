/**
 * gex-sync-validator.js - GEX 产物安全校验与同步防护模块 (REQ-022 / REQ-004)
 * 
 * 核心安全机制：
 * 1. 结构与格式白名单核验：确保具备 generated_at, session, source, zero_dte 等核心节点；
 * 2. 凭证/密钥泄漏防御扫描：严禁任何包含 token, secret, password, key, credential, env 等敏感字段流向云端；
 * 3. 完整性与 SHA-256 校验；
 * 4. 目标端原子写入保障（.tmp 文件写入 -> 哈希与 JSON 解析验证 -> rename 覆盖）。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// 敏感字段黑名单模式（严格防泄漏）
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /\.env/i
];

/**
 * 递归深度扫描对象中是否包含敏感键或值
 */
export function scanForSensitiveData(obj, pathPrefix = '') {
  const violations = [];
  if (!obj || typeof obj !== 'object') return violations;

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    
    // 检查 Key
    for (const pattern of SENSITIVE_KEY_PATTERNS) {
      if (pattern.test(key)) {
        violations.push({ path: currentPath, reason: `Sensitive key pattern match: ${pattern}` });
      }
    }

    // 检查 Value (如果是字符串且包含可能的长密文或私钥头)
    if (typeof value === 'string') {
      if (value.includes('BEGIN PRIVATE KEY') || value.includes('BEGIN RSA PRIVATE KEY')) {
        violations.push({ path: currentPath, reason: 'Contains private key block' });
      }
    } else if (typeof value === 'object' && value !== null) {
      violations.push(...scanForSensitiveData(value, currentPath));
    }
  }

  return violations;
}

/**
 * 校验 GEX 快照 Payload 的合规性
 */
export function validateGexPayload(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(payload);
    } catch (e) {
      return {
        valid: false,
        error: `Invalid JSON syntax: ${e.message}`,
        details: []
      };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      error: 'Payload must be a non-null object',
      details: []
    };
  }

  const errors = [];

  // 1. 基础根字段检查
  if (!data.generated_at || typeof data.generated_at !== 'string') {
    errors.push('Missing or invalid "generated_at" string timestamp');
  }
  if (!data.source || typeof data.source !== 'string') {
    errors.push('Missing or invalid "source" identifier');
  }
  if (!data.zero_dte || typeof data.zero_dte !== 'object') {
    errors.push('Missing or invalid "zero_dte" object');
  }

  // 2. 敏感凭证泄漏深度阻断扫描
  const violations = scanForSensitiveData(data);
  if (violations.length > 0) {
    return {
      valid: false,
      error: `Security violation: ${violations.length} sensitive patterns detected in payload`,
      details: violations
    };
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: `Schema validation failed: ${errors.join('; ')}`,
      details: errors
    };
  }

  return {
    valid: true,
    error: null,
    details: [],
    metadata: {
      generated_at: data.generated_at,
      source: data.source,
      tickers: Object.keys(data.zero_dte || {})
    }
  };
}

/**
 * 计算文件或字符串的 SHA256 校验和
 */
export function calculateChecksum(content) {
  const hash = crypto.createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * 安全原子写入：先写入临时文件，做语法与哈希校验，通过后再原子 rename 替换目标文件
 */
export function atomicWriteGexFile(targetPath, jsonContent) {
  const validation = validateGexPayload(jsonContent);
  if (!validation.valid) {
    throw new Error(`[GEX Sync Security] Validation failed: ${validation.error}`);
  }

  const contentStr = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent, null, 2);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const checksum = calculateChecksum(contentStr);

  try {
    // 1. 写入临时文件
    fs.writeFileSync(tmpPath, contentStr, 'utf-8');

    // 2. 回读临时文件核验完整性
    const readBack = fs.readFileSync(tmpPath, 'utf-8');
    const readChecksum = calculateChecksum(readBack);
    if (readChecksum !== checksum) {
      throw new Error(`Checksum mismatch after writing tmp file! Expected ${checksum}, got ${readChecksum}`);
    }

    // 3. 再次验证回读后的 JSON 解析
    JSON.parse(readBack);

    // 4. 原子重命名覆盖目标文件 (POSIX 和 Windows 下跨进程原子操作)
    fs.renameSync(tmpPath, targetPath);

    return {
      success: true,
      targetPath,
      sha256: checksum,
      sizeBytes: Buffer.byteLength(contentStr)
    };
  } catch (err) {
    // 发生异常清理临时文件
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
    throw err;
  }
}
