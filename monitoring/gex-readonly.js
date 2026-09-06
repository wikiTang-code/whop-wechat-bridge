/**
 * Read-only GEX sidecar consumer.
 * Reads data/gex/latest.json via fs only — never touches whop_archive.db,
 * never writes, never auto-aligns or gates execution.
 */
import fs from 'fs/promises';
import path from 'path';
import express from 'express';

export const GEX_UNDERLYING_MAP = Object.freeze({
  TSLL: 'TSLA',
  TSLA: 'TSLA',
  SPY: 'SPY',
  QQQ: 'QQQ',
  SPX: 'SPX',
});

export const GEX_OI_AS_OF = 'yesterday_close';
export const STALE_RTH_MS = 60 * 60 * 1000;
export const STALE_CLOSED_MS = 12 * 60 * 60 * 1000;
export const GEX_READ_ONLY_ERROR = 'GEX is read-only';

const INDEX_TICKERS = ['SPY', 'QQQ', 'SPX'];

export function mapGexUnderlying(symbol) {
  const s = String(symbol || '').toUpperCase().trim();
  if (!s) return { query: 'TSLA', underlying: 'TSLA' };
  return {
    query: s,
    underlying: GEX_UNDERLYING_MAP[s] || null,
  };
}

export function isRthSession(session) {
  const s = String(session || '').toLowerCase();
  if (!s.includes('rth')) return false;
  if (s.includes('weekend') || s.includes('proxy')) return false;
  return true;
}

export function parseGeneratedAtMs(generatedAt) {
  if (generatedAt == null || generatedAt === '') return null;
  if (typeof generatedAt === 'number' && Number.isFinite(generatedAt)) return generatedAt;
  const ms = Date.parse(String(generatedAt));
  return Number.isFinite(ms) ? ms : null;
}

export function computeAgeAndStale(generatedAt, session, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const generatedMs = parseGeneratedAtMs(generatedAt);
  if (generatedMs == null) {
    return { age_minutes: null, stale: true };
  }
  const ageMs = Math.max(0, now - generatedMs);
  const limit = isRthSession(session) ? STALE_RTH_MS : STALE_CLOSED_MS;
  return {
    age_minutes: Math.round(ageMs / 60000),
    stale: ageMs > limit,
  };
}

function pickKingFloor(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  if ('strike' in obj) out.strike = obj.strike;
  if ('net_gex' in obj) out.net_gex = obj.net_gex;
  if ('expiry' in obj) out.expiry = obj.expiry;
  return out;
}

export function summarizeIndex(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    spot: item.spot ?? null,
    spot_strike: item.spot_strike ?? null,
    kind: item.kind ?? null,
    expiry: item.expiry ?? null,
    king: pickKingFloor(item.king),
    floor: pickKingFloor(item.floor),
    regime: item.regime ?? null,
    local_gex: item.local_gex ?? null,
  };
}

export function summarizeMatrix(item) {
  if (!item || typeof item !== 'object') return null;
  const totals = item.column_totals && typeof item.column_totals === 'object'
    ? { ...item.column_totals }
    : null;
  return {
    spot: item.spot ?? null,
    king: pickKingFloor(item.king),
    floor: pickKingFloor(item.floor),
    column_totals: totals,
  };
}

/**
 * List available HTML reports under data/gex (no ladder payloads).
 * @param {string} rootDir
 * @returns {Promise<Array<{ id: string, title: string, href: string }>>}
 */
export async function listGexHtmlReports(rootDir) {
  const dir = path.join(rootDir, 'data', 'gex');
  const reports = [];
  try {
    await fs.access(path.join(dir, 'heatseeker_gex.html'));
    reports.push({
      id: 'heatseeker',
      title: 'SPY/QQQ/SPX 阶梯图',
      href: '/gex-html/heatseeker_gex.html',
    });
  } catch {
    /* missing */
  }
  try {
    const names = await fs.readdir(dir);
    for (const name of names.sort()) {
      const m = /^gex_matrix_([A-Za-z0-9]+)\.html$/i.exec(name);
      if (!m) continue;
      const ticker = m[1].toUpperCase();
      reports.push({
        id: `matrix_${ticker}`,
        title: `${ticker} GEX 矩阵`,
        href: `/gex-html/${name}`,
      });
    }
  } catch {
    /* missing dir */
  }
  return reports;
}

