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
    return readOnlyArchiveDb;
  } catch (err) {
    console.warn('[DBReadOnly] 无法以只读模式打开 whop_archive.db:', err.message);
    return null;
  }
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
