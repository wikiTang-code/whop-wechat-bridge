/**
 * REQ-038-T2 — TSLA/TSLL subset attribution (offline experiment).
 * Spec: docs/project/req038-t2-attribution-spec.md
 * Does not write trade_signals / L2a / BUY-SELL.
 */

export const ATTR_TICKERS = ['TSLA', 'TSLL'];
/** Distill types + multimodal VL level cards (CHG-030 incremental consume). */
export const ATTR_CARD_TYPES = new Set(['pattern', 'asset_memory', 'risk_rule', 'level']);
export const EVENT_ABS_RET = 0.15;
/** AGENTS §6.9 — 大V身份绝对硬锁（禁模糊匹配）. */
export const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
export const ZHAO_SENDER_NAME = 'xiaozhaolucky';

export function isZhaoSender(row) {
  return String(row?.sender_id || '') === ZHAO_SENDER_ID;
}

const BULL_RE = /突破|回踩|支撑|低吸|加仓|做多|反弹|企稳|不破/g;
const BEAR_RE = /止损|跌破|降仓|减仓|砍仓|阻力|做空|弱势/g;
const CUE_PRICE_RE =
  /(?:支撑|阻力|破位|跌破|突破|回踩|止损|加仓|关键位|低点|高点)[^\d$]{0,10}(\$?\d{1,4}(?:\.\d{1,2})?)|(\$?\d{1,4}(?:\.\d{1,2})?)[^\d]{0,10}(?:支撑|阻力|破位|跌破|突破|回踩|止损|加仓|关键位|低点|高点)|\$(\d{1,4}(?:\.\d{1,2})?)/gi;
const LABELED_LEVEL_RE =
  /(?:支撑位|压力位|阻力位|关键区间|短线)[^\d$%]{0,8}(\$?\d{1,4}(?:\.\d{1,2})?)/gi;
const CONCLUSION_LINE_RE =
  /(?:先说主结论|先说结论|主结论|结论|方向判断)[^\n]{0,80}/g;

