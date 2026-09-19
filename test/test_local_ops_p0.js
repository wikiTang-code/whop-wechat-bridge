/**
 * P0–P3 local-ops tests: HITL for production C2, local confirm, forbidden scan.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { loadCatalog, parseCatalogYaml, validateCatalog } from '../tools/local-ops/load-catalog.js';
import { createGateway } from '../tools/local-ops/gateway.js';
import { createConfirmStore } from '../tools/local-ops/confirm.js';
import { createTunnelManager } from '../tools/local-ops/tunnel.js';
import { createGexAdapter } from '../tools/local-ops/adapters/gex.js';
import { createLmAdapter } from '../tools/local-ops/adapters/lm.js';
import { createSshAdapter } from '../tools/local-ops/adapters/ssh.js';
import { createDashAdapter } from '../tools/local-ops/adapters/dash.js';
import { FORBIDDEN_IDS, PROD_C2_IDS } from '../tools/local-ops/forbidden.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const opsDir = path.join(rootDir, 'tools', 'local-ops');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const catalog = loadCatalog(path.join(opsDir, 'catalog.yaml'));
assert(['P3', 'P4', 'P4.1', 'P5'].includes(catalog.phase), `phase P3+ (got ${catalog.phase})`);
assert(catalog.capabilities.some((c) => c.id === 'gcp.pm2_restart'), 'pm2_restart registered');
assert(catalog.capabilities.some((c) => c.id === 'gcp.deploy_align'), 'deploy_align registered');
assert(catalog.capabilities.some((c) => c.id === 'knowledge.promote.apply'), 'knowledge.promote.apply registered');
assert(PROD_C2_IDS.includes('knowledge.promote.apply'), 'promote apply is prod C2');
assert(!catalog.capabilities.some((c) => c.id === 'gcp.cutover_dual'), 'no cutover');
validateCatalog(parseCatalogYaml(fs.readFileSync(path.join(opsDir, 'catalog.yaml'), 'utf8')));

const gex = createGexAdapter({
  rootDir,
  nowFn: () => Date.parse('2026-09-06T12:00:00Z'),
  spawnImpl: () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => { child.emit('close', 0); });
    return child;
  },
  openImpl: async (t) => ({ opened: true, target: t }),
});

const tunnelState = path.join(opsDir, 'state', '_test_tunnel.json');
try { fs.unlinkSync(tunnelState); } catch { /* ignore */ }
const tunnel = createTunnelManager({
  statePath: tunnelState,
  spawnImpl: () => {
    const child = new EventEmitter();
    child.pid = 424242;
    child.unref = () => {};
    return child;
  },
});

const lm = createLmAdapter({
  probe: async () => ({ ok: true, detail: 'connect' }),
  fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  spawnImpl: (cmd, argv) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('ok\n'));
      child.emit('close', 0);
    });
    return child;
  },
  tunnelManager: tunnel,
});

const dash = createDashAdapter({
  probe: async () => true,
  openImpl: async (url) => ({ opened: true, url }),
});

const scriptCapture = {};
const ssh = createSshAdapter({
  recipesDir: path.join(opsDir, 'remote'),
  spawnImpl: (_cmd, argv) => {
    scriptCapture.argv = argv;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write(buf) { scriptCapture.script = String(buf); },
      end() {
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('{"ok":true,"action":"pm2_restart","name":"whop-web-dashboard"}'));
          child.emit('close', 0);
        });
      },
    };
    child.kill = () => {};
    return child;
  },
  timeoutMs: 2000,
});

const confirmPath = path.join(opsDir, 'state', '_test_confirm.json');
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
const confirm = createConfirmStore({ persistPath: confirmPath });
const knowledgeCalls = [];
const knowledge = {
  async invoke(id) {
    knowledgeCalls.push(id);
    return { mocked: id };
  }
};
const gw = createGateway({
  rootDir,
  catalog,
  confirmStore: confirm,
  adapters: { gex, lm, ssh, dash, knowledge },
});

// Local C2 still token-only
const needLocal = await gw.invoke('lm.unload', {});
assert(needLocal.code === 'confirm_required' && !needLocal.requires_human, 'local no human');
const localOk = await gw.invoke('lm.unload', { confirm_token: needLocal.confirm_token });
assert(localOk.ok, 'local C2 after token');

// Production C2: human gate
const needProd = await gw.invoke('gcp.pm2_restart', { name: 'whop-web-dashboard' });
assert(needProd.code === 'human_confirm_required', 'prod needs human');
assert(needProd.requires_human === true, 'requires_human flag');

