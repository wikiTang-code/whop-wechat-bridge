import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { WslLlamaAdapter } from '../tools/ai-runtime-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUPERVISOR_SCRIPT = path.join(__dirname, '../tools/wsl-llama-supervisor.js');

console.log('===========================================================');
console.log('🧪 启动 WSL2 Llama Supervisor 进程守护与生命周期单测');
console.log('===========================================================\n');

// 1. 在独立子进程中启动 Supervisor 服务 (端口 18080，避免冲突与同线程死锁)
console.log('[测试 1] 在独立子进程启动 Supervisor 管理服务 (18080)...');
const supProcess = spawn(process.execPath, [SUPERVISOR_SCRIPT], {
  env: { ...process.env, WSL_SUPERVISOR_PORT: '18080', WSL_SUPERVISOR_ALLOW_MOCK: '1' },
  stdio: 'inherit'
});

// 优雅等待服务监听就绪
await new Promise(resolve => setTimeout(resolve, 800));
console.log('  ✅ Supervisor 独立守护子进程已启动 (PID:', supProcess.pid, ')');

const adapter = new WslLlamaAdapter({ supervisorPort: 18080 });

function cleanupAndExit(code = 0) {
  try { supProcess.kill('SIGTERM'); } catch (_) {}
  process.exit(code);
}

// 2. 探活测试
console.log('\n[测试 2] 验证健康探活 healthCheck()...');
const isHealthy = adapter.healthCheck();
if (!isHealthy) {
  console.error('❌ healthCheck 失败');
  cleanupAndExit(1);
}
console.log('  ✅ healthCheck 通过: HTTP 200');

// 3. 初始空闲状态验证
console.log('\n[测试 3] 验证初始模型列表为空 (无挂载进程)...');
const initialModels = adapter.ps();
if (initialModels.length !== 0) {
  console.error('❌ 初始模型状态不为空:', initialModels);
  cleanupAndExit(1);
}
console.log('  ✅ 初始状态正确: 0 个进程运行');

// 4. 真实拉起进程测试
console.log('\n[测试 4] 通过 Adapter 触发 load(\'qwen2.5-14b-instruct\')...');
const loadRes = adapter.load('qwen2.5-14b-instruct');
if (!loadRes.success) {
  console.error('❌ loadModel 失败:', loadRes);
  cleanupAndExit(1);
}
console.log('  ✅ 进程拉起成功:', loadRes.message);

const runningModels = adapter.ps();
if (runningModels.length !== 1 || runningModels[0].identifier !== 'qwen2.5-14b-instruct') {
  console.error('❌ 运行模型列表不符合预期:', runningModels);
  cleanupAndExit(1);
}
console.log('  ✅ 运行模型检测通过:', runningModels[0].identifier);

// 5. 进程级卸载与显存排空测试
console.log('\n[测试 5] 通过 Adapter 触发 unload(\'qwen2.5-14b-instruct\')...');
const unloadRes = adapter.unload('qwen2.5-14b-instruct');
if (!unloadRes.success) {
  console.error('❌ unloadModel 失败:', unloadRes);
  cleanupAndExit(1);
}
console.log('  ✅ 进程终止与显存排空成功:', unloadRes.message);

const afterUnloadModels = adapter.ps();
if (afterUnloadModels.length !== 0) {
  console.error('❌ 卸载后模型残留:', afterUnloadModels);
  cleanupAndExit(1);
}
console.log('  ✅ 显存已排空，模型列表归零');

// 6. 优雅关闭服务
cleanupAndExit(0);
console.log('\n===========================================================');
console.log('🎉 WSL2 Llama Supervisor 进程级生命周期单测全部 PASS！');
console.log('===========================================================');
