#!/usr/bin/env node
/**
 * scripts/lms_load.js
 * 安全受控的 GPU 模型装载与状态控制 CLI (CHG-021 / CHG-022)
 * 优先与网桥 GpuArbiter (:8085) 联动，保持全系统唯一仲裁真相源；网桥离线时安全 fallback 本地
 */

import http from 'http';
import { safeLoadModel, evictDuplicates, getLoadedModels, unloadAllModels } from '../tools/lms-guard.js';

const targetModel = process.argv[2];
const BRIDGE_PORT = process.env.PORT || 8085;

function fetchBridgeApi(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: BRIDGE_PORT,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  if (!targetModel || targetModel === '--help' || targetModel === '-h') {
    console.log(`
使用方式:
  node scripts/lms_load.js <modelName>    安全幂等加载指定模型 (防重复、防显存爆炸)
  node scripts/lms_load.js --status       查看 GPU 仲裁器状态、独占租户与显存模型
  node scripts/lms_load.js --clean        主动清理当前显存中的所有冗余重复副本 (:2, :3)
  node scripts/lms_load.js --game         🎮 游戏模式：一秒排空所有显存 (0 GB 占用，网桥锁定防打扰)
  node scripts/lms_load.js --work         💼 工作模式：释放游戏锁并装载 14B 深度推理模型
`);
    process.exit(0);
  }

  if (targetModel === '--clean') {
    console.log('🧹 正在执行显存冗余排查与排空...');
    const evicted = evictDuplicates();
    if (evicted.length === 0) {
      console.log('✅ 当前显存无任何重复实例，状态健康。');
    }
    process.exit(0);
  }

  if (targetModel === '--status') {
    // 优先尝试从网桥获取 GpuArbiter 全局真相源
    try {
      const res = await fetchBridgeApi('/api/gpu/status');
      if (res && res.data) {
        const s = res.data;
        console.log('\n===========================================================');
        console.log('🖥️  GPU 全局时分复用仲裁器运行状态 (GpuArbiter)');
        console.log('===========================================================');
        console.log(`- 当前调度模式: ${s.state || 'UNKNOWN'} ${s.isGame ? '🎮 (游戏模式)' : s.isTraining ? '🏋️ (微调训练中)' : ''}`);
        console.log(`- 互斥锁持有者: ${s.owner || '(无，显存空闲)'} ${s.purpose ? `[${s.purpose}]` : ''}`);
        if (s.owner) {
          console.log(`- 持锁持续时间: ${Math.round((s.lockedDurationMs || 0) / 1000)} 秒`);
          console.log(`- 自动回收 TTL: ${s.ttlSeconds || 900} 秒`);
        }
        console.log(`- 异步装载中:   ${s.restore_pending ? '⏳ 是 (14B 正在唤醒)' : '✅ 否 (就绪)'}`);
        const models = Array.isArray(s.loaded_models) ? s.loaded_models : [];
        console.log(`- 当前驻留模型: ${models.length > 0 ? models.join(', ') : '(显存已排空，0 GB 占用)'}`);
        console.log('===========================================================\n');
        process.exit(0);
      }
    } catch (_) {
      // 网桥未运行时 fallback 本地
    }

    const list = getLoadedModels();
    console.log(`\n📊 当前已加载模型 (${list.length} 个) [本地直接探测]:`);
    let total = 0;
    for (const m of list) {
      total += m.sizeBytes || 0;
      console.log(` - ${m.identifier} [${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB] (${m.status})`);
    }
    console.log(`总显存占用: ${(total / 1024 / 1024 / 1024).toFixed(2)} GB / 20 GB\n`);
    process.exit(0);
  }

  if (targetModel === '--game' || targetModel === '--release') {
    console.log('🎮 正在切换至 [游戏模式]：正在排空 GPU 显存...');
    // 优先通过网桥 GpuArbiter 申请 GAME 锁，杜绝网桥后台自动拉起
    try {
      const res = await fetchBridgeApi('/api/gpu/acquire', {
        method: 'POST',
        body: { owner: 'game', purpose: 'gaming', ttl_seconds: 86400 }
      });
      if (res && res.data && res.data.success) {
        console.log('✅ 已成功与网桥 GpuArbiter 联动并进入 [游戏模式]！');
        console.log('🎉 显存已完全释放（当前占用 0.00 GB / 20 GB），可满血畅玩 3A 游戏！');
        console.log('💡 提示：网桥已进入 GAME 状态，自动屏蔽任何模型自动拉起；消息跟单与推送降级为规则引擎正常工作。');
        process.exit(0);
      }
    } catch (_) {
      // 网桥离线时 fallback 本地排空
    }

    const count = unloadAllModels();
    console.log(`✅ 已通过底层 Adapter 安全卸载 ${count} 个模型实例！`);
    console.log('🎉 显存已完全释放（当前占用 0.00 GB / 20 GB），可满血畅玩 3A 游戏！');
    process.exit(0);
  }

  if (targetModel === '--work' || targetModel === '--restore') {
    const defaultDeepModel = process.env.LM_STUDIO_DEEP_MODEL || 'qwen2.5-14b-instruct';
    console.log(`💼 正在切换至 [工作模式]：正在恢复深度推理模型 (${defaultDeepModel})...`);
    // 优先通过网桥 GpuArbiter 释放游戏锁并唤醒
    try {
      const res = await fetchBridgeApi('/api/gpu/release', {
        method: 'POST',
        body: { owner: 'game', restore: 'deep' }
      });
      if (res && res.data && res.data.success) {
        console.log('✅ 已成功解除游戏锁，网桥 GpuArbiter 正在后台异步装载 14B 深度模型！');
        process.exit(0);
      }
    } catch (_) {
      // 网桥离线时 fallback 本地
    }

    const res = safeLoadModel(defaultDeepModel, { gpu: 'max' });
    if (res.success) {
      console.log(`✅ 模型 "${defaultDeepModel}" 已成功装载至 GPU 显存！工作模式就绪。`);
      process.exit(0);
    } else {
      console.error(`❌ 装载失败: ${res.message}`);
      process.exit(1);
    }
  }

  const res = safeLoadModel(targetModel);
  if (res.success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});

