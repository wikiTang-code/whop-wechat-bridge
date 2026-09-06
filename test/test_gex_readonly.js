/**
 * Unit + route tests for monitoring/gex-readonly.js (no DB, no sidecar).
 */
import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import {
  mapGexUnderlying,
  isRthSession,
  computeAgeAndStale,
  summarizeIndex,
  summarizeMatrix,
  buildGexLatestPayload,
  createGexReadonlyRouter,
  listGexHtmlReports,
  buildGexAnalysis,
  STALE_RTH_MS,
  STALE_CLOSED_MS,
  GEX_OI_AS_OF,
  GEX_READ_ONLY_ERROR,
} from '../monitoring/gex-readonly.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertForbiddenKeys(obj, keys, label) {
  const json = JSON.stringify(obj);
  for (const key of keys) {
    assert(!json.includes(`"${key}"`), `${label} must not leak "${key}"`);
  }
}

const now = Date.parse('2026-09-06T12:00:00Z');

const fixture = {
  generated_at: '2026-09-05T23:49:49Z',
  session: 'rth_or_weekend_proxy',
  source: 'futu-opend',
  collection: {
    ok: true,
    script: 'tools/gex-sidecar/collect_futu.py',
    source: 'futu-opend',
    note: '主路径成功',
    secret_should_stay: 'keep-note-only',
  },
  disclaimer: '结构快照，不是预测，不构成投资建议。',
  zero_dte: {
    SPY: {
      kind: 'nearest',
      ticker: 'SPY',
      spot: 770.19,
      change_pct: -0.38,
      expiry: '2026-09-08',
      coverage: { got: 102, total: 102 },
      king: { strike: 771, net_gex: -8867398.33 },
      floor: { strike: 770, net_gex: 22108539.63 },
      pillow: null,
      spot_strike: 770,
      local_gex: 4602643.38,
      regime: 'positive_gamma',
      ladder: [{ strike: 795, net_gex: 1 }],
    },
    QQQ: {
      kind: 'nearest',
      spot: 718.96,
      spot_strike: 719,
      expiry: '2026-09-08',
      king: { strike: 710, net_gex: -1 },
      floor: { strike: 720, net_gex: 2 },
      regime: 'positive_gamma',
      local_gex: 3,
      ladder: [{ strike: 700, net_gex: 9 }],
    },
    SPX: {
      kind: 'nearest',
      spot: 7718.6,
      spot_strike: 7720,
      expiry: '2026-09-08',
      king: { strike: 7675, net_gex: -4 },
      floor: { strike: 7725, net_gex: 5 },
      regime: 'positive_gamma',
      local_gex: 6,
    },
  },
  matrix: {
    TSLA: {
      kind: 'matrix',
      ticker: 'TSLA',
      spot: 354.08,
      change_pct: -5.9,
      expiries: ['2026-09-09', '2026-09-18'],
      king: { strike: 360, expiry: '2026-09-09', net_gex: -10451214.38 },
      floor: { strike: 370, expiry: '2026-09-18', net_gex: 2699655.64 },
      column_totals: { '2026-09-09': -10117236.13, '2026-09-18': -11630492 },
      matrix: [{ strike: 360, sum_gex: -1 }],
    },
  },
  errors: [],
};

{
  const m = mapGexUnderlying('tsll');
  assert(m.query === 'TSLL' && m.underlying === 'TSLA', 'TSLL maps to TSLA');
  assert(mapGexUnderlying('TSLA').underlying === 'TSLA', 'TSLA stays TSLA');
  assert(mapGexUnderlying('NVDA').underlying === null, 'unknown symbol has no underlying');
}

{
  assert(isRthSession('rth') === true, 'plain rth is RTH');
  assert(isRthSession('rth_or_weekend_proxy') === false, 'weekend proxy is not RTH');
  assert(isRthSession('closed_or_pre') === false, 'closed is not RTH');
}

{
  const fresh = computeAgeAndStale('2026-09-06T11:50:00Z', 'rth', now);
  assert(fresh.stale === false && fresh.age_minutes === 10, 'RTH 10min is fresh');
  const rthStale = computeAgeAndStale('2026-09-06T10:50:00Z', 'rth', now);
  assert(rthStale.stale === true, 'RTH >60min is stale');
  assert(STALE_RTH_MS === 60 * 60 * 1000, 'RTH stale window 60min');

  const closedFresh = computeAgeAndStale('2026-09-06T01:00:00Z', 'closed_or_pre', now);
  assert(closedFresh.stale === false, 'closed <12h is fresh');
  const closedStale = computeAgeAndStale('2026-09-05T11:00:00Z', 'rth_or_weekend_proxy', now);
  assert(closedStale.stale === true, 'weekend proxy uses 12h window');
  assert(STALE_CLOSED_MS === 12 * 60 * 60 * 1000, 'closed stale window 12h');
}

{
  const idx = summarizeIndex(fixture.zero_dte.SPY);
  assert(idx.spot === 770.19 && idx.kind === 'nearest', 'index keeps spot/kind');
  assert(idx.king.strike === 771 && idx.floor.strike === 770, 'index king/floor');
  assert(idx.change_pct === -0.38, 'index change_pct');
  assert(idx.coverage && idx.coverage.got === 102, 'index coverage summary');
  assert(!('ladder' in idx), 'index summary has no ladder');
  assert(!('pillow' in idx), 'index summary has no pillow');

  const mx = summarizeMatrix(fixture.matrix.TSLA);
  assert(mx.spot === 354.08, 'matrix spot');
  assert(mx.king.expiry === '2026-09-09', 'matrix king expiry');
  assert(mx.column_totals['2026-09-09'] < 0, 'column totals copied');
  assert(mx.change_pct === -5.9, 'matrix change_pct');
  assert(Array.isArray(mx.expiries) && mx.expiries[0] === '2026-09-09', 'matrix expiries kept');
  assert(!('matrix' in mx), 'matrix summary strips inner matrix[]');
}

