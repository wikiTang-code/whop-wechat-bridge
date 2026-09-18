/**
 * scripts/slm/flywheel_engine.js
 * REQ-036: 大V交易语义专有轻量 SLM 自迭代数据飞轮编排引擎
 * 
 * 核心设计：
 * 1. 感知层：动态监听 SQLite 中 follow_replay_queue 的 status = 'corrected' 增量变化；
 * 2. 决策层：对比 data/slm/flywheel_state.json 的基线，当新增人工纠错样本达到阈值 (默认 5 笔) 时触发自迭代；
 * 3. 执行层 (三阶流水线)：
 *    - Stage 1: 自动抽取并重新对齐导出训练集 (Alpaca SFT + DPO 对比对)；
 *    - Stage 2: 调度 WSL2 AMD ROCm 极速微调引擎 (train_rocm_fast.py)；
 *    - Stage 3: 运行自动化门禁对比评测 (eval_lora_vs_base.py)；
 * 4. 交付层：注册并升级适配器版本元数据，具备历史记录追踪能力。
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { exportSLMTrainingData } from './export_training_data.js';
import { gpuArbiter } from '../../tools/gpu-arbiter.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const DB_PATH = path.join(ROOT_DIR, 'whop_archive.db');
const STATE_FILE = path.join(ROOT_DIR, 'data/slm/flywheel_state.json');

// 默认触发阈值：每积累 5 笔人工纠错黄金样本即可触发一次自迭代
const DEFAULT_TRIGGER_THRESHOLD = 5;

/**
 * 读取当前飞轮状态元数据
 */
export function getFlywheelState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('[Flywheel] 读取 flywheel_state.json 异常，初始化新状态:', e.message);
    }
  }
  return {
    version: 'v1.0.0',
    last_trained_at: null,
    last_trained_corrected_count: 0,
    total_iterations: 0,
    history: []
  };
}

/**
 * 保存飞轮状态元数据
 */
export function saveFlywheelState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 查询数据库当前回放队列和纠错水位
 */
