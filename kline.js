import dotenv from 'dotenv';
dotenv.config();

/**
 * Fetch daily K-line details for a single ticker from Yahoo Finance.
 * Includes current price, 5-day SMA, 5-day high/low range, and last 5 closes.
 * @param {string} ticker 
 * @returns {Promise<object>}
 */
export async function fetchTickerKlineData(ticker) {
  const cleanTicker = ticker.trim().toUpperCase();
  let symbol = cleanTicker;

  // Map crypto or special tickers for Yahoo Finance compatibility
  if (symbol === 'BTC') symbol = 'BTC-USD';
  if (symbol === 'ETH') symbol = 'ETH-USD';

  // Configurable constants with sensible defaults
  const YAHOO_FINANCE_BASE_URL = process.env.YAHOO_FINANCE_BASE_URL || 'https://query1.finance.yahoo.com';
  const KLINE_TIMEOUT_MS = parseInt(process.env.KLINE_TIMEOUT_MS || '8000', 10);
  const KLINE_RANGE = process.env.KLINE_RANGE || '10d';
  const KLINE_INTERVAL = process.env.KLINE_INTERVAL || '1d';

  const url = `${YAHOO_FINANCE_BASE_URL}/v8/finance/chart/${symbol}?range=${KLINE_RANGE}&interval=${KLINE_INTERVAL}`;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), KLINE_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 429 && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`Yahoo Finance HTTP ${res.status}`);
      }

      const json = await res.json();
      const result = json.chart?.result?.[0];
      if (!result) {
        throw new Error('Invalid symbol or no chart data returned');
      }

      const meta = result.meta;
      const currentPrice = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose;
      const changePercent = previousClose ? ((currentPrice - previousClose) / previousClose * 100).toFixed(2) : 'N/A';

      const quote = result.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const highs = quote.high || [];
      const lows = quote.low || [];

      const validCloses = closes.filter(c => c !== null && c !== undefined);
      const validHighs = highs.filter(h => h !== null && h !== undefined);
      const validLows = lows.filter(l => l !== null && l !== undefined);

      let sma5 = 'N/A';
      if (validCloses.length >= 5) {
        const last5 = validCloses.slice(-5);
        sma5 = (last5.reduce((sum, val) => sum + val, 0) / 5).toFixed(2);
      }

      const high5d = validHighs.length > 0 ? Math.max(...validHighs.slice(-5)).toFixed(2) : 'N/A';
      const low5d = validLows.length > 0 ? Math.min(...validLows.slice(-5)).toFixed(2) : 'N/A';

      return {
        success: true,
        ticker: cleanTicker,
        symbol: symbol,
        currentPrice: currentPrice ? currentPrice.toFixed(2) : 'N/A',
        changePercent: changePercent,
        sma5: sma5,
        high5d: high5d,
        low5d: low5d,
        lastCloses: validCloses.slice(-5).map(c => c.toFixed(2))
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt < MAX_RETRIES && (err.name === 'AbortError' || err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('network'))) {
        console.warn(`[Kline Engine] 重试 ${ticker} (${attempt + 1}/${MAX_RETRIES}): ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error(`[Kline Engine] Failed to fetch data for ${ticker} (${symbol}):`, err.message);
      return {
        success: false,
        ticker: cleanTicker,
        symbol: symbol,
        reason: err.message
      };
    }
  }
}

/**
 * Fetch K-line data for multiple tickers in parallel and format into a markdown segment.
 * @param {Array<string>} tickers 
 * @returns {Promise<string>}
 */
export async function getMarketContextForTickers(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return '*无提及的个股或未识别到个股标的*';
  }

  // Limit to max 8 tickers to avoid token bloat and rate limits
  const targetTickers = tickers.slice(0, 8);
  console.log(`[Kline Engine] Fetching K-line trends for tickers: ${targetTickers.join(', ')}`);

  const promises = targetTickers.map(ticker => fetchTickerKlineData(ticker));
  const results = await Promise.all(promises);

  let md = '### 📊 提及个图标的当前 K 线行情数据 (Yahoo Finance)\n\n';
  md += '| 代码 | 当前价 | 今日涨跌幅 | 5日均线 (SMA5) | 5日波动区间 (Low-High) | 最近5日收盘价趋势 |\n';
  md += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';

  let hasSuccessfulFetch = false;

  for (const res of results) {
    if (res.success) {
      hasSuccessfulFetch = true;
      const changeColor = parseFloat(res.changePercent) >= 0 ? '🔴' : '🟢'; // Red is up, Green is down in CN style
      const sign = parseFloat(res.changePercent) >= 0 ? '+' : '';
      const trendStr = res.lastCloses.join(' ➡️ ');
      md += `| **${res.ticker}** | $${res.currentPrice} | ${changeColor} ${sign}${res.changePercent}% | $${res.sma5} | $${res.low5d} - $${res.high5d} | ${trendStr} |\n`;
    } else {
      md += `| **${res.ticker}** | *获取失败* | - | - | - | *原因: ${res.reason}* |\n`;
    }
  }

  if (!hasSuccessfulFetch) {
    return '*无有效行情数据（未能成功连接到行情服务器）*';
  }

  return md;
}