function hasAnySeries(raw) {
  const zd = raw?.zero_dte && typeof raw.zero_dte === 'object'
    ? Object.keys(raw.zero_dte).length
    : 0;
  const mx = raw?.matrix && typeof raw.matrix === 'object'
    ? Object.keys(raw.matrix).length
    : 0;
  return zd > 0 || mx > 0;
}

export function buildGexLatestPayload(raw, { now = Date.now(), symbol = 'TSLA', reports = [] } = {}) {
  const focus = mapGexUnderlying(symbol);
  const missing = !raw || typeof raw !== 'object';
  if (missing) {
    return {
      ok: false,
      missing: true,
      stale: true,
      age_minutes: null,
      generated_at: null,
      session: null,
      source: null,
      oi_as_of: GEX_OI_AS_OF,
      disclaimer: '结构快照，不是预测，不构成投资建议。',
      collection: null,
      focus,
      index: {},
      matrix: {},
      reports: [],
    };
  }

  const { age_minutes, stale } = computeAgeAndStale(raw.generated_at, raw.session, now);
  const collection = raw.collection && typeof raw.collection === 'object'
    ? {
        ok: raw.collection.ok === true,
        script: raw.collection.script ?? null,
        source: raw.collection.source ?? null,
        note: raw.collection.note ?? null,
      }
    : null;

  const explicitOk = collection && typeof raw.collection.ok === 'boolean'
    ? raw.collection.ok === true
    : null;
  const errorsEmpty = Array.isArray(raw.errors) ? raw.errors.length === 0 : true;
  const ok = explicitOk === false ? false : (explicitOk === true || (errorsEmpty && hasAnySeries(raw)));

  const index = {};
  for (const ticker of INDEX_TICKERS) {
    const item = raw.zero_dte?.[ticker];
    const summary = summarizeIndex(item);
    if (summary) index[ticker] = summary;
  }

  const matrix = {};
  const tsla = summarizeMatrix(raw.matrix?.TSLA);
  if (tsla) matrix.TSLA = tsla;

  return {
    ok,
    missing: false,
    stale,
    age_minutes,
    generated_at: raw.generated_at ?? null,
    session: raw.session ?? null,
    source: raw.source ?? null,
    oi_as_of: GEX_OI_AS_OF,
    disclaimer: raw.disclaimer || '结构快照，不是预测，不构成投资建议。',
    collection,
    focus,
    index,
    matrix,
    reports: Array.isArray(reports) ? reports : [],
  };
}

export async function readGexLatestFile(rootDir, latestPath) {
  const filePath = latestPath || path.join(rootDir, 'data', 'gex', 'latest.json');
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return { filePath, raw: JSON.parse(text), missing: false, parseError: null };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { filePath, raw: null, missing: true, parseError: null };
    }
    return { filePath, raw: null, missing: false, parseError: err.message || String(err) };
  }
}

function sendReadOnlyForbidden(res) {
  return res.status(403).json({ success: false, error: GEX_READ_ONLY_ERROR });
}

export function createGexReadonlyRouter({ rootDir, now = () => Date.now(), latestPath } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return sendReadOnlyForbidden(res);
  });

  router.get('/latest', async (req, res) => {
    try {
      const symbol = req.query.symbol;
      const reports = await listGexHtmlReports(rootDir);
      const { raw, missing, parseError } = await readGexLatestFile(rootDir, latestPath);
      if (parseError) {
        return res.json({
          success: true,
          data: {
            ...buildGexLatestPayload(null, { now: now(), symbol, reports }),
            ok: false,
            parse_error: true,
          },
        });
      }
      const data = buildGexLatestPayload(missing ? null : raw, { now: now(), symbol, reports });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  router.all('*', (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.status(404).json({ success: false, error: 'not found' });
    }
    return sendReadOnlyForbidden(res);
  });

  return router;
}
