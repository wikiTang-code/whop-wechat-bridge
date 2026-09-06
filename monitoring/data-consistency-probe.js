/**
 * @file monitoring/data-consistency-probe.js
 * @description P2-13C: 数据一致性巡检探针（DB attachments ↔ media_manifest ↔ 磁盘文件）
 *
 * 核心原则：
 * 1. 只读铁律：全量只读打开 SQLite，绝不调用可写句柄；
 * 2. 默认抽样：只查最新 N 条带附件消息，绝不全盘递归扫描磁盘；
 * 3. 软降级：遇到偏差仅报告 warn/critical，挂入 /health 时绝不单独 503；
 * 4. 宽容解析：兼容不同附件结构，跳过纯远程 URL，杜绝误报。
 */

import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from './db-readonly.js';

export const DEFAULT_SAMPLE_SIZE = 50;
export const DEFAULT_CONSISTENCY_TTL_MS = 60_000;
const MAX_EXAMPLES = 5;

let cachedSnapshot = null;
let cacheExpiresAtMs = 0;
let refreshInFlight = null;

/**
 * 执行数据一致性巡检 (Pure evaluator，支持单测参数注入)
 * @param {object} options
 * @param {object} [options.dbInstance] 注入的只读数据库实例
 * @param {string} [options.dbPath] 归档数据库路径
 * @param {string} [options.manifestPath] media_manifest.json 路径
 * @param {string} [options.projectRoot] 项目根目录
 * @param {number} [options.sampleSize] 抽样数量上限
 * @param {number} [options.nowMs] 当前时间戳
 * @returns {Promise<object>}
 */