function parseJsonArr(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function mentionBlob(card) {
  return [card.title, card.trigger_text, card.action_text, card.theory_text, card.source_text]
    .map((x) => String(x || ''))
    .join('\n');
}

function levelBlob(card) {
  return [mentionBlob(card), card.schema_json].map((x) => String(x || '')).join('\n');
}

function blobOf(card) {
  return [mentionBlob(card), card.tickers_json, card.schema_json]
    .map((x) => String(x || ''))
    .join('\n');
}

export function cardTickers(card) {
  const blob = mentionBlob(card).toUpperCase();
  const found = [];
  for (const t of ATTR_TICKERS) {
    const re = new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`);
    if (re.test(blob)) found.push(t);
  }
  return found;
}

export function pricingTicker(tickers) {
  if (tickers.includes('TSLL')) return 'TSLL';
  if (tickers.includes('TSLA')) return 'TSLA';
  return null;
}

function parsePriceToken(tok) {
  if (!tok) return null;
  const n = Number(String(tok).replace(/\$/g, ''));
  return Number.isFinite(n) ? n : null;
}

function inTickerBand(n, ticker) {
  const lo = ticker === 'TSLL' ? 1 : 50;
  const hi = ticker === 'TSLL' ? 200 : 900;
  return n >= lo && n <= hi;
}

function isPercentContext(src, index, tokenLen) {
  const after = src.slice(index + tokenLen, index + tokenLen + 3);
  const before = src.slice(Math.max(0, index - 6), index);
  return /%/.test(after) || /概率/.test(before);
}

export function extractExplicitLevel(text, ticker) {
  const src = String(text || '');
  const want = String(ticker || '').toUpperCase();
  const windows = [];
  if (want) {
    const tre = new RegExp(`(^|[^A-Z0-9])${want}([^A-Z0-9]|$)`, 'gi');
    let tm;
    while ((tm = tre.exec(src))) {
      const start = Math.max(0, tm.index - 20);
      const end = Math.min(src.length, tm.index + tm[0].length + 120);
      windows.push(src.slice(start, end));
    }
  }

  function scan(scope, labeledOnly) {
    if (labeledOnly) {
      LABELED_LEVEL_RE.lastIndex = 0;
      let m;
      while ((m = LABELED_LEVEL_RE.exec(scope))) {
        const n = parsePriceToken(m[1]);
        if (n == null) continue;
        if (isPercentContext(scope, m.index + m[0].lastIndexOf(m[1]), String(m[1]).length)) continue;
        if (nearForeignTicker(scope, m.index, want)) continue;
        if (inTickerBand(n, ticker)) return n;
      }
      return null;
    }
    LABELED_LEVEL_RE.lastIndex = 0;
    let m;
    while ((m = LABELED_LEVEL_RE.exec(scope))) {
      const n = parsePriceToken(m[1]);
      if (n == null) continue;
      if (isPercentContext(scope, m.index + m[0].lastIndexOf(m[1]), String(m[1]).length)) continue;
      if (nearForeignTicker(scope, m.index, want)) continue;
      if (inTickerBand(n, ticker)) return n;
    }
    CUE_PRICE_RE.lastIndex = 0;
    while ((m = CUE_PRICE_RE.exec(scope))) {
      const tok = m[1] || m[2] || m[3];
      const n = parsePriceToken(tok);
      if (n == null) continue;
      const bare = String(tok).replace(/\$/g, '');
      const tokAt = m.index + Math.max(0, m[0].lastIndexOf(bare));
      if (isPercentContext(scope, tokAt, bare.length)) continue;
      if (nearForeignTicker(scope, tokAt, want)) continue;
      if (inTickerBand(n, ticker)) return n;
    }
    return null;
  }

  for (const scope of windows) {
    const hit = scan(scope, false);
    if (hit != null) return hit;
  }
  return scan(src, true) ?? scan(src, false);
}

function nearForeignTicker(src, index, want) {
  const s = String(src || '');
  const upper = s.toUpperCase();
  const foreignRe = /\b(UPST|UPSX|CONL|NVDL|NVDA|SPY|QQQ|AAPL|AMD)\b/g;
  let bestForeign = Infinity;
  let fm;
  while ((fm = foreignRe.exec(upper))) {
    const d = Math.abs(fm.index - index);
    if (d < bestForeign) bestForeign = d;
  }
  if (!Number.isFinite(bestForeign)) return false;
  let bestWant = Infinity;
  if (want) {
    const wre = new RegExp(`(^|[^A-Z0-9])${want}([^A-Z0-9]|$)`, 'g');
    let wm;
    while ((wm = wre.exec(upper))) {
      const d = Math.abs(wm.index - index);
      if (d < bestWant) bestWant = d;
    }
  }
  return bestForeign < bestWant;
}

/** Parse model-report style conclusions before keyword vote (CHG-028). */
export function extractConclusionDirection(text) {
  const src = String(text || '');
  const lines = src.match(CONCLUSION_LINE_RE) || [];
  const pool = lines.length ? lines.join('\n') : src.slice(0, 400);
  if (/区间震荡|横盘|方向观望|观望/.test(pool) && !/偏多|偏弱|上涨|下跌|回落|看空|看多/.test(pool)) {
    return null;
  }
  if (/偏弱|回落|看空|下跌为主|预计下跌/.test(pool)) return 'bearish';
  if (/偏多|看多|预计上涨|上涨为主/.test(pool)) return 'bullish';
  return undefined;
}

export function inferDirection(card) {
  const text = blobOf(card);
  const type = String(card.card_type || '');
  if (type === 'risk_rule' && /止损|降仓|砍仓|减仓/.test(text)) return 'bearish';

  const concluded = extractConclusionDirection(text);
  if (concluded === null) return null;
  if (concluded === 'bullish' || concluded === 'bearish') return concluded;

  // Multimodal level cards: pattern labels in title/patterns often encode bias
  if (type === 'level') {
    if (/V型反弹|底部反弹|低吸|回踩/.test(text) && !/单边下跌(?!.*反弹)/.test(text)) return 'bullish';
    if (/单边下跌|破位下跌|弱势/.test(text) && !/反弹|V型/.test(text)) return 'bearish';
    if (/V型反弹|底部V/.test(text)) return 'bullish';
  }

  const bullHits = [...text.matchAll(BULL_RE)].length;
  const bearHits = [...text.matchAll(BEAR_RE)].length;
  if (bullHits && bearHits) {
    if (bullHits >= bearHits * 2) return 'bullish';
    if (bearHits >= bullHits * 2) return 'bearish';
    return 'mixed';
  }
  if (bullHits) return 'bullish';
  if (bearHits) return 'bearish';
  return null;
}

export function etCalendarDate(ms) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(new Date(Number(ms)));
}

function clip01(x) {
  return Math.max(0, Math.min(1, x));
}

export function confidenceFromRet(hit, closeRet) {
  const mag = Math.min(0.3, Math.abs(Number(closeRet) || 0) / 0.2);
  return hit ? clip01(0.55 + mag) : clip01(0.45 - mag);
}

/**
 * @param {Array<{date:string, open?:number, high:number, low:number, close:number, adjClose?:number}>} bars
 */
export function scaleBar(bar) {
  const close = Number(bar.close);
  const adj = bar.adjClose != null ? Number(bar.adjClose) : close;
  const factor = close ? adj / close : 1;
  return {
    date: bar.date,
    adjClose: adj,
    adjHigh: Number(bar.high) * factor,
    adjLow: Number(bar.low) * factor,
    px_basis: bar.adjClose != null ? 'adj' : 'raw'
  };
}

export function windowMetrics(scaled, entryIdx, days) {
  const entry = scaled[entryIdx];
  const end = entryIdx + days;
  if (end >= scaled.length) return null;
  const slice = scaled.slice(entryIdx + 1, end + 1);
  const entryPx = entry.adjClose;
  let maxH = -Infinity;
  let minL = Infinity;
  for (const b of slice) {
    if (b.adjHigh > maxH) maxH = b.adjHigh;
    if (b.adjLow < minL) minL = b.adjLow;
  }
  const last = slice[slice.length - 1];
  return {
    entry_px: entryPx,
    close_ret: last.adjClose / entryPx - 1,
    max_gain: maxH / entryPx - 1,
    max_dd: minL / entryPx - 1,
    end_date: last.date
  };
}

export function scoreCardAgainstBars({ direction, t0Date, bars }) {
  const scaled = (bars || []).map(scaleBar).sort((a, b) => a.date.localeCompare(b.date));
  const entryIdx = scaled.findIndex((b) => b.date > t0Date);
  if (entryIdx < 0) return { status: 'skipped_no_bars' };
  if (entryIdx === 0) return { status: 'skipped_no_bars', reason: 'no_prior_bar' };

  const prev = scaled[entryIdx - 1];
  const entry = scaled[entryIdx];
  const eventRet = entry.adjClose / prev.adjClose - 1;
  if (Math.abs(eventRet) > EVENT_ABS_RET) {
    return {
      status: 'excluded_event',
      entry_date: entry.date,
      entry_px: entry.adjClose,
      event_ret: eventRet
    };
  }

  const w3 = windowMetrics(scaled, entryIdx, 3);
  const w5 = windowMetrics(scaled, entryIdx, 5);
  if (!w3 || !w5) return { status: 'skipped_no_bars', entry_date: entry.date };

  const hit3 =
    direction === 'bullish' ? w3.close_ret > 0 : direction === 'bearish' ? w3.close_ret < 0 : false;
  const hit5 =
    direction === 'bullish' ? w5.close_ret > 0 : direction === 'bearish' ? w5.close_ret < 0 : false;

  return {
    status: 'scored',
    entry_date: entry.date,
    entry_px: entry.adjClose,
    px_basis: entry.px_basis,
    close_ret_3d: w3.close_ret,
    max_gain_3d: w3.max_gain,
    max_dd_3d: w3.max_dd,
    hit_3d: hit3,
    close_ret_5d: w5.close_ret,
    max_gain_5d: w5.max_gain,
    max_dd_5d: w5.max_dd,
    hit_5d: hit5,
    end_date_5d: w5.end_date,
    confidence: confidenceFromRet(hit5, w5.close_ret)
  };
}

export function extractLevelFromVisionMeta(meta, ticker) {
  if (!meta) return null;
  const vt = String(meta.ticker || '').trim().toUpperCase();
  const want = String(ticker || '').trim().toUpperCase();
  if (vt && want && vt !== want) return null;
  let sr = meta.support_resistance_json || meta.support_resistance;
  if (typeof sr === 'string') {
    try {
      sr = JSON.parse(sr);
    } catch {
      sr = null;
    }
  }
  if (!sr || typeof sr !== 'object') return null;
  const nums = [...(sr.support || []), ...(sr.resistance || [])]
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.includes(100.5) && nums.includes(120) && nums.length <= 2) return null;
  const lo = ticker === 'TSLL' ? 1 : 50;
  const hi = ticker === 'TSLL' ? 200 : 900;
  const ok = nums.filter((n) => n >= lo && n <= hi);
  return ok.length ? ok[0] : null;
}

export function evaluateCard(card, { messageCreatedAt, bars, visionMeta, sourceSender } = {}) {
  const tickers = cardTickers(card);
  const ticker = pricingTicker(tickers);
  if (!ticker) return { status: 'skipped_ticker' };
  if (!ATTR_CARD_TYPES.has(String(card.card_type || ''))) {
    return { status: 'skipped_type', ticker };
  }
  if (sourceSender != null && !isZhaoSender(sourceSender)) {
    return {
      status: 'skipped_non_zhao',
      ticker,
      sender_id: sourceSender.sender_id || null,
      sender_name: sourceSender.sender_name || null
    };
  }
  let level = extractExplicitLevel(levelBlob(card), ticker);
  if (level == null) level = extractLevelFromVisionMeta(visionMeta, ticker);
  if (level == null) return { status: 'skipped_no_level', ticker };
  const direction = inferDirection(card);
  if (!direction) return { status: 'skipped_no_direction', ticker, level };
  if (direction === 'mixed') return { status: 'unscored_mixed', ticker, level };

  if (messageCreatedAt == null) return { status: 'skipped_no_t0', ticker, level, direction };
  const t0Date = etCalendarDate(messageCreatedAt);
  const scored = scoreCardAgainstBars({ direction, t0Date, bars });
  if (scored.status === 'scored' && scored.entry_px) {
    const ratio = level / scored.entry_px;
    if (!(ratio >= 0.4 && ratio <= 2.5)) {
      return {
        ticker,
        level,
        direction,
        t0_et: t0Date,
        ...scored,
        status: 'skipped_level_mismatch',
        level_entry_ratio: ratio
      };
    }
  }
  return { ticker, level, direction, t0_et: t0Date, ...scored };
}

export function selectCandidateCards(rows) {
  return (rows || []).filter((c) => {
    if (!ATTR_CARD_TYPES.has(String(c.card_type || ''))) return false;
    return cardTickers(c).length > 0;
  });
}

/**
 * REQ-040 gaps: VL ok rows for ATTR_TICKERS that still lack usable SR.
 * Used so T1 can backfill without waiting for full 432.
 */
export function listT2VisionGaps(rows, { tickers = ATTR_TICKERS } = {}) {
  const want = new Set((tickers || []).map((t) => String(t).toUpperCase()));
  const gaps = [];
  let withSr = 0;
  for (const row of rows || []) {
    const status = String(row.status || '').toLowerCase();
    if (status && status !== 'ok') continue;
    const ticker = String(row.ticker || '').trim().toUpperCase();
    if (!want.has(ticker)) continue;
    const level = extractLevelFromVisionMeta(row, ticker);
    if (level != null) {
      withSr += 1;
      continue;
    }
    gaps.push({
      message_id: row.message_id || null,
      vision_id: row.id || row.vision_id || null,
      ticker,
      status: row.status || 'ok',
      has_annotation: Boolean(row.hand_drawn_annotation),
      reason: 'missing_or_unusable_sr'
    });
  }
  return {
    tickers: [...want],
    with_sr: withSr,
    missing_sr: gaps.length,
    gaps
  };
}

/**
 * CHG-033: ontology multimodal level cards that T2 cannot score
 * (non-Zhao source and/or out-of-band levels).
 */
export function listT2OntologyLevelGaps(cards, { resolveSender } = {}) {
  const oob = [];
  const nonZhao = [];
  let usable = 0;
  for (const card of cards || []) {
    if (String(card.card_type || '') !== 'level') continue;
    const isMm =
      String(card.provider || '') === 'multimodal_vl' || String(card.id || '').startsWith('card_mm_');
    if (!isMm) continue;
    const tickers = cardTickers(card);
    const ticker = pricingTicker(tickers);
    if (!ticker) continue;
    const mid = firstSourceMessageId(card);
    const sender = resolveSender && mid ? resolveSender(mid) : null;
    if (sender && !isZhaoSender(sender)) {
      nonZhao.push({
        card_id: card.id,
        message_id: mid,
        ticker,
        sender_id: sender.sender_id || null,
        sender_name: sender.sender_name || null,
        trigger: String(card.trigger_text || '').slice(0, 120),
        reason: 'non_zhao_sender'
      });
      continue;
    }
    const level = extractExplicitLevel(levelBlob(card), ticker);
    if (level != null) {
      usable += 1;
      continue;
    }
    oob.push({
      card_id: card.id,
      message_id: mid,
      ticker,
      trigger: String(card.trigger_text || '').slice(0, 120),
      reason: 'out_of_band_or_missing_level'
    });
  }
  return {
    usable_zhao_level: usable,
    non_zhao: nonZhao.length,
    out_of_band: oob.length,
    non_zhao_gaps: nonZhao,
    out_of_band_gaps: oob
  };
}

export function summarize(results) {
  const scored = results.filter((r) => r.status === 'scored');
  const hit5 = scored.filter((r) => r.hit_5d).length;
  const hit3 = scored.filter((r) => r.hit_3d).length;
  const byTicker = {};
  const byDir = {};
  for (const r of scored) {
    byTicker[r.ticker] = byTicker[r.ticker] || { n: 0, hit5: 0 };
    byTicker[r.ticker].n += 1;
    if (r.hit_5d) byTicker[r.ticker].hit5 += 1;
    byDir[r.direction] = byDir[r.direction] || { n: 0, hit5: 0 };
    byDir[r.direction].n += 1;
    if (r.hit_5d) byDir[r.direction].hit5 += 1;
  }
  return {
    n_scored: scored.length,
    n_total: results.length,
    hit_rate_5d: scored.length ? hit5 / scored.length : null,
    hit_rate_3d: scored.length ? hit3 / scored.length : null,
    by_ticker: byTicker,
    by_direction: byDir
  };
}

export function ensureAttributionTable(conn) {
  conn.prepare(`
    CREATE TABLE IF NOT EXISTS ontology_card_attribution (
      card_id TEXT PRIMARY KEY,
      ticker TEXT,
      direction TEXT,
      level REAL,
      t0_et TEXT,
      status TEXT NOT NULL,
      entry_date TEXT,
      entry_px REAL,
      close_ret_5d REAL,
      hit_5d INTEGER,
      confidence REAL,
      schema_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
}

export function saveAttributionRow(conn, cardId, result) {
  ensureAttributionTable(conn);
  conn.prepare(`
    INSERT INTO ontology_card_attribution (
      card_id, ticker, direction, level, t0_et, status, entry_date, entry_px,
      close_ret_5d, hit_5d, confidence, schema_json, created_at
    ) VALUES (
      @card_id, @ticker, @direction, @level, @t0_et, @status, @entry_date, @entry_px,
      @close_ret_5d, @hit_5d, @confidence, @schema_json, @created_at
    )
    ON CONFLICT(card_id) DO UPDATE SET
      ticker=excluded.ticker, direction=excluded.direction, level=excluded.level,
      t0_et=excluded.t0_et, status=excluded.status, entry_date=excluded.entry_date,
      entry_px=excluded.entry_px, close_ret_5d=excluded.close_ret_5d,
      hit_5d=excluded.hit_5d, confidence=excluded.confidence,
      schema_json=excluded.schema_json, created_at=excluded.created_at
  `).run({
    card_id: cardId,
    ticker: result.ticker || null,
    direction: result.direction || null,
    level: result.level ?? null,
    t0_et: result.t0_et || null,
    status: result.status,
    entry_date: result.entry_date || null,
    entry_px: result.entry_px ?? null,
    close_ret_5d: result.close_ret_5d ?? null,
    hit_5d: result.hit_5d == null ? null : result.hit_5d ? 1 : 0,
    confidence: result.confidence ?? null,
    schema_json: JSON.stringify(result),
    created_at: Date.now()
  });
}

export function loadCardsAndMessages(conn) {
  const cards = conn.prepare(`
    SELECT * FROM ontology_card
    WHERE card_type IN ('pattern','asset_memory','risk_rule')
  `).all();
  const msgStmt = conn.prepare('SELECT id, created_at FROM messages WHERE id = ?');
  return { cards, lookupCreatedAt(id) {
    if (!id) return null;
    const row = msgStmt.get(id);
    return row?.created_at ?? null;
  } };
}

export function firstSourceMessageId(card) {
  const ids = parseJsonArr(card.source_message_ids_json);
  return ids[0] || null;
}

export async function fetchYahooDailyBars(ticker, { period1, period2 } = {}) {
  const p1 = period1 || Math.floor(Date.now() / 1000) - 86400 * 400;
  const p2 = period2 || Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${ticker}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`no chart for ${ticker}`);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    const d = etCalendarDate(ts[i] * 1000);
    bars.push({
      date: d,
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close[i],
      adjClose: adj[i] != null ? adj[i] : q.close[i]
    });
  }
  return bars;
}
