/**
 * @file test/test_tunnel_launcher.js
 * @description P1-11 / T16 / P2-12e 单元测试：验证 Cloudflare Tunnel 开关、URL 状态持久化与 /health 字段
 */

import fs from 'fs';
import path from 'path';
import {
  isTunnelEnabled,
  startCloudflareTunnel,
  stopCloudflareTunnel,
  getTunnelStatus,
  setMockTunnelState,
  getTunnelStateFilePath,
} from '../monitoring/tunnel-launcher.js';
import { buildHealthPayload } from '../monitoring/health.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`[AssertionFailed] ${msg}`);
}

async function run() {
  console.log('--- 开始执行 T16 / P2-12e 测试: test_tunnel_launcher ---');

  const stateFilePath = getTunnelStateFilePath();
  if (fs.existsSync(stateFilePath)) fs.unlinkSync(stateFilePath);

  // 1. 默认配置下：必须处于关闭状态 (默认 off)
  console.log('1. 验证默认配置下 Tunnel 保持关闭...');
  delete process.env.ENABLE_TUNNEL;
  assert(isTunnelEnabled() === false, 'isTunnelEnabled must default to false');

  const resDefault = startCloudflareTunnel(8085);
  assert(resDefault === null, 'startCloudflareTunnel should return null when disabled');

  const statusOff = getTunnelStatus();
  assert(statusOff.status === 'off', 'getTunnelStatus should return off by default');
  assert(statusOff.enabled === false, 'enabled should be false');
  assert(statusOff.url === null, 'url should be null when off');

  const healthDefault = buildHealthPayload();
  assert(healthDefault.subsystems.tunnel, 'health payload must contain subsystems.tunnel');
  assert(healthDefault.subsystems.tunnel.status === 'off', 'subsystems.tunnel.status should be off');
  console.log('   ✅ 默认 off 验证通过：未开启开关时绝不启动子进程，/health 返回 status: off');

  // 2. 验证开关开启生效与 URL 缺失时的 warn
  console.log('2. 验证 ENABLE_TUNNEL=1 但无有效 URL 时的 warn 告警状态...');
  process.env.ENABLE_TUNNEL = '1';
  assert(isTunnelEnabled() === true, 'isTunnelEnabled should be true when ENABLE_TUNNEL=1');

  const statusWarn = getTunnelStatus();
  assert(statusWarn.status === 'warn', 'getTunnelStatus should be warn when enabled without url');
  assert(statusWarn.enabled === true, 'enabled should be true');
  assert(statusWarn.url === null, 'url should be null');

  const healthWarn = buildHealthPayload();
  assert(healthWarn.subsystems.tunnel.status === 'warn', 'health subsystems.tunnel should reflect warn');
  assert(healthWarn.ok === false, 'overall ok should be false when tunnel is warn');
  assert(healthWarn.status === 'warn', 'overall status should be warn');
  console.log('   ✅ ENABLE_TUNNEL=1 无 URL 触发 warn 判定验证通过！');

  // 3. 验证 P2-12e: URL 成功获得时的写盘持久化与 /health 正常暴露
  console.log('3. 验证 Tunnel URL 提取成功时的写盘持久化与 /health 正常字段...');
  const testUrl = 'https://whop-test-tunnel-12e.trycloudflare.com';
  setMockTunnelState({ url: testUrl, status: 'ok', updatedAtMs: Date.now() });

  assert(fs.existsSync(stateFilePath), 'tunnel_url.json must be written to disk');
  const diskData = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  assert(diskData.url === testUrl, `file url must match testUrl, got ${diskData.url}`);
  assert(diskData.status === 'ok', 'file status must be ok');
  assert(typeof diskData.updatedAtMs === 'number', 'updatedAtMs must be a number');

  const statusOk = getTunnelStatus();
  assert(statusOk.status === 'ok', 'status should be ok when url is present');
  assert(statusOk.url === testUrl, 'url should match testUrl');

  const healthOk = buildHealthPayload();
  assert(healthOk.subsystems.tunnel.status === 'ok', 'subsystems.tunnel.status should be ok');
  assert(healthOk.subsystems.tunnel.url === testUrl, 'subsystems.tunnel.url should match testUrl');
  console.log('   ✅ P2-12e: Tunnel URL 落盘与 /health.subsystems.tunnel 字段对齐通过！');

  // 恢复环境
  delete process.env.ENABLE_TUNNEL;
  stopCloudflareTunnel();
  if (fs.existsSync(stateFilePath)) fs.unlinkSync(stateFilePath);

  console.log('\n🎉 ALL T16 / P2-12e TESTS PASSED: test_tunnel_launcher\n');
}

run().catch(err => {
  console.error('❌ T16 / P2-12e 测试失败:', err);
  process.exit(1);
});