// confirm without human-approve fails
const noHuman = await gw.invoke('gcp.pm2_restart', {
  name: 'whop-web-dashboard',
  confirm_token: needProd.confirm_token,
});
assert(noHuman.denied && noHuman.message === 'human_approve_required', 'block without human');

// human-approve then confirm
const approved = gw.humanApprove(needProd.confirm_token);
assert(approved.ok && approved.human_acked === true, 'human approved');
const ran = await gw.invoke('gcp.pm2_restart', {
  name: 'whop-web-dashboard',
  confirm_token: needProd.confirm_token,
});
assert(ran.ok === true, 'prod restart after HITL');
assert(scriptCapture.argv.includes('LOCAL_OPS_PM2_NAME=whop-web-dashboard'), 'env name');
assert(scriptCapture.script.includes('pm2 restart'), 'restart recipe');

// deploy_align sha validation
const needAlign = await gw.invoke('gcp.deploy_align', {
  sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});
assert(needAlign.code === 'human_confirm_required', 'align human');
gw.humanApprove(needAlign.confirm_token);
const alignExec = await gw.invoke('gcp.deploy_align', {
  sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  confirm_token: needAlign.confirm_token,
});
assert(alignExec.ok === true || alignExec.code === 'invoke_failed', 'align reached adapter');
assert(scriptCapture.argv.some((a) => String(a).startsWith('LOCAL_OPS_GIT_SHA=')), 'sha env');

const invalidName = await gw.invoke('gcp.pm2_restart', { name: 'all' });
assert(invalidName.denied && invalidName.code === 'bad_args', 'invalid pm2 name early reject');

const badShaEarly = await gw.invoke('gcp.deploy_align', { sha: 'origin/main' });
assert(badShaEarly.code === 'bad_args', 'bad sha early reject');

const needKp = await gw.invoke('knowledge.promote.apply', {});
assert(needKp.code === 'human_confirm_required', 'promote apply needs human');
const noKp = await gw.invoke('knowledge.promote.apply', { confirm_token: needKp.confirm_token });
assert(noKp.denied && noKp.message === 'human_approve_required', 'promote blocked without human');
gw.humanApprove(needKp.confirm_token);
const kpOk = await gw.invoke('knowledge.promote.apply', { confirm_token: needKp.confirm_token });
assert(kpOk.ok === true, 'promote apply after HITL');
assert(knowledgeCalls.includes('knowledge.promote.apply'), 'knowledge adapter ran');

for (const id of FORBIDDEN_IDS) {
  const r = await gw.invoke(id);
  assert(r.denied, `forbidden ${id}`);
}
assert((await gw.invoke('gcp.cutover_dual')).denied, 'cutover deferred');

// recipes: only gcp_pm2_restart may contain pm2 restart
for (const file of fs.readdirSync(path.join(opsDir, 'remote'))) {
  const text = fs.readFileSync(path.join(opsDir, 'remote', file), 'utf8');
  if (file === 'gcp_pm2_restart.sh') {
    assert(/pm2\s+restart/.test(text), 'restart recipe has restart');
    assert(!/pm2\s+delete/.test(text), 'no delete');
  } else {
    assert(!/pm2\s+restart/.test(text), `${file} must not restart`);
  }
  assert(!/bash\s+-lc/.test(text), `${file} no bash -lc`);
}

await new Promise((resolve, reject) => {
  const child = spawn('node', [path.join(opsDir, 'mcp-server.js')], {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('mcp timeout')); }, 5000);
  child.stdout.on('data', (b) => { out += b.toString('utf8'); });
  child.on('error', reject);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  const check = setInterval(() => {
    const lines = out.split('\n').filter(Boolean);
    if (lines.length < 2) return;
    try {
      const listed = JSON.parse(lines[1]);
      const names = listed.result.tools.map((t) => t.name);
      assert(names.includes('ops.confirm'), 'ops.confirm');
      assert(!names.includes('ops.human_approve'), 'human_approve not in MCP');
      assert(!names.includes('human-approve'), 'no human-approve MCP');
      clearInterval(check);
      clearTimeout(timer);
      child.kill();
      resolve();
    } catch { /* wait */ }
  }, 50);
});

try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
try { fs.unlinkSync(tunnelState); } catch { /* ignore */ }

console.log('test_local_ops_p0: PASS (P3 coverage)');
