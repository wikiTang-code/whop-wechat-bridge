/**
 * REQ-034: CSRF / Origin / DNS-rebinding gate for localhost ops HTTP.
 */
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  isLoopbackHostHeader,
  isLoopbackOrigin,
  checkLocalOpsHttpGate,
} from '../tools/local-ops/http-guard.js';
import { createLocalOpsHttpServer } from '../tools/local-ops/http-server.js';
import { createGateway } from '../tools/local-ops/gateway.js';
import { createConfirmStore } from '../tools/local-ops/confirm.js';
import { createBrokerAdapter } from '../tools/local-ops/adapters/broker.js';
import { loadCatalog } from '../tools/local-ops/load-catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const opsDir = path.resolve(here, '../tools/local-ops');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Unit: Host / Origin helpers
assert(isLoopbackHostHeader('127.0.0.1:18789', 18789), 'host ipv4');
assert(isLoopbackHostHeader('localhost:18789', 18789), 'host localhost');
assert(!isLoopbackHostHeader('evil.example:18789', 18789), 'dns rebind host rejected');
assert(!isLoopbackHostHeader('127.0.0.1:9999', 18789), 'port mismatch');
assert(isLoopbackOrigin('http://127.0.0.1:18789', 18789), 'origin ok');
assert(!isLoopbackOrigin('https://evil.example', 18789), 'evil origin');
assert(!isLoopbackOrigin('http://127.0.0.1', 18789), 'implicit port rejected');

const fakeReq = (headers, remote = '127.0.0.1') => ({
  headers,
  socket: { remoteAddress: remote },
});

assert(
  checkLocalOpsHttpGate(fakeReq({ host: 'evil.com', origin: 'http://evil.com' }), { listenPort: 18789 }).code === 'bad_host',
  'rebinding host',
);
assert(
  checkLocalOpsHttpGate(fakeReq({ host: '127.0.0.1:18789', origin: 'https://evil.com' }), { listenPort: 18789 }).code === 'bad_origin',
  'csrf cross origin',
);
assert(
  checkLocalOpsHttpGate(fakeReq({ host: '127.0.0.1:18789', 'x-local-ops': '1' }), { listenPort: 18789 }).ok,
  'cli header ok',
);
assert(
  checkLocalOpsHttpGate(
    fakeReq({ host: '127.0.0.1:18789', origin: 'http://127.0.0.1:18789' }),
    { listenPort: 18789, csrfToken: 'abc', requireCsrf: true },
  ).code === 'bad_csrf',
  'csrf required',
);
assert(
  checkLocalOpsHttpGate(
    fakeReq({
      host: '127.0.0.1:18789',
      origin: 'http://127.0.0.1:18789',
      'x-csrf-token': 'abc',
    }),
    { listenPort: 18789, csrfToken: 'abc', requireCsrf: true },
  ).ok,
  'csrf pass',
);

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body || null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        host: `127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
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
    if (payload) req.write(payload);
    req.end();
  });
}

const confirmPath = path.join(opsDir, 'state', '_test_confirm_req034.json');
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }

const catalog = loadCatalog(path.join(opsDir, 'catalog.yaml'));
const csrfToken = 'testcsrf034tokenhexdeadbeefcafe001122';
const gateway = createGateway({
  catalog,
  confirmStore: createConfirmStore({ persistPath: confirmPath }),
  adapters: {
    broker: createBrokerAdapter({
      getAccountBalances: async () => ({ cash: 9, power: 9 }),
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

const { server } = createLocalOpsHttpServer({
  gateway,
  env: {},
  host: '127.0.0.1',
  port: 0,
  csrfToken,
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const bound = server.address().port;

const health = await request(bound, 'GET', '/healthz');
assert(health.status === 200, 'healthz ok');

const ui = await request(bound, 'GET', '/ui');
assert(ui.status === 200, 'ui ok');
assert(ui.body.includes(csrfToken), 'csrf embedded');
assert(String(ui.headers['set-cookie'] || '').includes('local_ops_csrf='), 'csrf cookie');

const evilHost = await request(bound, 'POST', '/api/ops/invoke', JSON.stringify({ id: 'broker.lb.account' }), {
  host: `evil.example:${bound}`,
  'x-local-ops': '1',
});
assert(evilHost.status === 403 && JSON.parse(evilHost.body).code === 'bad_host', 'dns rebind blocked');

const evilOrigin = await request(bound, 'POST', '/api/ops/invoke', JSON.stringify({ id: 'broker.lb.account' }), {
  origin: 'https://evil.example',
  'x-local-ops': '1',
  'x-csrf-token': csrfToken,
});
assert(evilOrigin.status === 403 && JSON.parse(evilOrigin.body).code === 'bad_origin', 'evil origin blocked');

const noGate = await request(bound, 'POST', '/api/ops/invoke', JSON.stringify({ id: 'broker.lb.account' }), {});
assert(noGate.status === 403, 'bare post blocked');

const cliOk = await request(bound, 'POST', '/api/ops/invoke', JSON.stringify({ id: 'broker.lb.account' }), {
  'x-local-ops': '1',
});
assert(cliOk.status === 200 && JSON.parse(cliOk.body).data.cash === 9, 'cli invoke ok');

const browserOk = await request(bound, 'POST', '/api/ops/invoke', JSON.stringify({ id: 'broker.lb.account' }), {
  origin: `http://127.0.0.1:${bound}`,
  'x-csrf-token': csrfToken,
});
assert(browserOk.status === 200 && JSON.parse(browserOk.body).ok, 'browser csrf ok');

const options = await request(bound, 'OPTIONS', '/api/ops/invoke');
assert(options.status === 405, 'no cors preflight');

server.close();
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
console.log('test_http_guard_req034: PASS');
