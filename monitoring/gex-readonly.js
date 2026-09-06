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
  const coverage = item.coverage && typeof item.coverage === 'object'
    ? {
        got: item.coverage.got ?? null,
        total: item.coverage.total ?? null,
      }
    : null;
  return {
    spot: item.spot ?? null,
    spot_strike: item.spot_strike ?? null,
    kind: item.kind ?? null,
    expiry: item.expiry ?? null,
    change_pct: item.change_pct ?? null,
    coverage,
    king: pickKingFloor(item.king),
    floor: pickKingFloor(item.floor),
    regime: item.regime ?? null,
    local_gex: item.local_gex ?? null,
    note: typeof item.note === 'string' ? item.note : null,
  };
}

export function summarizeMatrix(item) {
  if (!item || typeof item !== 'object') return null;
  const totals = item.column_totals && typeof item.column_totals === 'object'
    ? { ...item.column_totals }
    : null;
  const coverage = item.coverage && typeof item.coverage === 'object'
    ? {
        got: item.coverage.got ?? null,
        total: item.coverage.total ?? null,
      }
    : null;
  const expiries = Array.isArray(item.expiries)
    ? item.expiries.filter((d) => typeof d === 'string').slice(0, 12)
    : null;
  return {
    spot: item.spot ?? null,
    spot_strike: item.spot_strike ?? null,
    kind: item.kind ?? null,
    change_pct: item.change_pct ?? null,
    expiries,
    coverage,
    king: pickKingFloor(item.king),
    floor: pickKingFloor(item.floor),
    column_totals: totals,
    note: typeof item.note === 'string' ? item.note : null,
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

function fmtStrikeShort(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(v >= 1000 ? 0 : 2);
}

function wallVsSpot(spot, wall) {
  if (spot == null || !wall || wall.strike == null) return null;
  const s = Number(spot);
  const k = Number(wall.strike);
  if (!Number.isFinite(s) || !Number.isFinite(k)) return null;
  if (Math.abs(s - k) < 0.51) return 'at';
  return s > k ? 'above' : 'below';
}

function describeRegime(regime) {
  if (regime === 'positive_gamma') {
    return '局部正 gamma：做市商倾向对冲抑制波动（非方向预测）';
  }
  if (regime === 'negative_gamma') {
    return '局部负 gamma：波动更容易被放大（不是做空指令）';
  }
  return regime ? `局部 gamma：${regime}` : null;
}

function columnBias(totals) {
  if (!totals || typeof totals !== 'object') return null;
  const vals = Object.values(totals).map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  const negDays = vals.filter((v) => v < 0).length;
  return { sum, negDays, days: vals.length };
}

/**
 * Deterministic structure reading for the day-level strip.
 * Not an LLM call — safe for web_runner readonly path. Never a trade signal.
 */
export function buildGexAnalysis({ index = {}, matrix = {}, focus = {}, session, stale } = {}) {
  const bullets = [];
  const caveats = [
    '结构解读（规则引擎），不是买卖指令，不自动对齐执行',
    'OI 截至昨日收盘（T+1），墙位会随开盘后成交变化',
  ];

  const underlying = focus?.underlying || 'TSLA';
  const tsla = matrix?.TSLA || null;
  const spy = index?.SPY || null;
  const qqq = index?.QQQ || null;
  const spx = index?.SPX || null;

  if (tsla) {
    const spot = tsla.spot;
    const vsFloor = wallVsSpot(spot, tsla.floor);
    const vsKing = wallVsSpot(spot, tsla.king);
    const bias = columnBias(tsla.column_totals);
    let tslaLine = `TSLA 现货 ${fmtStrikeShort(spot)}`;
    if (tsla.floor?.strike != null) {
      tslaLine += `；Floor ${fmtStrikeShort(tsla.floor.strike)}`;
      if (vsFloor === 'below') tslaLine += '（现价在正 GEX 墙下方）';
      else if (vsFloor === 'above') tslaLine += '（现价在 Floor 上方）';
      else if (vsFloor === 'at') tslaLine += '（贴着 Floor）';
    }
    if (tsla.king?.strike != null) {
      tslaLine += `；King ${fmtStrikeShort(tsla.king.strike)}`;
      if (vsKing === 'below') tslaLine += '（现价在 King 下方）';
      else if (vsKing === 'above') tslaLine += '（现价已越过 King）';
      else if (vsKing === 'at') tslaLine += '（贴着 King）';
    }
    bullets.push(tslaLine);
    if (bias) {
      const side = bias.sum < 0 ? '多到期日列合计偏负（净卖压墙更重）' : '多到期日列合计偏正（正 GEX 列更重）';
      bullets.push(`TSLA 矩阵：${side}；负列 ${bias.negDays}/${bias.days} 个到期日`);
    }
  } else {
    bullets.push(`${underlying} 矩阵暂无（本机采集后才会出现）`);
  }

  const indexParts = [];
  for (const [ticker, item] of [['SPY', spy], ['QQQ', qqq], ['SPX', spx]]) {
    if (!item) continue;
    const reg = describeRegime(item.regime);
    const vsFloor = wallVsSpot(item.spot, item.floor);
    let bit = ticker;
    if (item.kind === 'nearest') bit += '（非 0DTE）';
    if (reg) bit += ` ${reg}`;
    if (vsFloor === 'at' || vsFloor === 'above') bit += `；现货贴/高于 Floor ${fmtStrikeShort(item.floor?.strike)}`;
    else if (vsFloor === 'below') bit += `；现货低于 Floor ${fmtStrikeShort(item.floor?.strike)}`;
    indexParts.push(bit);
  }
  if (indexParts.length) bullets.push(`指数：${indexParts.join(' · ')}`);

  const anyNearest = [spy, qqq, spx].some((x) => x && x.kind === 'nearest');
  if (anyNearest || String(session || '').includes('weekend') || String(session || '').includes('proxy')) {
    caveats.push('当前指数链多为最近到期代理，不要当成当日 0DTE 墙');
  }
  if (stale) caveats.push('快照已过期，结论仅供对照历史结构');

  const focusNote = focus?.query && focus?.underlying && focus.query !== focus.underlying
    ? `${focus.query} 事件对齐看 ${focus.underlying} 正股墙`
    : null;
  if (focusNote) bullets.unshift(focusNote);

  let headline = '结构可对照墙位，但不足以单独定方向';
  if (tsla && wallVsSpot(tsla.spot, tsla.king) === 'below' && wallVsSpot(tsla.spot, tsla.floor) === 'below') {
    headline = 'TSLA 现价同时低于 King/Floor：先对照赵哥点位，再看墙是否形成承接';
  } else if (spy?.regime === 'positive_gamma' && qqq?.regime === 'positive_gamma') {
    headline = '指数局部多为正 gamma：波动或被抑制，仍需点位对齐才加权';
  } else if (spy?.regime === 'negative_gamma' || qqq?.regime === 'negative_gamma') {
    headline = '指数出现负 gamma：波动放大风险上升，不是自动做空';
  }

  return {
    engine: 'rules_v1',
    headline,
    bullets,
    caveats,
    disclaimer: '规则引擎结构解读，不是预测，不构成投资建议。',
  };
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
      analysis: null,
    };
  }

  const { age_minutes, stale } = computeAgeAndStale(raw.generated_at, raw.session, now);
  const collection = raw.collection && typeof raw.collection === 'object'
    ? {
        ok: raw.collection.ok === true,
        script: raw.collection.script ?? null,
        source: raw.collection.source ?? null,
        futu_us_option: raw.collection.futu_us_option ?? null,
        index_spot: raw.collection.index_spot ?? null,
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

  const analysis = buildGexAnalysis({
    index,
    matrix,
    focus,
    session: raw.session,
    stale,
  });

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
    analysis,
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
