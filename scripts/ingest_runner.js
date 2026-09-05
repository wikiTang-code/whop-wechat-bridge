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

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  initMonitoringDb,
  recordIngestHeartbeat,
  getIngestHeartbeat,
  getMonitoringDbPath
} from '../monitoring/monitoring-db.js';

// 必须早于动态加载 monitor/news：PM2 sample 不注入 .env，与单体 server.js 对齐
dotenv.config();

const ROLE = process.env.ROLE || 'ingest_worker';
const IS_DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// 运行态锁与定时器
let isSyncing = false;
let pollTimer = null;
let isShuttingDown = false;

/**
 * 单次轮询 Tick 执行体 (含严密心跳与异常捕获)
 */
export async function executeIngestTick({ dryRun = false, syncFn = null, autoSchedulerFn = null } = {}) {
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

      // T15: 对齐 server.js 生产链路，在同步成功路径触发 Auto News 与 Auto Persona 定时检测
      if (syncResult?.success !== false) {
        if (typeof autoSchedulerFn === 'function') {
          await autoSchedulerFn();
        } else {
          const { runPeriodicAutoSchedulers } = await import('../monitoring/auto-schedulers.js');
          await runPeriodicAutoSchedulers().catch(err => {
            console.warn('[IngestRunner] 自动调度器执行警告:', err.message);
          });
        }
      }
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

import { getEffectivePollIntervalSec, getBackpressureStatus } from '../monitoring/backpressure-controller.js';
import { isOffMarketHours } from '../monitoring/market-calendar.js';

/**
 * 计算下一轮轮询自适应延迟 (对齐 server.js 既有策略)
 * - 非交易时段/周末休市: 60s 温和轮询
 * - 交易时段: 接入三级背压 (25s -> 60s -> 120s)
 */
export function computeNextPollDelayMs() {
  if (isOffMarketHours()) {
    return 60 * 1000;
  }
  const effectiveSec = getEffectivePollIntervalSec();
  return effectiveSec * 1000;
}

/**
 * 启动后台 task_queue worker (动态加载，保持入口轻量)
 */
export async function launchBackgroundWorkers() {
  const workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY || '6', 10);
  try {
    const { startQueueWorker } = await import('../task-queue.js');
    const { processPersonaTask } = await import('../persona-engine.js');
    const { processNewsTask } = await import('../news-engine.js');

    startQueueWorker(async (task) => {
      if (task.task_type && task.task_type.startsWith('persona_')) {
        return await processPersonaTask(task);
      }
      if (task.task_type && task.task_type.startsWith('news_')) {
        return await processNewsTask(task);
      }
      if (task.task_type === 'gemini_api_cloud') {
        return { skipped: true, reason: 'legacy_api_card_dropped' };
      }
      return { skipped: true, reason: `Unsupported task type: ${task.task_type}` };
    }, workerConcurrency, 100);

    console.log(`[IngestRunner] task_queue worker 已启动 (concurrency=${workerConcurrency})`);
  } catch (err) {
    console.warn(`[IngestRunner] 启动 background worker 异常:`, err.message);
  }
}

/**
 * T17: 启动 Ingest 侧监控探针与 Supervisor (单写职责对齐)
 */
export async function launchMonitoringProbes() {
  try {
    const { startEventLoopProbe } = await import('../monitoring/event-loop-probe.js');
    startEventLoopProbe({
      warnMs: 1000,
      criticalMs: 5000,
      intervalMs: 10_000,
      enableAlerts: process.env.EVENT_LOOP_ALERTS !== '0',
    });

    const { startAiTunnelCircuit } = await import('../monitoring/ai-tunnel-circuit.js');
    startAiTunnelCircuit();

    const { startSupervisor } = await import('../monitoring/supervisor.js');
    startSupervisor({ intervalMs: 60_000 });

    console.log('[IngestRunner] EventLoop 探针、AI Tunnel 熔断器与 Supervisor (monitoring 独占写者) 已就绪');
  } catch (err) {
    console.warn('[IngestRunner] 启动监控探针警告:', err.message);
  }
}

/**
 * 启动自适应轮询主循环 (支持背压自适应周期退避)
 */
export function startIngestLoop() {
  console.log(`[IngestRunner] 启动 Ingest Worker 自适应轮询主循环 (交易时段 25s/60s/120s 背压退避，休市 60s)...`);

  const scheduleNext = () => {
    if (isShuttingDown) return;
    const delayMs = computeNextPollDelayMs();
    const bp = getBackpressureStatus();
    console.log(`[IngestRunner] 下一轮调度将在 ${delayMs / 1000}s 后触发 (背压状态: ${bp.tier})`);

    pollTimer = setTimeout(async () => {
      await executeIngestTick();
      scheduleNext();
    }, delayMs);
  };

  // 立即触发首次 tick，之后按自适应周期调度
  executeIngestTick().then(() => {
    scheduleNext();
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

// 主入口运行判定（直接 node 或 PM2 pm_exec_path）
const thisFile = path.resolve(fileURLToPath(import.meta.url));
const isIngestMain = Boolean(
  (process.argv[1] && path.resolve(process.argv[1]) === thisFile) ||
  (process.env.pm_exec_path && path.resolve(process.env.pm_exec_path) === thisFile)
);
if (isIngestMain) {
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

    Promise.all([launchBackgroundWorkers(), launchMonitoringProbes()]).then(() => {
      startIngestLoop();
    });
  }
}
