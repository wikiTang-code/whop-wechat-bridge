/**
 * @file test/test_tunnel_launcher.js
 * @description P1-11 / T16 单元测试：验证 Cloudflare Tunnel 开关与安全默认值
 */

import { isTunnelEnabled, startCloudflareTunnel, stopCloudflareTunnel } from '../monitoring/tunnel-launcher.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T16 测试: test_tunnel_launcher ---');

  // 1. 默认配置下：必须处于关闭状态 (默认 off)
  console.log('1. 验证默认配置下 Tunnel 保持关闭...');
  delete process.env.ENABLE_TUNNEL;
  assert(isTunnelEnabled() === false, 'isTunnelEnabled must default to false');

  const resDefault = startCloudflareTunnel(8085);
  assert(resDefault === null, 'startCloudflareTunnel should return null when disabled');
  console.log('   ✅ 默认 off 验证通过：未开启开关时绝不启动子进程');

  // 2. 验证开关开启生效
  console.log('2. 验证 ENABLE_TUNNEL=1 开关感知...');
  process.env.ENABLE_TUNNEL = '1';
  assert(isTunnelEnabled() === true, 'isTunnelEnabled should be true when ENABLE_TUNNEL=1');
  console.log('   ✅ 开关开启感知验证通过！');

  // 恢复环境
  delete process.env.ENABLE_TUNNEL;
  stopCloudflareTunnel();

  console.log('\n🎉 ALL T16 TESTS PASSED: test_tunnel_launcher\n');
}

run().catch(err => {
  console.error('❌ T16 测试失败:', err);
  process.exit(1);
});
