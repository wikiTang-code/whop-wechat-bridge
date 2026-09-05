/**
 * @file scripts/run_offline_asset_sync.js
 * @description 离线资产综合自愈与同步批处理工具 (严格恪守 R4 在线/离线硬隔离)
 *
 * 核心任务：
 * 1. 离线清空 pipeline_tasks 队列 (l2a_cut, timeline) 并单调推进水位；
 * 2. 触发并刷新 Persona Playbook 战法手册重构生成；
 * 3. 进程互斥锁 (PID lock)，防并发冲突与内存堆叠；
 * 4. 独立于主服务执行，执行完毕自动退出释放内存。
 */

import fs from 'fs';
import path from 'path';
import { runOfflineBatch } from './offline_queue_worker.js';
import { generatePersonaPlaybook } from '../persona-engine.js';
import { isWeekendOrHoliday, isOffMarketHours } from '../monitoring/market-calendar.js';

const LOCK_FILE = path.resolve('data/run_offline_asset_sync.pid');

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8'), 10);
      // 检查进程是否仍在运行
      process.kill(pid, 0);
      console.log(`[OfflineSync] 检测到已有同步进程运行中 (PID=${pid})，本轮退出`);
      return false;
    } catch (_) {
      // 进程已死，锁过期，删除锁
      fs.unlinkSync(LOCK_FILE);
    }
  }

  const dir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
  return true;
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (_) {}
  }
}

export async function executeOfflineSync({ force = false } = {}) {
  const isOffHours = isOffMarketHours();
  const isHoliday = isWeekendOrHoliday();

  console.log('====================================================');
  console.log(`🚀 [OfflineSync] 启动离线资产综合同步与自愈任务 (PID=${process.pid})`);
  console.log(`📅 状态: 休市/周末=${isHoliday}, 静默窗口=${isOffHours}, 强制执行=${force}`);
  console.log('====================================================\n');

  if (!force && !isOffHours) {
    console.log('[OfflineSync] 当前处于美股主盘常规交易时段，为保全主服务，跳过重型计算');
    return { skipped: true, reason: 'rth_active' };
  }

  if (!acquireLock()) {
    return { skipped: true, reason: 'already_running' };
  }

  try {
    // 1. 消费积压队列
    console.log('[OfflineSync] 步骤 1/2: 消费积压队列并推进流水线水位...');
    const queueRes = runOfflineBatch({ batchSize: 2000 });
    console.log(`[OfflineSync] 队列处理结果: l2a=${queueRes.l2a.processed}, timeline=${queueRes.timeline.processed}`);

    // 2. 触发 Persona Playbook 战法手册生成（入队 Map-Reduce；真正落库由主进程 queue worker 完成）
    console.log('[OfflineSync] 步骤 2/2: 触发 Persona Playbook 战法手册生成...');
    let personaRes = null;
    try {
      // 周末休市默认走本地 14B Map；Reduce 仍可由引擎内部按配置兜底 Gemini
      personaRes = await generatePersonaPlaybook({
        provider: process.env.PERSONA_SYNC_PROVIDER || 'lm-studio',
        forceRefresh: true,
      });
      console.log('[OfflineSync] ✅ Persona 入队结果:', JSON.stringify({
        status: personaRes?.status,
        batchId: personaRes?.batchId,
        message: personaRes?.message,
        stats: personaRes?.stats,
      }));
    } catch (personaErr) {
      console.warn('[OfflineSync] Persona 生成触发提示:', personaErr.message);
    }

    console.log('\n✨ [OfflineSync] 离线资产综合同步任务执行完毕（Persona 若已入队，请用 scripts/check_persona_queue_status.js 盯 Reduce 落库）！');
    return { success: true, queueRes, personaRes };
  } finally {
    releaseLock();
  }
}

// 命令行直接运行入口
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const force = process.argv.includes('--force');
  executeOfflineSync({ force })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ [OfflineSync] 执行失败:', err);
      releaseLock();
      process.exit(1);
    });
}
