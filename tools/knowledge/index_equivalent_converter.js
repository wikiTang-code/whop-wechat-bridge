/**
 * tools/knowledge/index_equivalent_converter.js
 * 标普500指数 (SPX) 与 ETF (SPY) 跨时段动态等效换算引擎
 *
 * 业务背景:
 * 美股标普500现货指数 (SPX) 仅在常规盘中 (RTH 09:30 - 16:00 ET) 实时撮合计算发布;
 * 在夜盘 (Overnight)、盘前 (Pre-Market) 与盘后 (Post-Market) 时段，SPX 现货停止更新。
 * 此时通过全天候活跃交易的 SPY (SPDR S&P 500 ETF) 现价与动态比率，
 * 精确换算为 SPX 等效现价，确保大盘微观结构、GEX 磁吸与四维共振决策 24 小时不中断。
 */

export const DEFAULT_SPX_SPY_RATIO = 10.0;

/** TradingView CAPITALCOM:SPX500 外部全天候实时图表/CFD参考源 */
export const TRADINGVIEW_SPX500_URL = 'https://www.tradingview.com/chart/?symbol=CAPITALCOM%3ASPX500';

let cachedTvQuote = null;
let lastTvFetchTs = 0;
const TV_CACHE_TTL_MS = 3000; // 3 秒热缓存

/**
 * 从 TradingView 公共行情源探测并获取 SPX 实时指数 (极速实时通道)
 * @param {object} options - { timeoutMs, forceRefresh }
 * @returns {Promise<object|null>}
 */
export async function fetchTradingViewSpxQuote(options = {}) {
  const now = Date.now();
  if (!options.forceRefresh && cachedTvQuote && now - lastTvFetchTs < TV_CACHE_TTL_MS) {
    return cachedTvQuote;
  }

  const timeoutMs = options.timeoutMs || 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({
        symbols: { tickers: ['SP:SPX'] },
        columns: ['close', 'change', 'open', 'high', 'low']
      })
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const json = await res.json();
    const row = json.data?.[0]?.d;
    if (row && typeof row[0] === 'number' && row[0] > 0) {
      const close = parseFloat(row[0].toFixed(2));
      const changePct = parseFloat((row[1] || 0).toFixed(4));
      const prevClose = changePct !== 0
        ? parseFloat((close / (1 + changePct / 100)).toFixed(2))
        : close;

      const tvQuote = {
        ticker: 'SPX',
        symbol: 'SP:SPX',
        source: 'TRADINGVIEW_DIRECT',
        cfd_ref_url: TRADINGVIEW_SPX500_URL,
        last_price: close,
        change_pct: changePct,
        prev_close: prevClose,
        open: parseFloat((row[2] || close).toFixed(2)),
        high: parseFloat((row[3] || close).toFixed(2)),
        low: parseFloat((row[4] || close).toFixed(2)),
        volume: 0,
        timestamp: Date.now(),
        is_derived_from_spy: false,
        is_tradingview_direct: true,
      };

      cachedTvQuote = tvQuote;
      lastTvFetchTs = now;
      return tvQuote;
    }
  } catch (_) {
    clearTimeout(timer);
  }
  return null;
}

// 别名兼容
export const fetchTradingViewSpxSpot = fetchTradingViewSpxQuote;

/**
 * 将 SPY 价格换算为 SPX 等效价格
 * @param {number} spyPrice - SPY 实时成交价
 * @param {object} options - 换算参数 { spxPrevClose, spyPrevClose, defaultRatio }
 * @returns {object} - { spx_equivalent_price, spy_base_price, ratio, method, is_derived }
 */
