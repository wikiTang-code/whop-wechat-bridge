import net from 'net';
import { spawn } from 'child_process';

const BOARDS = Object.freeze({
  main: { path: '/', title: '主看板' },
  monitoring: { path: '/monitoring', title: '健康看板' },
  gex: { path: '/gex-html/heatseeker_gex.html', title: 'GEX 热图' },
  ticker: { path: '/ticker_timeline.html', title: '个股时间轴' },
  review: { path: '/review_workbench.html', title: '审核工作台' },
});

const BASE = 'http://127.0.0.1:8085';

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

function defaultOpen(url, spawnImpl) {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      child = spawnImpl('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      const bin = process.platform === 'darwin' ? 'open' : 'xdg-open';
      child = spawnImpl(bin, [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', reject);
    child.unref();
    resolve({ opened: true, url });
  });
}

export function createDashAdapter({
  spawnImpl = spawn,
  openImpl,
  probe = probePort,
  baseUrl = BASE,
} = {}) {
  const opener = openImpl || ((url) => defaultOpen(url, spawnImpl));

  function boardUrl(id) {
    const board = BOARDS[id];
    if (!board) throw new Error(`board must be one of ${Object.keys(BOARDS).join(',')}`);
    return `${baseUrl.replace(/\/$/, '')}${board.path}`;
  }

  return {
    async invoke(id, args = {}) {
      if (id === 'dash.list') {
        const up = await probe('127.0.0.1', 8085);
        return {
          dashboard_up: up,
          base: baseUrl,
          boards: Object.entries(BOARDS).map(([key, meta]) => ({
            id: key,
            title: meta.title,
            url: `${baseUrl.replace(/\/$/, '')}${meta.path}`,
          })),
        };
      }

      if (id === 'dash.open') {
        const board = String(args.board || 'main');
        const url = boardUrl(board);
        const opened = await opener(url);
        return { ...opened, board, url };
      }

      throw new Error(`dash adapter cannot handle ${id}`);
    },
  };
}
