/**
 * @file monitoring/cleanup-hooks.js
 * @description P2-15E: 受控临时文件与日志轮转清理钩子 (R2/R5 安全减载)
 *
 * 铁律红线：
 * 1. 绝对禁止碰触 data/、data/media/ 目录与任何 *.db/*.sqlite 数据库文件；
 * 2. 仅允许清理白名单临时文件（如 /tmp/whop_*）及超龄滚动日志；
 * 3. 绝不调用 pm2 restart/stop，清理动作全程在 softDegrade 白名单中可观测。
 */

import fs from 'fs';
import path from 'path';
import { recordSoftDegradeAction, clearSoftDegradeAction } from './soft-degrade-registry.js';

export const PROTECTED_PATHS = Object.freeze([
  'data',
  'data/media',
  'data/gex',
  'monitoring.db',
  'whop_archive.db',
]);

/**
 * 执行受控的临时目录与日志安全清理
 * @param {object} [options]
 * @param {string} [options.tmpDir]
 * @param {string} [options.logsDir]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.maxAgeMs]
 * @param {number} [options.nowMs]
 * @returns {{ cleanedCount: number, bytesFreed: number, errors: string[] }}
 */
export function executeControlledLogTmpCleanup({
  tmpDir = '/tmp',
  logsDir = path.resolve('logs'),
  dryRun = false,
  maxAgeMs = 24 * 60 * 60 * 1000,
  nowMs = Date.now(),
} = {}) {
  const result = {
    cleanedCount: 0,
    bytesFreed: 0,
    errors: [],
    dryRun,
  };

  recordSoftDegradeAction({
    id: 'log_tmp_cleanup',
    level: 'warn',
    nowMs,
    reason: 'scheduled_tmp_cleanup',
    detail: `Controlled cleanup active (dryRun=${dryRun})`,
  });

  try {
    // 1. 清理临时目录下的 whop_* 临时文件
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        // 严格前缀匹配：仅限 whop_ 开头无害临时文件
        if (!file.startsWith('whop_') && !file.startsWith('whop_watchdog_') && !file.startsWith('whop_consistency_')) {
          continue;
        }

        const fullPath = path.join(tmpDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && (nowMs - stat.mtimeMs > 60_000)) { // 至少存活超过 1 分钟
            result.bytesFreed += stat.size;
            result.cleanedCount++;
            if (!dryRun) {
              fs.unlinkSync(fullPath);
            }
          }
        } catch (e) {
          result.errors.push(`tmp file ${file}: ${e.message}`);
        }
      }
    }

    // 2. 清理 logs 目录下超过 maxAgeMs 的轮转日志 (仅匹配 *.log.* 或归档日志，不删当前 active *.log)
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir);
      for (const logFile of logFiles) {
        // 保护当前活跃日志，仅清理轮转备份文件，如 app-0.log, error-2026-08.log 等
        if (!/\.(log\.\d+|old|\d{8})$/.test(logFile)) {
          continue;
        }

        const fullPath = path.join(logsDir, logFile);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && (nowMs - stat.mtimeMs > maxAgeMs)) {
            result.bytesFreed += stat.size;
            result.cleanedCount++;
            if (!dryRun) {
              fs.unlinkSync(fullPath);
            }
          }
        } catch (e) {
          result.errors.push(`log file ${logFile}: ${e.message}`);
        }
      }
    }
  } finally {
    clearSoftDegradeAction('log_tmp_cleanup');
  }

  return result;
}