export function queryQueueMetrics(dbInstance = null) {
  const db = dbInstance || new Database(DB_PATH, { readonly: true, timeout: 5000 });
  try {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM follow_replay_queue 
      GROUP BY status
    `).all();

    const stats = {
      pending: 0,
      corrected: 0,
      confirmed_skip: 0,
      classified_strategy: 0,
      total: 0
    };

    for (const c of counts) {
      if (stats[c.status] !== undefined) {
        stats[c.status] = c.count;
      }
      stats.total += c.count;
    }
    stats.reviewed = stats.total - stats.pending;
    return stats;
  } finally {
    if (!dbInstance) {
      try { db.close(); } catch (_) {}
    }
  }
}

/**
 * 诊断与检查飞轮触发条件
 */
export function checkFlywheel(threshold = DEFAULT_TRIGGER_THRESHOLD) {
  const state = getFlywheelState();
  const metrics = queryQueueMetrics();

  const delta = metrics.corrected - (state.last_trained_corrected_count || 0);
  const shouldTrigger = delta >= threshold;

  return {
    state,
    metrics,
    threshold,
    delta,
    shouldTrigger,
    summary: `当前已审纠错单据: ${metrics.corrected} 笔 | 上次训练水位: ${state.last_trained_corrected_count} 笔 | 增量: +${delta} 笔 (阈值: ${threshold})`
  };
}

/**
 * 执行系统命令辅助函数 (针对 WSL2 ROCm 环境)
 */
function runCommandAsync(cmd, args, envVars = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[Flywheel Exec] ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
      cwd: ROOT_DIR,
      shell: true,
      env: { ...process.env, ...envVars }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`命令执行失败 (exit code ${code}): ${stderr || stdout}`));
      }
    });
  });
}

/**
 * 运行完整飞轮自迭代流水线
 */
export async function executeFlywheelPipeline(options = {}) {
  const { force = false, threshold = DEFAULT_TRIGGER_THRESHOLD } = options;
  console.log('===========================================================');
  console.log('🔄 启动 REQ-036 大V交易语义 SLM 数据自迭代飞轮流水线');
  console.log('===========================================================\n');

  const check = checkFlywheel(threshold);
  console.log(`[Flywheel] 水位探测: ${check.summary}`);

  if (!check.shouldTrigger && !force) {
    console.log(`[Flywheel] ⏳ 增量 (+${check.delta}) 未达到阈值 (${threshold})，无需触发重新微调。飞轮休眠保持中。`);
    return { success: false, reason: 'threshold_not_met', check };
  }

  if (force) {
    console.log('[Flywheel] ⚡ 强制触发模式 (Force Trigger)，跳过增量阈值判定。');
  }

  const startTime = Date.now();

  // -------------------------------------------------------------
  // Stage 1: 数据集自动抽取与格式对齐
  // -------------------------------------------------------------
  console.log('\n--- [Stage 1/3] 数据集自动抽取与格式对齐 ---');
  let exportResult;
  try {
    exportResult = exportSLMTrainingData();
  } catch (err) {
    console.error('[Flywheel ERROR] 导出训练集失败:', err.message);
    throw err;
  }

  // -------------------------------------------------------------
  // Stage 2: WSL2 AMD ROCm 极速 LoRA 微调执行 (经由 GpuArbiter 时分轮转保护)
  // -------------------------------------------------------------
  console.log('\n--- [Stage 2/3] 调度 WSL2 AMD ROCm 极速 LoRA 增量训练 (Arbiter 显存时分调度) ---');
  const wslCommand = `cd /mnt/c/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge && export HSA_ENABLE_DXG_DETECTION=1 && export HSA_OVERRIDE_GFX_VERSION=11.0.0 && /root/openmontage_env/bin/python scripts/slm/train_rocm_fast.py`;

  let trainOut;
  try {
    trainOut = await gpuArbiter.withTrainingLock('flywheel_engine', async () => {
      return await runCommandAsync('wsl', ['--', 'bash', '-c', `"${wslCommand}"`]);
    });
    console.log('✅ ROCm 极速微调执行成功 (纯物理显存无溢出)');
  } catch (err) {
    console.error('[Flywheel ERROR] 模型训练执行异常:', err.message);
    throw err;
  }

  // -------------------------------------------------------------
  // Stage 3: 自动化质量门禁与对比评测
  // -------------------------------------------------------------
  console.log('\n--- [Stage 3/3] 运行自动化质量门禁与对比评测 ---');
  const evalCommand = `cd /mnt/c/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge && export HSA_ENABLE_DXG_DETECTION=1 && export HSA_OVERRIDE_GFX_VERSION=11.0.0 && /root/openmontage_env/bin/python scripts/slm/eval_lora_vs_base.py`;

  let evalOut;
  try {
    evalOut = await runCommandAsync('wsl', ['--', 'bash', '-c', `"${evalCommand}"`]);
    console.log('✅ 质量门禁横向评测通过');
  } catch (err) {
    console.error('[Flywheel ERROR] 自动化门禁评测异常:', err.message);
    throw err;
  }

  // -------------------------------------------------------------
  // 飞轮状态更新与版本自增
  // -------------------------------------------------------------
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const prevState = check.state;
  const nextIteration = (prevState.total_iterations || 0) + 1;
  const nextVersion = `v1.${nextIteration}.0`;

  const updatedState = {
    version: nextVersion,
    last_trained_at: new Date().toISOString(),
    last_trained_corrected_count: check.metrics.corrected,
    total_iterations: nextIteration,
    history: [
      {
        iteration: nextIteration,
        version: nextVersion,
        timestamp: new Date().toISOString(),
        duration_seconds: durationSec,
        corrected_count_at_train: check.metrics.corrected,
        delta_corrected: check.delta,
        dataset_samples: exportResult ? exportResult.total_samples : null,
        dpo_pairs: exportResult ? exportResult.dpo_contrast_pairs : null
      },
      ...(prevState.history || []).slice(0, 19)
    ]
  };

  saveFlywheelState(updatedState);
  console.log(`\n🎉 [Flywheel] 飞轮自迭代全流程闭环成功！`);
  console.log(`新版本注册: ${nextVersion} (耗时: ${durationSec}s, 包含黄金纠错: ${check.metrics.corrected} 笔)\n`);

  return {
    success: true,
    version: nextVersion,
    durationSec,
    state: updatedState
  };
}

// -------------------------------------------------------------
const isMainModule = Boolean(
  process.argv[1] && (
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('flywheel_engine.js')
  )
);

if (isMainModule) {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isForce = args.includes('--force') || args.includes('--trigger');
  const thresholdIdx = args.indexOf('--threshold');
  const threshold = thresholdIdx !== -1 && args[thresholdIdx + 1] ? parseInt(args[thresholdIdx + 1], 10) : DEFAULT_TRIGGER_THRESHOLD;

  if (isCheck) {
    const report = checkFlywheel(threshold);
    console.log('===========================================================');
    console.log('📊 [REQ-036] SLM 数据飞轮自迭代诊断报告');
    console.log('===========================================================');
    console.log(`当前适配器版本:   ${report.state.version || '未初始化'}`);
    console.log(`上次训练时间:     ${report.state.last_trained_at || '无记录'}`);
    console.log(`上次纠错样本基准: ${report.state.last_trained_corrected_count} 笔`);
    console.log(`当前已审纠错单据: ${report.metrics.corrected} 笔`);
    console.log(`当前待审剩余单据: ${report.metrics.pending} 笔 (已完成审阅: ${report.metrics.reviewed} 笔)`);
    console.log(`增量样本积累:     +${report.delta} 笔`);
    console.log(`自迭代触发阈值:   >= ${report.threshold} 笔`);
    console.log(`是否满足触发条件: ${report.shouldTrigger ? '🔥 满足 (可立即迭代)' : '⏳ 积蓄中 (未达阈值)'}`);
    console.log('===========================================================');
    process.exit(0);
  }

  executeFlywheelPipeline({ force: isForce, threshold })
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[Fatal Error]', err.message);
      process.exit(1);
    });
}

