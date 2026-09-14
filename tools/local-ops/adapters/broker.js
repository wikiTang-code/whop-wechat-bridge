/**
 * P5 broker read-only adapter. Never wraps place_order / submitOrder.
 */
import net from 'net';

function probePort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

export function createBrokerAdapter({
  getAccountBalances,
  getActivePositions,
  getTodayOrders,
  probe = probePort,
  futuHost = '127.0.0.1',
  futuPort = 11111,
} = {}) {
  return {
    async invoke(id) {
      if (id === 'broker.lb.account') {
        if (typeof getAccountBalances !== 'function') {
          throw new Error('longbridge account reader not wired');
        }
        const bal = await getAccountBalances();
        return {
          broker: 'longbridge',
          cash: bal?.cash ?? null,
          power: bal?.power ?? null,
          note: 'read_only',
        };
      }
      if (id === 'broker.lb.positions') {
        if (typeof getActivePositions !== 'function') {
          throw new Error('longbridge positions reader not wired');
        }
        const positions = await getActivePositions();
        return {
          broker: 'longbridge',
          count: Array.isArray(positions) ? positions.length : 0,
          positions: Array.isArray(positions) ? positions : [],
          note: 'read_only',
        };
      }
      if (id === 'broker.lb.orders') {
        if (typeof getTodayOrders !== 'function') {
          throw new Error('longbridge orders reader not wired');
        }
        const orders = await getTodayOrders();
        return {
          broker: 'longbridge',
          count: Array.isArray(orders) ? orders.length : 0,
          orders: Array.isArray(orders) ? orders : [],
          note: 'read_only_today',
        };
      }
      if (id === 'broker.futu.opend_probe') {
        const up = await probe(futuHost, futuPort);
        return {
          broker: 'futu',
          host: futuHost,
          port: futuPort,
          opend_up: Boolean(up),
          note: 'probe_only_no_quotes',
        };
      }
      throw new Error(`unknown broker capability: ${id}`);
    },
  };
}