{
  const data = buildGexLatestPayload(fixture, { now, symbol: 'TSLL' });
  assert(data.ok === true, 'collection.ok true');
  assert(data.oi_as_of === GEX_OI_AS_OF, 'OI as-of yesterday_close');
  assert(data.focus.query === 'TSLL' && data.focus.underlying === 'TSLA', 'focus mapping only');
  assert(data.index.SPY.kind === 'nearest', 'SPY present');
  assert(data.matrix.TSLA.spot === 354.08, 'TSLA matrix present for TSLL query');
  assert(data.stale === true, 'weekend sample older than 12h at test now');
  assertForbiddenKeys(data, ['ladder', 'pillow'], 'payload');
  assert(!Array.isArray(data.matrix.TSLA.matrix), 'no ladder matrix array');
  assert(!Object.prototype.hasOwnProperty.call(data.matrix.TSLA, 'matrix'), 'TSLA object has no nested matrix key');
  assert(!data.collection.secret_should_stay, 'collection is whitelisted');
  assert(data.analysis && data.analysis.engine === 'rules_v1', 'analysis engine');
  assert(data.analysis.headline && data.analysis.bullets.length > 0, 'analysis has headline/bullets');
  assert(data.analysis.caveats.some((c) => c.includes('不是买卖')), 'analysis caveats');
}

{
  const empty = buildGexLatestPayload(null, { now, symbol: 'TSLA' });
  assert(empty.ok === false && empty.missing === true, 'missing snapshot is not a hold');
  assert(empty.stale === true, 'missing is stale');
}

{
  const failed = buildGexLatestPayload({
    generated_at: '2026-09-06T11:00:00Z',
    session: 'rth',
    collection: { ok: false },
    errors: ['OPRA blocked'],
    zero_dte: {},
    matrix: {},
  }, { now, symbol: 'TSLA' });
  assert(failed.ok === false, 'explicit collection.ok false');
}

{
  const tsll = buildGexLatestPayload(fixture, { now, symbol: 'TSLL' });
  const tsla = buildGexLatestPayload(fixture, { now, symbol: 'TSLA' });
  assert(JSON.stringify(tsll.index) === JSON.stringify(tsla.index), 'symbol does not change index');
  assert(JSON.stringify(tsll.matrix) === JSON.stringify(tsla.matrix), 'symbol does not change matrix');
  assert(tsll.focus.query !== tsla.focus.query, 'symbol only changes focus.query');
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch { json = null; }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

{
  const app = express();
  app.use('/api/gex', createGexReadonlyRouter({
    rootDir: process.cwd(),
    now: () => now,
    latestPath: path.join(process.cwd(), 'data', 'gex', '__missing_latest.json'),
  }));
  const { server, port } = await listen(app);
  try {
    const getMissing = await request(port, 'GET', '/api/gex/latest?symbol=TSLL');
    assert(getMissing.status === 200, 'GET missing file still 200');
    assert(getMissing.json.success === true, 'GET success wrapper');
    assert(getMissing.json.data.ok === false, 'missing ok=false');
    assert(getMissing.json.data.missing === true, 'missing flag');
    assert(getMissing.json.data.focus.underlying === 'TSLA', 'GET symbol maps focus');

    const postLatest = await request(port, 'POST', '/api/gex/latest');
    assert(postLatest.status === 403, 'POST /api/gex/latest is 403');
    assert(postLatest.json.error === GEX_READ_ONLY_ERROR, 'POST latest read-only error');

    const postRoot = await request(port, 'POST', '/api/gex');
    assert(postRoot.status === 403, 'POST /api/gex is 403');
    assert(postRoot.json.error === GEX_READ_ONLY_ERROR, 'POST root read-only error');

    const putLatest = await request(port, 'PUT', '/api/gex/latest');
    assert(putLatest.status === 403, 'PUT is 403');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

{
  const samplePath = path.join(process.cwd(), 'data', 'gex', 'latest.json');
  if (fs.existsSync(samplePath)) {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    const data = buildGexLatestPayload(raw, { now, symbol: 'TSLL' });
    assert(data.focus.underlying === 'TSLA', 'sample TSLL maps to TSLA');
    assert(data.index.SPY && data.index.QQQ && data.index.SPX, 'sample has index trio');
    assert(data.matrix.TSLA && data.matrix.TSLA.column_totals, 'sample has TSLA column totals');
    assert(!JSON.stringify(data.index).includes('"ladder"'), 'sample index has no ladder');
    assert(!Object.prototype.hasOwnProperty.call(data.matrix.TSLA, 'matrix'), 'sample TSLA has no nested matrix');
    assert(data.oi_as_of === 'yesterday_close', 'sample oi_as_of');
    assert(data.index.SPY.kind === 'nearest', 'weekend sample is nearest not 0dte');
    assert(Array.isArray(data.matrix.TSLA.expiries) && data.matrix.TSLA.expiries.length > 0, 'sample exposes expiries');
    assert(data.matrix.TSLA.change_pct != null, 'sample exposes change_pct');
  }

  const reports = await listGexHtmlReports(process.cwd());
  assert(Array.isArray(reports), 'listGexHtmlReports returns array');
  if (fs.existsSync(path.join(process.cwd(), 'data', 'gex', 'heatseeker_gex.html'))) {
    assert(reports.some((r) => r.id === 'heatseeker'), 'heatseeker report listed');
    assert(reports.find((r) => r.id === 'heatseeker').href === '/gex-html/heatseeker_gex.html', 'heatseeker href');
  }
}

console.log('test_gex_readonly: PASS');
