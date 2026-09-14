/**
 * REQ-005 / P5: broker read-only catalog + adapter; never place_order.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCatalog, parseCatalogYaml, validateCatalog } from '../tools/local-ops/load-catalog.js';
import { createGateway } from '../tools/local-ops/gateway.js';
import { createConfirmStore } from '../tools/local-ops/confirm.js';
import { createBrokerAdapter } from '../tools/local-ops/adapters/broker.js';
import { FORBIDDEN_IDS } from '../tools/local-ops/forbidden.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const opsDir = path.join(rootDir, 'tools', 'local-ops');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const raw = fs.readFileSync(path.join(opsDir, 'catalog.yaml'), 'utf8');
assert(!/place_order/.test(raw), 'catalog.yaml must not contain place_order');
const catalog = loadCatalog(path.join(opsDir, 'catalog.yaml'));
validateCatalog(parseCatalogYaml(raw));
assert(catalog.phase === 'P5', `phase P5 (got ${catalog.phase})`);

const brokerIds = ['broker.lb.account', 'broker.lb.positions', 'broker.lb.orders', 'broker.futu.opend_probe'];
for (const id of brokerIds) {
  assert(catalog.capabilities.some((c) => c.id === id), `missing ${id}`);
  const cap = catalog.capabilities.find((c) => c.id === id);
  assert(cap.class === 'C0', `${id} must be C0`);
}

const broker = createBrokerAdapter({
  getAccountBalances: async () => ({ cash: 1000.5, power: 2000 }),
  getActivePositions: async () => ([{ ticker: 'AAPL', quantity: 1, average_entry_price: 100, current_price: 110, market_value: 110, unrealized_pnl: 10 }]),
  getTodayOrders: async () => ([{ order_id: 'o1', ticker: 'AAPL', side: 'Buy', quantity: 1, price: 100, status: 'Filled' }]),
  probe: async () => true,
});

const confirmPath = path.join(opsDir, 'state', '_test_confirm_req005.json');
try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
const gw = createGateway({
  rootDir,
  catalog,
  confirmStore: createConfirmStore({ persistPath: confirmPath }),
  adapters: {
    broker,
    gex: { invoke: async () => ({}) },
    lm: { invoke: async () => ({}) },
    dash: { invoke: async () => ({}) },
    ssh: { invoke: async () => ({}) },
  },
});

const account = await gw.invoke('broker.lb.account', {});
assert(account.ok && account.data.cash === 1000.5, 'account ok');
assert(account.data.note === 'read_only', 'account note');

const positions = await gw.invoke('broker.lb.positions', {});
assert(positions.ok && positions.data.count === 1, 'positions ok');

const orders = await gw.invoke('broker.lb.orders', {});
assert(orders.ok && orders.data.orders[0].order_id === 'o1', 'orders ok');

const probe = await gw.invoke('broker.futu.opend_probe', {});
assert(probe.ok && probe.data.opend_up === true, 'opend probe');

for (const id of FORBIDDEN_IDS) {
  const r = await gw.invoke(id);
  assert(r.denied, `forbidden ${id}`);
}
assert((await gw.invoke('broker.lb.place_order')).denied, 'lb place_order denied');
assert((await gw.invoke('broker.place_order')).denied, 'place_order denied');

try { fs.unlinkSync(confirmPath); } catch { /* ignore */ }
console.log('test_broker_readonly_req005: PASS');
