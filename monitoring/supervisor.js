/**
 * @file monitoring/supervisor.js
 * @description P1-7: 统一监控调度器 (Supervisor)
 * 协调子系统探针状态机、低频指标采样落盘至 monitoring.db，与 alert-sink 边沿告警联动。
 */

import { initMonitoringDb, recordHealthEvent, recordMetricSample } from './monitoring-db.js';
import { checkQueueHealth, getQueueSnapshot } from './queue-watermark-probe.js';
import { checkAssetFreshness, getAssetFreshnessSnapshot } from './asset-freshness-probe.js';
import { checkPushPipelineHealth } from './push-latency-probe.js';
import { getEventLoopSnapshot } from './event-loop-probe.js';
import { sendAlert } from './alert-sink.js';
import { isOffMarketHours, isWeekendOrHoliday } from './market-calendar.js';
import { spawn } from 'child_process';
import path from 'path';

let supervisorRunning = false;
let supervisorTimer = null;
let lastQueueLevel = 'ok';
let lastAssetLevel = 'ok';
let lastPushLevel = 'ok';
let lastAutoSyncAt = 0;
const AUTO_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24小时冷却保护

export function tryTriggerOfflineAutoSync(reason = '') {
  // 严守纪律：盘中绝不触发；默认保持静默，仅在收盘后且显式开启时才允许自动拉起
  if (process.env.ENABLE_AUTO_OFFLINE_SYNC !== '1') {
    return { triggered: false, reason: 'disabled_by_default' };
  }

  if (!isWeekendOrHoliday()) {
    return { triggered: false, reason: 'waiting_market_close' };
  }

  const now = Date.now();
  if (now - lastAutoSyncAt < AUTO_SYNC_COOLDOWN_MS) {
    return { triggered: false, reason: 'in_cooldown' };
  }

  // 严格恪守 R4：脱壳独立进程拉起，主服务 0 内存损耗
  try {
    const scriptPath = path.resolve('scripts/run_offline_asset_sync.js');
    const child = spawn(process.execPath, [scriptPath, '--force'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    lastAutoSyncAt = now;
    console.log(`[Supervisor] 🌟 已自动派生离线同步自愈任务 (PID=${child.pid}, 原因=${reason})`);

    recordHealthEvent({
      subsystem: 'assets',
      prevLevel: 'critical',
      level: 'healing_triggered',
      detail: `触发自动离线同步自愈 (PID=${child.pid}): ${reason}`,
      evidence: { triggeredAt: now, pid: child.pid },
    });

    return { triggered: true, pid: child.pid };
  } catch (err) {
    console.warn('[Supervisor] 触发自愈失败:', err.message);
    return { triggered: false, error: err.message };
  }
}

export function startSupervisor({ intervalMs = 60_000 } = {}) {
  if (supervisorRunning) {
    return { already: true };
  }
  supervisorRunning = true;

  // 确保独立时序库已就绪 (R3)
  initMonitoringDb();

  const tick = async () => {
    try {
      // 1. 探测队列健康度
      const qSnap = checkQueueHealth();

      // 2. 获取事件循环最新体征
      const loopSnap = getEventLoopSnapshot();

      // 3. 采样落盘 (每分钟一次，绝不压迫 SQLite)
      const memoryRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      recordMetricSample({
        eventLoopMeanMs: loopSnap.meanMs,
        eventLoopP99Ms: loopSnap.p99Ms,
        eventLoopMaxMs: loopSnap.maxMs,
        memoryRssMb,
        mediaPending: qSnap.mediaPending,
        totalPending: qSnap.totalPending,
      });

      // 4. 队列状态机边沿判定
      const currentLevel = qSnap.status || 'ok';
      if (currentLevel !== lastQueueLevel) {
        // 记录边沿事件到独立库 (R3)
        recordHealthEvent({
          subsystem: 'queues',
          prevLevel: lastQueueLevel,
          level: currentLevel,
          detail: qSnap.detail || qSnap.summary,
          evidence: {
            mediaPending: qSnap.mediaPending,
            totalPending: qSnap.totalPending,
            queues: qSnap.queues,
          },
        });

        // 向企业微信发送边沿告警
        if (currentLevel === 'critical' || currentLevel === 'warn') {
          await sendAlert({
            subsystem: 'queues',
            level: currentLevel,
            title: currentLevel === 'critical' ? '处理队列严重积压' : '处理队列积压预警',
            detail: qSnap.detail || qSnap.summary,
            evidence: qSnap,
            suggestion: '检查下游消费 Worker 状态或网络媒体下载连通性',
          });
        } else if (currentLevel === 'ok' && lastQueueLevel !== 'ok') {
          await sendAlert({
            subsystem: 'queues',
            level: 'ok',
            title: '处理队列积压',
            detail: `已恢复正常: ${qSnap.summary}`,
            evidence: qSnap,
          });
        }
        lastQueueLevel = currentLevel;
      }

      // 5. 离线资产新鲜度边沿判定
      const assetSnap = checkAssetFreshness();
      const currentAssetLevel = assetSnap.status || 'ok';
      if (currentAssetLevel !== lastAssetLevel) {
        recordHealthEvent({
          subsystem: 'assets',
          prevLevel: lastAssetLevel,
          level: currentAssetLevel,
          detail: assetSnap.summary,
          evidence: assetSnap.assets,
        });

        if (currentAssetLevel === 'critical' || currentAssetLevel === 'warn') {
          await sendAlert({
            subsystem: 'assets',
            level: currentAssetLevel,
            title: currentAssetLevel === 'critical' ? '离线核心资产严重滞后' : '离线资产新鲜度预警',
            detail: assetSnap.summary,
            evidence: assetSnap.assets,
            suggestion: '检查系统 cron 或离线资产生成脚本执行状态',
          });

          if (currentAssetLevel === 'critical') {
            // 尝试触发离线自愈（严守休市窗口 + ENABLE_AUTO_OFFLINE_SYNC=1 门禁 + 24h 冷却保护）
            tryTriggerOfflineAutoSync(assetSnap.summary);
          }
        } else if (currentAssetLevel === 'ok' && lastAssetLevel !== 'ok') {
          await sendAlert({
            subsystem: 'assets',
            level: 'ok',
            title: '离线资产新鲜度',
            detail: `已恢复正常: ${assetSnap.summary}`,
            evidence: assetSnap.assets,
          });
        }
        lastAssetLevel = currentAssetLevel;
      }

      // 6. 推送与交易链路边沿判定 (P1-10)
      const pushSnap = checkPushPipelineHealth();
      const currentPushLevel = pushSnap.status || 'ok';
      if (currentPushLevel !== lastPushLevel) {
        recordHealthEvent({
          subsystem: 'pushPipeline',
          prevLevel: lastPushLevel,
          level: currentPushLevel,
          detail: pushSnap.summary,
          evidence: pushSnap,
        });

        if (currentPushLevel === 'critical' || currentPushLevel === 'warn') {
          await sendAlert({
            subsystem: 'pushPipeline',
            level: currentPushLevel,
            title: currentPushLevel === 'critical' ? '大V推送链路严重受阻/时延过高' : '大V推送链路时延预警',
            detail: pushSnap.summary,
            evidence: pushSnap,
            suggestion: '检查企业微信 Webhook 连通性、Whop 轮询周期或网络代理',
          });
        } else if (currentPushLevel === 'ok' && lastPushLevel !== 'ok') {
          await sendAlert({
            subsystem: 'pushPipeline',
            level: 'ok',
            title: '大V推送链路',
            detail: `已恢复正常: ${pushSnap.summary}`,
            evidence: pushSnap,
          });
        }
        lastPushLevel = currentPushLevel;
      }
    } catch (err) {
      console.warn('[Supervisor] 巡检异常:', err.message);
    }
  };

  // 启动即首次采样
  setTimeout(tick, 2000).unref?.();

  supervisorTimer = setInterval(tick, intervalMs);
  if (typeof supervisorTimer.unref === 'function') {
    supervisorTimer.unref();
  }

  console.log(`[Supervisor] started (periodic inspection every ${intervalMs / 1000}s)`);
  return { started: true };
}

export function stopSupervisor() {
  if (supervisorTimer) {
    clearInterval(supervisorTimer);
    supervisorTimer = null;
  }
  supervisorRunning = false;
}

export function getSupervisorStats() {
  return {
    running: supervisorRunning,
    lastQueueLevel,
    queueSnapshot: getQueueSnapshot(),
  };
}
