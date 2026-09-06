/**
 * @file monitoring/db-readonly.js
 * @description P1-11: Web 看板与只读端专属数据库连接管理器
 *
 * 核心保证:
 * 1. 严格使用 { readonly: true } 打开 SQLite 句柄，杜绝任何数据篡改与写锁争用；
 * 2. 同时支持 whop_archive.db 与 monitoring.db 的只读访问；
 * 3. 超时保护: 默认 timeout=2000ms，防止被长事务阻塞。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let readOnlyArchiveDb = null;
let readOnlyMonitoringDb = null;

export function getReadOnlyArchiveDb(dbPath = path.resolve('whop_archive.db')) {
  if (readOnlyArchiveDb) return readOnlyArchiveDb;
  if (!fs.existsSync(dbPath)) return null;

  try {
    readOnlyArchiveDb = new Database(dbPath, { readonly: true, timeout: 2000 });
    registerReadOnlyUdfs(readOnlyArchiveDb);
    return readOnlyArchiveDb;
  } catch (err) {
    console.warn('[DBReadOnly] 无法以只读模式打开 whop_archive.db:', err.message);
    return null;
  }
}

/**
 * 注册只读端需要的安全 SQLite 自定义函数 (如 msgType 过滤所需函数)
 */
export function registerReadOnlyUdfs(db) {
  if (!db) return;
  try {
    db.function('has_image', (content) => {
      if (!content) return 0;
      return /\[IMAGE:https?:\/\/[^\]]+\]/i.test(content) ? 1 : 0;
    });
    db.function('has_link', (content) => {
      if (!content) return 0;
      const cleanContent = content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/gi, '');
      return /https?:\/\//i.test(cleanContent) ? 1 : 0;
    });
    db.function('is_text_only', (content) => {
      if (!content) return 1;
      const hasImage = /\[IMAGE:https?:\/\/[^\]]+\]/i.test(content);
      const cleanContent = content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/gi, '');
      const hasLink = /https?:\/\//i.test(cleanContent);
      return (!hasImage && !hasLink) ? 1 : 0;
    });
    db.function('cosine_dist', (a, b) => {
      if (!a || !b) return 0;
      const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
      const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
      const lenA = bufA.length / 4;
      const lenB = bufB.length / 4;
      const len = Math.min(lenA, lenB);
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        const valA = bufA.readFloatLE(i * 4);
        const valB = bufB.readFloatLE(i * 4);
        dot += valA * valB;
        normA += valA * valA;
        normB += valB * valB;
      }
      if (normA === 0 || normB === 0) return 0;
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    });
  } catch (_) {}
}

export function getReadOnlyMonitoringDb(dbPath = process.env.MONITORING_DB_PATH || path.resolve('monitoring.db')) {
  if (readOnlyMonitoringDb) return readOnlyMonitoringDb;
  if (!fs.existsSync(dbPath)) return null;

  try {
    readOnlyMonitoringDb = new Database(dbPath, { readonly: true, timeout: 2000 });
    return readOnlyMonitoringDb;
  } catch (err) {
    console.warn('[DBReadOnly] 无法以只读模式打开 monitoring.db:', err.message);
    return null;
  }
}

export function closeReadOnlyDbs() {
  if (readOnlyArchiveDb) {
    try { readOnlyArchiveDb.close(); } catch (_) {}
    readOnlyArchiveDb = null;
  }
  if (readOnlyMonitoringDb) {
    try { readOnlyMonitoringDb.close(); } catch (_) {}
    readOnlyMonitoringDb = null;
  }
}
