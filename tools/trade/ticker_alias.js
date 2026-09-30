/**
 * CHG-064: Chinese name → ticker. Does not change the latin regex.
 * 谷歌A maps to GOOGL. Unknown suffixes stay a regex miss.
 */
const VERB = '(加了|买了|加回|开了|出掉|出了一半|出一半|出了)';
const BUY = new Set(['加了', '买了', '加回', '开了']);
const OPTION_RE = /\d{6}[CP]\d+/i;

export const TICKER_ALIASES = Object.freeze({
  谷歌A: 'GOOGL'
});

export function parseAliasPrint(text) {
  const raw = String(text || '').replace(/\s+/g, '').trim();
  if (!raw || OPTION_RE.test(raw)) return null;
  for (const [alias, ticker] of Object.entries(TICKER_ALIASES)) {
    if (!raw.endsWith(alias)) continue;
    const head = raw.slice(0, -alias.length);
    const m = head.match(new RegExp(`^(\\d+(?:\\.\\d+)?)(?:附近)?${VERB}(.*)$`));
    if (!m) continue;
    const px = Number(m[1]);
    if (!(px > 0)) continue;
    return {
      ticker,
      action: BUY.has(m[2]) ? 'BUY' : 'SELL',
      price: px,
      verb: m[2],
      fraction: m[3] || '',
      raw,
      via: 'alias',
      alias
    };
  }
  return null;
}