export function convertSpyToSpx(spyPrice, options = {}) {
  const p = parseFloat(spyPrice);
  if (!p || isNaN(p) || p <= 0) {
    throw new Error('INVALID_SPY_PRICE: spyPrice must be a positive number');
  }

  let ratio = options.defaultRatio || DEFAULT_SPX_SPY_RATIO;
  let method = 'STANDARD_RATIO';

  if (options.spxPrevClose && options.spyPrevClose) {
    const spxPrev = parseFloat(options.spxPrevClose);
    const spyPrev = parseFloat(options.spyPrevClose);
    if (spxPrev > 0 && spyPrev > 0) {
      ratio = spxPrev / spyPrev;
      method = 'DYNAMIC_PREV_CLOSE_RATIO';
    }
  }

  const spxPrice = parseFloat((p * ratio).toFixed(2));

  return {
    spx_equivalent_price: spxPrice,
    spy_base_price: p,
    ratio: parseFloat(ratio.toFixed(4)),
    method,
    is_derived: true,
  };
}

/**
 * 解析 SPX 行情 (三级高精阶梯: 优先 TradingView 极速直连 -> 券商盘中现货 -> SPY 动态换算兜底)
 * @param {object|null} spxQuote - 券商原始 quote
 * @param {object|null} spyQuote - 券商 SPY quote
 * @param {object} options - { isRth, tvQuote, logFallback }
 * @returns {object|null}
 */
export function resolveSpxQuote(spxQuote, spyQuote, options = {}) {
  const tvQuote = options.tvQuote || null;

  // 1. 优先采用 TradingView 实时高精数据
  if (tvQuote && tvQuote.last_price > 0) {
    if (options.logFallback) {
      console.log(`[Index Converter] 🚀 直接优先采用 TradingView 实时 SPX: $${tvQuote.last_price} (${tvQuote.change_pct}%)`);
    }
    return tvQuote;
  }

  // 2. 检查券商真实行情 (若在 RTH 且具备有效现价)
  const isRth = options.isRth ?? false;
  const hasValidBrokerSpx = spxQuote && parseFloat(spxQuote.last_price || spxQuote.lastDone || 0) > 0;
  if (isRth && hasValidBrokerSpx) {
    return {
      ...spxQuote,
      is_derived_from_spy: false,
      source: 'BROKER_RTH_DIRECT',
    };
  }

  // 3. 兜底方案：自动通过全天候交易的 SPY 动态等效折算
  const spyPrice = parseFloat(spyQuote?.last_price || spyQuote?.lastDone || 0);
  if (spyPrice > 0) {
    const conversion = convertSpyToSpx(spyPrice, {
      spxPrevClose: spxQuote?.prev_close || spxQuote?.prevClose,
      spyPrevClose: spyQuote?.prev_close || spyQuote?.prevClose,
    });

    if (options.logFallback) {
      console.log(`[Index Converter] 🔄 触发 SPY 动态换算兜底，折算等效 SPX: $${conversion.spx_equivalent_price} (比率 ${conversion.ratio})`);
    }

    return {
      ticker: 'SPX',
      symbol: spxQuote?.symbol || '.SPX.US',
      source: 'SPY_DYNAMIC_EQUIVALENT',
      last_price: conversion.spx_equivalent_price,
      prev_close: parseFloat(spxQuote?.prev_close || spxQuote?.prevClose || (conversion.spx_equivalent_price).toFixed(2)),
      high: spxQuote?.high || conversion.spx_equivalent_price,
      low: spxQuote?.low || conversion.spx_equivalent_price,
      volume: spxQuote?.volume || 0,
      timestamp: Date.now(),
      is_derived_from_spy: true,
      derived_meta: conversion,
    };
  }

  return spxQuote || null;
}

/**
 * 异步全自动解析 SPX 行情 (并发尝试 TradingView)
 */
export async function resolveSpxQuoteAsync(spxQuote, spyQuote, options = {}) {
  let tvQuote = null;
  try {
    tvQuote = await fetchTradingViewSpxQuote({ timeoutMs: options.timeoutMs || 1500 });
  } catch (_) {}

  return resolveSpxQuote(spxQuote, spyQuote, {
    ...options,
    tvQuote,
  });
}
