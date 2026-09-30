/**
 * CHG-063: WeCom paper confirm card. Not the real EXECUTE path.
 * Push is deferred off HOT. No follow-success copy. No place_order.
 * Confirm submits Paper only when ask slip vs px_zhao is <= 40bp; otherwise record C.
 */
import { generateHitlToken, verifyHitlToken } from '../../follow-hitl.js';
import { calculateSlipBps, FOLLOW_SPEC } from '../../follow-decision-engine.js';
import { getBaseUrl } from '../../follow-replay-engine.js';
import { deferOffHot } from '../ingest/hot_defer.js';
import { getTradeIntent } from '../../database.js';
import { confirmAndSubmitIntent, AUTO_SUBMIT_ENABLED } from './paper_execution_engine.js';

const BANNED = /已跟单成功|跟单成功|place_order/;

export function buildPaperWecomMarkdown({
  intentId,
  ticker,
  side,
  pxZhao,
  arriveDeltaSec = null,
  ask = null,
  createdAt = Date.now()
}) {
  const token = generateHitlToken(intentId, ticker, side, createdAt);
  const base = getBaseUrl();
  const confirmUrl = `${base}/api/paper/wecom-card?action=CONFIRM&intent_id=${encodeURIComponent(intentId)}&token=${token}&t=${createdAt}`;
  const skipUrl = `${base}/api/paper/wecom-card?action=SKIP&intent_id=${encodeURIComponent(intentId)}&token=${token}&t=${createdAt}`;
  const delta = arriveDeltaSec == null ? '—' : `${arriveDeltaSec}s`;
  const askText = ask == null ? '—' : `$${ask}`;
  const text = [
    '**模拟盘待确认**',
    `票 **${ticker}** ｜ 方向 **${side}**`,
    `口播价 \`$${pxZhao}\` ｜ 到达 Δ \`${delta}\` ｜ 现价 ${askText}`,
    `[确认Paper](${confirmUrl})`,
    `[放弃](${skipUrl})`
  ].join('\n');
  if (BANNED.test(text)) throw new Error('REFUSE: paper card must not say follow success');
  return { text, token, createdAt };
}

export function schedulePaperWecomPush(job, { defer = deferOffHot } = {}) {
  defer(() => job());
}

export async function pushPaperWecomCard(markdown, { send, fetchImpl = fetch, webhookUrl = null } = {}) {
  if (typeof send === 'function') return send(markdown);
  const url = webhookUrl || process.env.WECOM_TRADE_WEBHOOK_URL;
  if (!url) {
    console.error('[CHG-063] WeCom paper card skipped: WECOM_TRADE_WEBHOOK_URL unset');
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: markdown } })
    });
    const json = await res.json().catch(() => ({}));
    if (json.errcode != null && json.errcode !== 0) {
      console.error('[CHG-063] WeCom paper card failed:', json.errmsg || json.errcode);
      return { ok: false, error: json.errmsg || String(json.errcode) };
    }
    return { ok: true, via: 'trade_webhook' };
  } catch (err) {
    console.error('[CHG-063] WeCom paper card failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function handlePaperWecomAction({
  intentId,
  action,
  token,
  createdAt,
  ask = null,
  dbInstance = null,
  submit = null
} = {}) {
  if (AUTO_SUBMIT_ENABLED === true) {
    throw new Error('REFUSE: AUTO_SUBMIT_ENABLED must stay false');
  }
  const intent = getTradeIntent(intentId, dbInstance);
  if (!intent) return { ok: false, code: 404, error: 'intent missing' };
  if (intent.status !== 'PENDING_HITL') {
    return { ok: false, code: 409, error: `intent is ${intent.status}` };
  }
  const ticker = intent.ticker;
  const side = intent.side;
  const stamp = Number(createdAt) || Number(intent.created_at);
  if (!verifyHitlToken(intentId, ticker, side, stamp, token)) {
    return { ok: false, code: 400, error: 'bad token' };
  }
  const act = String(action || '').toUpperCase();
  if (act === 'SKIP') {
    return { ok: true, state: 'SKIPPED', submitted: false, message: '已放弃，未报单' };
  }
  if (act !== 'CONFIRM') return { ok: false, code: 400, error: 'unknown action' };

  const px = Number(intent.px_zhao ?? intent.price_limit);
  const slip = calculateSlipBps(side, px, Number(ask));
  if (!(Number(ask) > 0) || slip > FOLLOW_SPEC.SLIP_REJECT_BPS) {
    return {
      ok: true,
      state: 'C',
      submitted: false,
      slip_bps: slip,
      message: `C: ask slip ${slip}bp > ${FOLLOW_SPEC.SLIP_REJECT_BPS}bp，未报单`
    };
  }
  const doSubmit = submit || ((id) => confirmAndSubmitIntent(id, { dbInstance, awaitFinalStatus: false }));
  const result = await doSubmit(intentId);
  return { ok: true, state: 'PAPER_SUBMITTED', submitted: true, slip_bps: slip, result };
}
