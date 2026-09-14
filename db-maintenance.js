/**
 * db-maintenance.js - P2-16 主库增长治理与维护核心模块 (REQ-008)
 * 
 * 核心功能：
 * 1. 只读存储与碎片统计分析 (getDbStorageStats)；
 * 2. 数据生命周期保留策略执行 (pruneExpiredRecords: 终态任务/事件清理，孤儿向量清理)；
 * 3. 核心业务账本免疫保护 (zhao_positions, orders, follow_decisions 等严禁触碰)；
 * 4. WAL 安全截断与受控整理 (checkpointAndOptimize)。
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.join(__dirname, 'whop_archive.db');

/**
 * 保护清单：绝对不可被 prune 规则误删的核心业务表
 */
export const PROTECTED_BUSINESS_TABLES = [
  'messages',
  'orders',
  'positions',
  'zhao_positions',
  'follow_decisions',
  'trade_review_pool'
];

/**
 * 获取数据库存储状态与碎片分布（只读句柄，防锁）
 */
export function getDbStorageStats(dbInput = DEFAULT_DB_PATH) {
  let db;
  let shouldClose = false;
  let resolvedPath = '';

  if (typeof dbInput === 'string') {
    resolvedPath = dbInput;
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Database file not found: ${resolvedPath}`);
    }
    db = new Database(resolvedPath, { readonly: true });
    shouldClose = true;
  } else {
    db = dbInput;
    resolvedPath = db.name;
  }

  try {
    const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : { size: 0 };
    const walPath = `${resolvedPath}-wal`;
    const walStat = fs.existsSync(walPath) ? fs.statSync(walPath) : { size: 0 };

    const pageSize = db.pragma('page_size', { simple: true }) || 4096;
    const pageCount = db.pragma('page_count', { simple: true }) || 0;
    const freelistCount = db.pragma('freelist_count', { simple: true }) || 0;
    const journalMode = db.pragma('journal_mode', { simple: true });
    const autoVacuum = db.pragma('auto_vacuum', { simple: true });

    // 统计各表行数与占用
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const tableStats = [];

    // 尝试获取 dbstat（若环境支持）
    let dbstatMap = new Map();
    try {
      const dbstatRows = db.prepare("SELECT name, sum(pgsize) as bytes FROM dbstat GROUP BY name").all();
      for (const r of dbstatRows) {
        dbstatMap.set(r.name, r.bytes);
      }
    } catch (e) {
      // dbstat 不可用时忽略
    }

    for (const t of tables) {
      let rowCount = 0;
      try {
        rowCount = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get().c;
      } catch (e) {
        rowCount = -1;
      }
      const bytes = dbstatMap.get(t.name) || 0;
      tableStats.push({
        name: t.name,
        rowCount,
        bytes,
        sizeMB: bytes > 0 ? Number((bytes / 1024 / 1024).toFixed(2)) : undefined
      });
    }

    // 孤儿分析
    let orphanEmbeddings = 0;
    let orphanAdjacency = 0;
    try {
      const hasEmb = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_embeddings'").get();
      if (hasEmb) {
        orphanEmbeddings = db.prepare(`
          SELECT count(*) as c FROM message_embeddings me
          LEFT JOIN messages m ON me.id = m.id
          WHERE m.id IS NULL
        `).get().c;
      }
    } catch (e) {}

    try {
      const hasAdj = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_adjacency'").get();
      if (hasAdj) {
        orphanAdjacency = db.prepare(`
          SELECT count(*) as c FROM message_adjacency ma
          LEFT JOIN messages m ON ma.message_id = m.id
          WHERE m.id IS NULL
        `).get().c;
      }
    } catch (e) {}

    const freelistBytes = freelistCount * pageSize;

    return {
      dbPath: resolvedPath,
      fileSizeBytes: stat.size,
      fileSizeMB: Number((stat.size / 1024 / 1024).toFixed(2)),
      walSizeBytes: walStat.size,
      walSizeMB: Number((walStat.size / 1024 / 1024).toFixed(2)),
      pageSize,
      pageCount,
      freelistCount,
      freelistBytes,
      freelistMB: Number((freelistBytes / 1024 / 1024).toFixed(2)),
      journalMode,
      autoVacuum,
      orphanEmbeddings,
      orphanAdjacency,
      tables: tableStats
    };
  } finally {
    if (shouldClose && db) {
      db.close();
    }
  }
}

/**
 * 清理过期任务队列与日志 (Retention Pruning)
 * 
 * 安全红线：
 * 1. 绝不删除 PROTECTED_BUSINESS_TABLES 中的数据；
 * 2. 严禁清理未终态任务 (pending, running, processing)；
 * 3. 严禁误伤 pipeline_tasks 中 l2b_cut paused 状态；
 * 4. 仅清理 >= retentionDays 的终态记录。
 */
export function pruneExpiredRecords(db, options = {}) {
  const {
    retentionDays = 14,
    dryRun = false,
    cleanOrphans = true
  } = options;

  if (!db || typeof db.prepare !== 'function') {
    throw new Error("Valid active SQLite database instance required.");
  }

  const cutoffTs = Date.now() - (retentionDays * 86400 * 1000);
  const cutoffDate = new Date(cutoffTs).toISOString();

  // 1. 记录关键业务表基线行数，防止误伤
  const baselineCounts = {};
  for (const table of PROTECTED_BUSINESS_TABLES) {
    try {
      const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (hasTable) {
        baselineCounts[table] = db.prepare(`SELECT count(*) as c FROM "${table}"`).get().c;
      }
    } catch (e) {}
  }

  const results = {
    dryRun,
    retentionDays,
    cutoffTs,
    cutoffDate,
    pruned: {
      task_queue: 0,
      pipeline_tasks: 0,
      ingest_events: 0,
      orphan_embeddings: 0,
      orphan_adjacency: 0
    },
    totalPruned: 0
  };

  // 2. task_queue: 仅清理终态 (done, completed, failed, cancelled) 且 created_at < cutoff
  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_queue'").get();
    if (hasTable) {
      const countStmt = db.prepare(`
        SELECT count(*) as c FROM task_queue
        WHERE status IN ('done', 'completed', 'failed', 'cancelled')
          AND created_at < ?
      `);
      const eligible = countStmt.get(cutoffTs).c;
      results.pruned.task_queue = eligible;

      if (!dryRun && eligible > 0) {
        const deleteStmt = db.prepare(`
          DELETE FROM task_queue
          WHERE status IN ('done', 'completed', 'failed', 'cancelled')
            AND created_at < ?
        `);
        deleteStmt.run(cutoffTs);
      }
    }
  } catch (err) {
    console.warn("[DB Prune] task_queue 清理警告:", err.message);
  }

  // 3. pipeline_tasks: 仅清理终态 (ok, done, completed, skipped, failed)
  // 严禁清理 queue_name = 'l2b_cut' 及 status = 'paused'
  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_tasks'").get();
    if (hasTable) {
      const countStmt = db.prepare(`
        SELECT count(*) as c FROM pipeline_tasks
        WHERE queue_name != 'l2b_cut'
          AND status IN ('ok', 'done', 'completed', 'skipped', 'failed')
          AND status != 'paused'
          AND created_at < ?
      `);
      const eligible = countStmt.get(cutoffTs).c;
      results.pruned.pipeline_tasks = eligible;

      if (!dryRun && eligible > 0) {
        const deleteStmt = db.prepare(`
          DELETE FROM pipeline_tasks
          WHERE queue_name != 'l2b_cut'
            AND status IN ('ok', 'done', 'completed', 'skipped', 'failed')
            AND status != 'paused'
            AND created_at < ?
        `);
        deleteStmt.run(cutoffTs);
      }
    }
  } catch (err) {
    console.warn("[DB Prune] pipeline_tasks 清理警告:", err.message);
  }

  // 4. ingest_events: 入库日志清理
  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ingest_events'").get();
    if (hasTable) {
      const cols = db.prepare("PRAGMA table_info(ingest_events)").all().map(c => c.name);
      const timeCol = cols.includes('created_ts') ? 'created_ts' : (cols.includes('created_at') ? 'created_at' : null);
      if (timeCol) {
        const countStmt = db.prepare(`
          SELECT count(*) as c FROM ingest_events
          WHERE "${timeCol}" < ?
        `);
        const eligible = countStmt.get(cutoffTs).c;
        results.pruned.ingest_events = eligible;

        if (!dryRun && eligible > 0) {
          const deleteStmt = db.prepare(`
            DELETE FROM ingest_events
            WHERE "${timeCol}" < ?
          `);
          deleteStmt.run(cutoffTs);
        }
      }
    }
  } catch (err) {
    console.warn("[DB Prune] ingest_events 清理警告:", err.message);
  }

  // 5. 孤儿清理 (Orphan Embeddings & Adjacency)
  if (cleanOrphans) {
    try {
      const hasEmb = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_embeddings'").get();
      if (hasEmb) {
        const countStmt = db.prepare(`
          SELECT count(*) as c FROM message_embeddings me
          LEFT JOIN messages m ON me.id = m.id
          WHERE m.id IS NULL
        `);
        const eligible = countStmt.get().c;
        results.pruned.orphan_embeddings = eligible;

        if (!dryRun && eligible > 0) {
          db.prepare(`
            DELETE FROM message_embeddings
            WHERE id IN (
              SELECT me.id FROM message_embeddings me
              LEFT JOIN messages m ON me.id = m.id
              WHERE m.id IS NULL
            )
          `).run();
        }
      }
    } catch (err) {
      console.warn("[DB Prune] orphan_embeddings 清理警告:", err.message);
    }

    try {
      const hasAdj = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_adjacency'").get();
      if (hasAdj) {
        const countStmt = db.prepare(`
          SELECT count(*) as c FROM message_adjacency ma
          LEFT JOIN messages m ON ma.message_id = m.id
          WHERE m.id IS NULL
        `);
        const eligible = countStmt.get().c;
        results.pruned.orphan_adjacency = eligible;

        if (!dryRun && eligible > 0) {
          db.prepare(`
            DELETE FROM message_adjacency
            WHERE message_id IN (
              SELECT ma.message_id FROM message_adjacency ma
              LEFT JOIN messages m ON ma.message_id = m.id
              WHERE m.id IS NULL
            )
          `).run();
        }
      }
    } catch (err) {
      console.warn("[DB Prune] orphan_adjacency 清理警告:", err.message);
    }
  }

  results.totalPruned = Object.values(results.pruned).reduce((acc, v) => acc + v, 0);

  // 6. 执行后安全基线核验
  if (!dryRun) {
    for (const table of PROTECTED_BUSINESS_TABLES) {
      if (baselineCounts[table] !== undefined) {
        const currentCount = db.prepare(`SELECT count(*) as c FROM "${table}"`).get().c;
        if (currentCount < baselineCounts[table]) {
          throw new Error(`[CRITICAL DATA SAFETY VIOLATION] Protected table "${table}" count reduced from ${baselineCounts[table]} to ${currentCount}!`);
        }
      }
    }
  }

  return results;
}

/**
 * WAL 截断与安全整理
 */
export function checkpointAndOptimize(db, options = {}) {
  const { checkpoint = true, vacuum = false } = options;
  const actionsTaken = [];

  if (checkpoint) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      actionsTaken.push('wal_checkpoint_truncate');
    } catch (e) {
      console.warn('[DB Checkpoint] wal_checkpoint 警告:', e.message);
    }
  }

  try {
    db.pragma('optimize');
    actionsTaken.push('pragma_optimize');
  } catch (e) {
    console.warn('[DB Optimize] optimize 警告:', e.message);
  }

  if (vacuum) {
    try {
      db.prepare('VACUUM').run();
      actionsTaken.push('vacuum');
    } catch (e) {
      throw new Error(`VACUUM failed: ${e.message}`);
    }
  }

  return { success: true, actions: actionsTaken };
}

/**
 * 综合维护入口
 */
export function runMaintenance(options = {}) {
  const {
    dbPath = DEFAULT_DB_PATH,
    retentionDays = 14,
    dryRun = false,
    cleanOrphans = true,
    checkpoint = true,
    vacuum = false
  } = options;

  console.log(`[DB Maintenance] 开始数据库维护... (Target: ${dbPath})`);
  const beforeStats = getDbStorageStats(dbPath);

  const db = new Database(dbPath, { timeout: 15000 });
  let pruneResults;
  let optResults;

  try {
    pruneResults = pruneExpiredRecords(db, { retentionDays, dryRun, cleanOrphans });
    console.log(`[DB Maintenance] 清理结果 (dryRun=${dryRun}): 终态/孤儿共 ${pruneResults.totalPruned} 条`);

    if (!dryRun) {
      optResults = checkpointAndOptimize(db, { checkpoint, vacuum });
      console.log(`[DB Maintenance] 优化操作完成: ${optResults.actions.join(', ')}`);
    }
  } finally {
    db.close();
  }

  const afterStats = getDbStorageStats(dbPath);

  const report = {
    timestamp: new Date().toISOString(),
    before: {
      fileSizeMB: beforeStats.fileSizeMB,
      walSizeMB: beforeStats.walSizeMB,
      freelistMB: beforeStats.freelistMB
    },
    after: {
      fileSizeMB: afterStats.fileSizeMB,
      walSizeMB: afterStats.walSizeMB,
      freelistMB: afterStats.freelistMB
    },
    pruneResults,
    optResults
  };

  return report;
}

// CLI 驱动支持
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const isStats = args.includes('--stats');
  const isPrune = args.includes('--prune');
  const isDryRun = args.includes('--dry-run');
  const isVacuum = args.includes('--vacuum');
  const daysIdx = args.indexOf('--days');
  const retentionDays = daysIdx !== -1 && args[daysIdx + 1] ? parseInt(args[daysIdx + 1], 10) : 14;

  if (isStats || args.length === 0) {
    const stats = getDbStorageStats();
    console.log("\n=================== DB STORAGE STATS ===================");
    console.log(`Path: ${stats.dbPath}`);
    console.log(`DB File Size: ${stats.fileSizeMB} MB`);
    console.log(`WAL File Size: ${stats.walSizeMB} MB`);
    console.log(`Freelist: ${stats.freelistCount} pages (${stats.freelistMB} MB)`);
    console.log(`Journal Mode: ${stats.journalMode} | Auto Vacuum: ${stats.autoVacuum}`);
    console.log(`Orphans: ${stats.orphanEmbeddings} embeddings, ${stats.orphanAdjacency} adjacency`);
    console.log("\nTop Tables (Rows & Size):");
    stats.tables
      .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
      .slice(0, 15)
      .forEach(t => {
        const sizeStr = t.sizeMB !== undefined ? `${t.sizeMB} MB` : 'N/A';
        console.log(`  - ${t.name.padEnd(30)}: ${String(t.rowCount).padStart(7)} rows | ${sizeStr}`);
      });
    console.log("========================================================\n");
  }

  if (isPrune || isVacuum) {
    const report = runMaintenance({
      retentionDays,
      dryRun: isDryRun,
      vacuum: isVacuum,
      checkpoint: true
    });
    console.log("\nMaintenance Summary:", JSON.stringify(report, null, 2));
  }
}
