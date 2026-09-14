/**
 * Minimal localhost ops console (REQ-006 / P6). No C2 from UI without confirm flow.
 */
export function renderOpsUiHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Local Ops</title>
  <style>
    :root { color-scheme: light; --ink:#1a1f2e; --muted:#5c6578; --line:#d8dde8; --bg:#f3f5f9; --card:#fff; --accent:#0b6e4f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif; background: linear-gradient(160deg,#eef2f7,#f8fafc 45%,#e8eef6); color: var(--ink); }
    main { max-width: 920px; margin: 0 auto; padding: 28px 20px 48px; }
    h1 { font-size: 1.6rem; margin: 0 0 6px; letter-spacing: -0.02em; }
    .sub { color: var(--muted); margin: 0 0 22px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); }
    button { appearance: none; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 10px; padding: 12px 14px; text-align: left; cursor: pointer; box-shadow: 0 1px 0 rgba(16,24,40,.04); }
    button:hover { border-color: var(--accent); }
    button strong { display: block; font-size: .95rem; }
    button span { display: block; color: var(--muted); font-size: .78rem; margin-top: 4px; }
    pre { margin-top: 18px; background: #0f172a; color: #e2e8f0; border-radius: 12px; padding: 14px; overflow: auto; min-height: 180px; font-size: 12px; line-height: 1.45; }
    .badge { display: inline-block; font-size: .75rem; color: var(--accent); border: 1px solid #b7e0cf; background: #eefaf4; border-radius: 999px; padding: 2px 8px; margin-left: 8px; vertical-align: middle; }
  </style>
</head>
<body>
  <main>
    <h1>Local Ops <span class="badge">127.0.0.1 only</span></h1>
    <p class="sub">本机运维页 · 只暴露网关已注册能力 · 生产 C2 仍须 human-approve</p>
    <div class="grid" id="actions"></div>
    <pre id="out">loading…</pre>
  </main>
  <script>
    const ACTIONS = [
      ['ops.whoami', 'Whoami'],
      ['gex.status', 'GEX status'],
      ['gex.summarize', 'GEX summarize'],
      ['gex.freshness', 'GEX freshness'],
      ['lm.status', 'LM status'],
      ['dash.list', 'Dash list'],
      ['broker.lb.account', 'LB account'],
      ['broker.lb.positions', 'LB positions'],
      ['broker.lb.orders', 'LB orders'],
      ['broker.futu.opend_probe', 'OpenD probe'],
      ['gcp.health', 'GCP health'],
      ['gcp.pm2_status', 'PM2 status'],
      ['gcp.health_bundle', 'Health bundle']
    ];
    const out = document.getElementById('out');
    const box = document.getElementById('actions');
    function show(v) { out.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
    async function invoke(id) {
      show('invoke ' + id + '…');
      try {
        const res = await fetch('/api/ops/invoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, args: {} })
        });
        const data = await res.json();
        show(data);
      } catch (e) { show(String(e)); }
    }
    for (const [id, label] of ACTIONS) {
      const b = document.createElement('button');
      b.innerHTML = '<strong>' + label + '</strong><span>' + id + '</span>';
      b.onclick = () => invoke(id);
      box.appendChild(b);
    }
    fetch('/healthz').then(r => r.json()).then(show).catch(e => show(String(e)));
  </script>
</body>
</html>`;
}
