/**
 * CHG-064 knife 2. Off unless FILL_RECEIPT_ENABLED=true.
 * Sends only when source is zhao_follow and status is FILLED.
 * Not imported by ingest. Does not say 已跟单成功.
 */
export function fillReceiptEnabled(env = process.env) {
  return String(env.FILL_RECEIPT_ENABLED || '').toLowerCase() === 'true';
}

export function shouldSendFillReceipt(row) {
  return row?.source === 'zhao_follow' && String(row?.status || '').toUpperCase() === 'FILLED';
}

export function buildFillReceipt(row) {
  const text = `成交回执 ${row.ticker} ${row.side || row.action} ${row.quantity || 1}股 @ ${row.fill_price}`;
  if (/已跟单成功|跟单成功/.test(text)) {
    throw new Error('REFUSE: receipt must not say follow success');
  }
  return text;
}

export async function maybeSendFillReceipt(row, { send, env = process.env } = {}) {
  if (!fillReceiptEnabled(env)) return { sent: false, reason: 'DISABLED' };
  if (!shouldSendFillReceipt(row)) return { sent: false, reason: 'GATE' };
  if (typeof send !== 'function') return { sent: false, reason: 'NO_SENDER' };
  await send(buildFillReceipt(row));
  return { sent: true, reason: 'SENT' };
}
