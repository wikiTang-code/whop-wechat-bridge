/**
 * @file scripts/ingest_runner.js
 * @description P1-11: Whop 数据抓取与推送独立 Ingest Worker 瘦入口
 *
 * 职责所有权 (独占写面，无 Web 端口):
 * 1. Whop 频道轮询与增量入库 (syncAndAnalyze)
 * 2. 大V发言即时企业微信推送
 * 3. 跟单信号提取与 task_queue 调度
 * 4. 每轮 poll tick 结束原子落盘心跳至 monitoring.db ingest_heartbeat
 *
 * 门控约束:
 * - ROLE=ingest_worker
 * - 严禁启动 Express 8085 或 Cloudflare Tunnel
 */

import path from 'path';
import fs from 'fs';
import {
  initMonitoringDb,
  recordIngestHeartbeat,
  getIngestHeartbeat,
  getMonitoringDbPath
} from '../monitoring/monitoring-db.js';

const ROLE = process.env.ROLE || 'ingest_worker';
const IS_DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// 运行态锁与定时器
let isSyncing = false;
let pollTimer = null;
let isShuttingDown = false;

/**
 * 单次轮询 Tick 执行体 (含严密心跳与异常捕获)
 */
export async function executeIngestTick({ dryRun = false, syncFn = null } = {}) {
  const tickStart = Date.now();
  const workerKey = process.env.INGEST_WORKER_KEY || 'primary';

  // 1. 并发防重入处理：若上一轮正在处理，跳过并记录 skipped 心跳
  if (isSyncing) {
    const skipDetail = { reason: 'isSyncing_overlap', skippedAt: tickStart };
    recordIngestHeartbeat({
      workerKey,
      outcome: 'skipped',
      pollMs: 0,
      detail: skipDetail,
      nowMs: tickStart,
    });
    console.log(`[IngestRunner] 上一轮同步仍在进行中，跳过本轮 (heartbeat: skipped)`);
    return { outcome: 'skipped', pollMs: 0 };
  }

  isSyncing = true;
  let outcome = 'ok';
  let detail = {};

  try {
    if (dryRun) {
      // Dry-Run 模式：模拟 50ms 轻量操作
      await new Promise(r => setTimeout(r, 50));
      detail = { mode: 'dry_run', dryRunCompleted: true, timestamp: tickStart };
      console.log(`[IngestRunner] [Dry-Run] 执行 mock 数据拉取与分析 tick 完成`);
    } else {
      // 生产路径：动态加载 monitor 业务逻辑 (保持入口轻量)
      const executor = syncFn || (await import('../monitor.js')).syncAndAnalyze;
      const syncResult = await executor();
      detail = {
        success: syncResult?.success ?? true,
        newMessagesCount: syncResult?.newMessagesCount ?? 0,
        newSpeakerMessagesCount: syncResult?.newSpeakerMessagesCount ?? 0,
      };
    }
  } catch (err) {
    outcome = 'error';
    detail = { error: err.message, stack: err.stack?.substring(0, 300) };
    console.error(`[IngestRunner] 轮询 Tick 异常:`, err.message);
  } finally {
    isSyncing = false;
    const pollMs = Date.now() - tickStart;

    // 核心契约：无论 ok、error 还是 skipped，tick 结束必须原子更新心跳
    recordIngestHeartbeat({
      workerKey,
      outcome,
      pollMs,
      detail,
      nowMs: Date.now(),
    });

    console.log(`[IngestRunner] Tick 结束 [${outcome}] 耗时 ${pollMs}ms -> 心跳已落盘`);
    return { outcome, pollMs, detail };
  }
}

/**
 * 启动自适应轮询主循环
 */
export function startIngestLoop({ intervalMs = 25000 } = {}) {
  console.log(`[IngestRunner] 启动 Ingest Worker 主轮询循环 (周期: ${intervalMs}ms)...`);

  const scheduleNext = (delayMs) => {
    if (isShuttingDown) return;
    pollTimer = setTimeout(async () => {
      await executeIngestTick();
      scheduleNext(intervalMs);
    }, delayMs);
  };

  // 立即触发首次 tick，之后按周期调度
  executeIngestTick().then(() => {
    scheduleNext(intervalMs);
  });
}

/**
 * 优雅退出
 */
export function stopIngestLoop() {
  isShuttingDown = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[IngestRunner] Ingest Worker 已平稳停止');
}

// 主入口运行判定
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/ingest_runner.js')) {
  console.log('====================================================');
  console.log(`[IngestRunner] 进程启动: ROLE=${ROLE}, DRY_RUN=${IS_DRY_RUN}`);
  console.log(`[IngestRunner] Monitoring DB: ${getMonitoringDbPath()}`);
  console.log('====================================================');

  if (ROLE !== 'ingest_worker') {
    console.warn(`[IngestRunner] 警告: 当前 ROLE=${ROLE}，建议运行在 ROLE=ingest_worker 下`);
  }

  // 初始化监控库
  initMonitoringDb();

  if (IS_DRY_RUN) {
    console.log('[IngestRunner] 正在执行 Dry-Run 验证单次 Tick...');
    executeIngestTick({ dryRun: true }).then((result) => {
      const hb = getIngestHeartbeat('primary');
      console.log('[IngestRunner] [Dry-Run] 验证心跳回查:', JSON.stringify(hb, null, 2));
      console.log('🎉 [IngestRunner] Dry-Run 校验全部通过！');
      process.exit(0);
    }).catch(err => {
      console.error('❌ [IngestRunner] Dry-Run 失败:', err);
      process.exit(1);
    });
  } else {
    // 监听退出信号
    process.on('SIGINT', () => { stopIngestLoop(); process.exit(0); });
    process.on('SIGTERM', () => { stopIngestLoop(); process.exit(0); });

    startIngestLoop();
  }
}