export async function probeDataConsistency({
  dbInstance = null,
  dbPath = path.resolve('whop_archive.db'),
  manifestPath = path.resolve('data/media/zhao/media_manifest.json'),
  projectRoot = process.cwd(),
  sampleSize = DEFAULT_SAMPLE_SIZE,
  nowMs = Date.now(),
} = {}) {
  const result = {
    status: 'ok',
    checkedAtMs: nowMs,
    sampleSize,
    checked: 0,
    mismatchCount: 0,
    categories: {
      dbHasAttachMissingFile: 0,
      manifestMissingFile: 0,
      dbAttachParseError: 0,
    },
    skippedRemoteOnly: 0,
    examples: [],
    description: '',
    notes: `sampled_only (limit ${sampleSize}, ordered by created_at desc)`,
  };

  const addExample = (issue, messageId, targetPath, detail) => {
    if (result.examples.length < MAX_EXAMPLES) {
      result.examples.push({
        issue,
        messageId: messageId ? String(messageId) : null,
        path: targetPath || null,
        detail: detail || '',
      });
    }
  };

  let db = dbInstance;
  let shouldCloseDb = false;

  try {
    if (!db) {
      if (!fs.existsSync(dbPath)) {
        result.status = 'unknown';
        result.description = `Archive DB not found at ${dbPath}`;
        return result;
      }
      db = getReadOnlyArchiveDb(dbPath);
      // getReadOnlyArchiveDb 内部已有池化管理，无需手动关闭
    }

    // 1. 从 DB 中抽样获取最新带附件的消息
    const rows = db.prepare(`
      SELECT id, attachments, created_at
      FROM messages
      WHERE attachments IS NOT NULL 
        AND attachments != '' 
        AND attachments != '[]'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sampleSize);

    result.checked = rows.length;

    for (const row of rows) {
      let parsed = null;
      try {
        parsed = typeof row.attachments === 'string'
          ? JSON.parse(row.attachments)
          : row.attachments;
      } catch (err) {
        result.categories.dbAttachParseError++;
        addExample('dbAttachParseError', row.id, null, `JSON.parse error: ${err.message}`);
        continue;
      }

      const attachList = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of attachList) {
        if (!item) continue;

        // 形式 A: 纯字符串 URL
        if (typeof item === 'string') {
          if (/^https?:\/\//i.test(item)) {
            result.skippedRemoteOnly++;
          } else {
            // 当作纯本地相对路径处理
            const fullPath = path.isAbsolute(item) ? item : path.resolve(projectRoot, item);
            const exists = fs.existsSync(fullPath);
            const isNonEmpty = exists && fs.statSync(fullPath).size > 0;
            if (!isNonEmpty) {
              result.categories.dbHasAttachMissingFile++;
              addExample('dbHasAttachMissingFile', row.id, item, exists ? 'File exists but size is 0' : 'File not found on disk');
            }
          }
          continue;
        }

        // 形式 B: 对象结构 { local_path, url, ... }
        if (typeof item === 'object') {
          const localRel = item.local_path || item.localPath;
          const remoteUrl = item.url || item.raw_url || item.rawUrl;

          if (localRel && typeof localRel === 'string') {
            const fullPath = path.isAbsolute(localRel) ? localRel : path.resolve(projectRoot, localRel);
            let exists = false;
            let size = 0;
            try {
              if (fs.existsSync(fullPath)) {
                exists = true;
                size = fs.statSync(fullPath).size;
              }
            } catch (_) {
              exists = false;
            }

            if (!exists || size === 0) {
              result.categories.dbHasAttachMissingFile++;
              addExample(
                'dbHasAttachMissingFile',
                row.id,
                localRel,
                exists ? 'File exists but size is 0' : 'File not found on disk'
              );
            }
          } else if (remoteUrl) {
            // 仅有远程 URL，尚未分配或无需本地落盘
            result.skippedRemoteOnly++;
          }
        }
      }
    }

    // 2. 检查媒体索引清单 media_manifest.json (若存在)
    if (fs.existsSync(manifestPath)) {
      try {
        const rawManifest = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(rawManifest);

        if (Array.isArray(manifest) && manifest.length > 0) {
          // 抽取最新（末尾）至多 20 条做快速抽样核验
          const manifestSample = manifest.slice(-20);
          for (const m of manifestSample) {
            if (m && m.local_path && typeof m.local_path === 'string') {
              const fullPath = path.isAbsolute(m.local_path)
                ? m.local_path
                : path.resolve(projectRoot, m.local_path);

              let exists = false;
              let size = 0;
              try {
                if (fs.existsSync(fullPath)) {
                  exists = true;
                  size = fs.statSync(fullPath).size;
                }
              } catch (_) {
                exists = false;
              }

              if (!exists || size === 0) {
                result.categories.manifestMissingFile++;
                addExample(
                  'manifestMissingFile',
                  m.message_id || null,
                  m.local_path,
                  exists ? 'Manifest file exists but size is 0' : 'Manifest file not found on disk'
                );
              }
            }
          }
        }
      } catch (manifestErr) {
        result.categories.manifestMissingFile++;
        addExample('manifestMissingFile', null, manifestPath, `Manifest parse error: ${manifestErr.message}`);
      }
    }

    // 3. 计算偏差总和与最终评级
    result.mismatchCount =
      result.categories.dbHasAttachMissingFile +
      result.categories.manifestMissingFile +
      result.categories.dbAttachParseError;

    if (result.mismatchCount === 0) {
      result.status = 'ok';
      result.description = `All ${result.checked} sampled messages and manifest files are consistent with disk`;
    } else if (result.categories.dbHasAttachMissingFile >= 3) {
      result.status = 'critical';
      result.description = `Critical inconsistency: ${result.categories.dbHasAttachMissingFile} missing DB attachments, ${result.mismatchCount} total issues`;
    } else {
      result.status = 'warn';
      result.description = `Data inconsistency detected: ${result.mismatchCount} mismatch(es) (C1=${result.categories.dbHasAttachMissingFile}, C2=${result.categories.manifestMissingFile}, C3=${result.categories.dbAttachParseError})`;
    }
  } catch (err) {
    result.status = 'warn';
    result.description = `Data consistency probe error: ${err.message}`;
    addExample('probeExecutionError', null, null, err.message);
  }

  return result;
}

/**
 * 同步读取缓存快照（供 sync `buildHealthPayload`；无缓存时返回 unknown）
 */
export function getCachedDataConsistencySnapshot({ nowMs = Date.now() } = {}) {
  if (cachedSnapshot) {
    return nowMs < cacheExpiresAtMs
      ? cachedSnapshot
      : { ...cachedSnapshot, stale: true };
  }
  return {
    status: 'unknown',
    checkedAtMs: nowMs,
    sampleSize: 50,
    checked: 0,
    mismatchCount: 0,
    categories: {
      dbHasAttachMissingFile: 0,
      manifestMissingFile: 0,
      dbAttachParseError: 0,
    },
    skippedRemoteOnly: 0,
    examples: [],
    description: 'dataConsistency 尚未完成首次探测',
    notes: 'sampled_only (pending first probe)',
  };
}

/**
 * 获取数据一致性巡检快照 (带 TTL 缓存)
 * @param {object} [options]
 * @param {number} [options.nowMs]
 * @param {number} [options.ttlMs]
 * @returns {Promise<object>}
 */
export async function getDataConsistencySnapshot({
  nowMs = Date.now(),
  ttlMs = DEFAULT_CONSISTENCY_TTL_MS,
  ...rest
} = {}) {
  if (cachedSnapshot && nowMs < cacheExpiresAtMs) {
    return cachedSnapshot;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = probeDataConsistency({ nowMs, ...rest })
    .then((snap) => {
      cachedSnapshot = snap;
      cacheExpiresAtMs = nowMs + ttlMs;
      return snap;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * 强制刷新快照
 */
export async function refreshDataConsistencySnapshot(options = {}) {
  cacheExpiresAtMs = 0;
  return getDataConsistencySnapshot({ nowMs: Date.now(), ...options });
}

/**
 * 仅供单元测试重置缓存
 */
export function _resetDataConsistencyCacheForTest() {
  cachedSnapshot = null;
  cacheExpiresAtMs = 0;
  refreshInFlight = null;
}
