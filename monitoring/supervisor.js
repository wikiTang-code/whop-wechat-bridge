/**
 * @file monitoring/supervisor.js
 * @description P1-7: 统一监控调度器 (Supervisor)
 * 协调子系统探针状态机、低频指标采样落盘至 monitoring.db，与 alert-sink 边沿告警联动。
 */

import { initMonitoringDb, recordHealthEvent, recordMetricSample } from './monitoring-db.js';
import { checkQueueHealth, getQueueSnapshot } from './queue-watermark-probe.js';
import { getEventLoopSnapshot } from './event-loop-probe.js';
import { sendAlert } from './alert-sink.js';

let supervisorRunning = false;
let supervisorTimer = null;
let lastQueueLevel = 'ok';

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
