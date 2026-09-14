/**
 * REQ-006 / P6: localhost ops UI on :18789
 */
import http from 'http';
import { createLocalOpsHttpServer } from '../tools/local-ops/http-server.js';
import { createGateway } from '../tools/local-ops/gateway.js';
import { createConfirmStore } from '../tools/local-ops/confirm.js';
import { createBrokerAdapter } from '../tools/local-ops/adapters/broker.js';
import { loadCatalog } from '../tools/local-ops/load-catalog.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const opsDir = path.resolve(here, '../tools/local-ops');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const confirmPath = path.join(opsDir, 'state', '_test_confirm_req006.json');
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }

const catalog = loadCatalog(path.join(opsDir, 'catalog.yaml'));
const gateway = createGateway({
  catalog,
  confirmStore: createConfirmStore({ persistPath: confirmPath }),
  adapters: {
    broker: createBrokerAdapter({
      getAccountBalances: async () => ({ cash: 1, power: 2 }),
      getActivePositions: async () => [],
      getTodayOrders: async () => [],
      probe: async () => false,
    }),
    gex: { invoke: async () => ({ stub: true }) },
    lm: { invoke: async () => ({ stub: true }) },
    dash: { invoke: async () => ({ stub: true }) },
    ssh: { invoke: async () => ({ stub: true }) },
  },
});

const { server, port } = createLocalOpsHttpServer({
  gateway,
  env: {},
  host: '127.0.0.1',
  port: 0,
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const bound = server.address().port;

const health = await request(bound, 'GET', '/healthz');
assert(health.status === 200, 'healthz');
assert(JSON.parse(health.body).ui === '/ui', 'ui path advertised');

const ui = await request(bound, 'GET', '/ui');
assert(ui.status === 200, 'ui status');
assert(ui.headers['content-type']?.includes('text/html'), 'html');
assert(ui.body.includes('Local Ops'), 'ui title');
assert(ui.body.includes('/api/ops/invoke'), 'ui posts invoke');

const invoke = await request(
  bound,
  'POST',
  '/api/ops/invoke',
  JSON.stringify({ id: 'broker.lb.account', args: {} }),
);
assert(invoke.status === 200, 'invoke status');
const inv = JSON.parse(invoke.body);
assert(inv.ok && inv.data.cash === 1, 'invoke account');

const denied = await request(
  bound,
  'POST',
  '/api/ops/invoke',
  JSON.stringify({ id: 'broker.place_order', args: {} }),
);
assert(denied.status === 400 || JSON.parse(denied.body).denied, 'place_order blocked');

server.close();
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
console.log('test_ops_ui_req006: PASS');
