/**
 * CHG-060 / DEBT-026 — persist Zhao filled prints into trade_signals + Intent.
 *
 * Deterministic parse only (no LLM). Hard-lock sender + trade channels.
 * t_arrive = poll_seen (else persist wall clock). px_arrive stays empty until fill.
 * Never AUTO_SUBMIT / confirmAndSubmitIntent / wecom follow-success.
 * source is zhao_print, never zhao_follow or counter_smoke.
 */
import { saveTradeSignal, getDb, ensurePaperTradingTables } from '../../database.js';
import { convertSignalToTradeIntent, ZHAO_SENDER_ID, ALLOWED_CHANNELS } from './signal_intent_bridge.js';
import { AUTO_SUBMIT_ENABLED } from './paper_execution_engine.js';
import { generateFollowCardPayload } from '../../follow-hitl.js';

export { ZHAO_SENDER_ID, ALLOWED_CHANNELS };

export const PRINT_SOURCE = 'zhao_print';
export const FORUM_CHANNEL = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN';
export const FINGERPRINT_BUCKET_MS = 120_000;

const BUY_RE = /^(\d+(?:\.\d+)?)(?:附近)?(加了|买了|加回|开了)(.*?)([A-Za-z]{2,6})$/;
const SELL_RE = /^(\d+(?:\.\d+)?)(?:附近)?(出掉|出了一半|出一半|出了)(.*?)([A-Za-z]{2,6})$/;
const OPTION_RE = /\d{6}[CP]\d+/i;
const BAD_TICKER = /^(CALL|PUT|THE|OF|US|USD)$/i;

export function parseZhaoFilledPrint(text) {
  const raw = String(text || '').replace(/\s+/g, '').trim();
  if (!raw || OPTION_RE.test(raw)) return null;

  let m = raw.match(BUY_RE);
  let action = 'BUY';
  if (!m) {
    m = raw.match(SELL_RE);
    action = 'SELL';
  }
  if (!m) return null;

  const px = Number(m[1]);
  const ticker = String(m[4] || '').toUpperCase();
  if (!Number.isFinite(px) || px <= 0) return null;
  if (!ticker || BAD_TICKER.test(ticker) || /\d/.test(ticker)) return null;

  return {
    ticker,
    action,
    price: px,
    verb: m[2],
    fraction: m[3] || '',
    raw
  };
}

export function isZhaoTradeChannelMessage(msg = {}) {
  return msg.sender_id === ZHAO_SENDER_ID
    && ALLOWED_CHANNELS.includes(String(msg.channel_id || ''));
}

function existingSignalForMessage(conn, messageId) {
  if (!messageId) return null;
  try {
    return conn.prepare(
      'SELECT signal_id FROM trade_signals WHERE message_id = ? LIMIT 1'
    ).get(messageId) || null;
  } catch (_) {
    return null;
  }
}

export function zhaoPrintFingerprint({ senderId, ticker, side, pxZhao, createdAt }) {
  const bucket = Math.floor(Number(createdAt) / FINGERPRINT_BUCKET_MS);
  return `${senderId}|${String(ticker).toUpperCase()}|${String(side).toUpperCase()}|${Number(pxZhao)}|${bucket}`;
}

function fingerprintWindow(createdAt) {
  const bucket = Math.floor(Number(createdAt) / FINGERPRINT_BUCKET_MS);
  return { start: bucket * FINGERPRINT_BUCKET_MS, end: (bucket + 1) * FINGERPRINT_BUCKET_MS };
}

function findIntentForFingerprint(conn, { ticker, side, pxZhao, createdAt }) {
  const { start, end } = fingerprintWindow(createdAt);
  try {
    return conn.prepare(`
      SELECT intent_id, status, source, ticker, side, price_limit
      FROM trade_intents
      WHERE ticker = ? AND side = ? AND ABS(price_limit - ?) < 0.0001
        AND created_at >= ? AND created_at < ?
        AND source LIKE 'zhao_signal_%'
        AND status != 'REJECTED_NO_UNDERLYING_POSITION'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(String(ticker).toUpperCase(), String(side).toUpperCase(), Number(pxZhao), start, end) || null;
  } catch (_) {
    return null;
  }
}

export function emitZhaoPrintHitlCard(intent, signal, db) {
  const createdAt = Number(signal.t_arrive) || Date.now();
  const decision = {
    decision_id: `dec_${intent.intent_id}`,
    signal_id: signal.signal_id,
    message_id: signal.message_id,
    account_type: 'paper',
    decision_state: 'WAIT_MANUAL_CONFIRM',
    ticker: intent.ticker,
    side: intent.side,
    call_price: intent.px_zhao ?? intent.price_limit,
    arrival_price: null,
    created_at: createdAt,
    updated_at: createdAt,
    reason: `zhao_print PENDING_HITL intent:${intent.intent_id}`
  };
  const card = generateFollowCardPayload(decision);
  try {
    db.prepare(`
      INSERT INTO follow_decisions (
        decision_id, signal_id, message_id, account_type, decision_state,
        ticker, side, call_price, arrival_price, reason, created_at, updated_at
      ) VALUES (
        @decision_id, @signal_id, @message_id, @account_type, @decision_state,
        @ticker, @side, @call_price, @arrival_price, @reason, @created_at, @updated_at
      )
    `).run(decision);
  } catch (err) {
    console.error('[CHG-062] HITL card row skipped:', err.message);
  }
  return card;
}

export function persistZhaoFilledPrints(messages, { dbInstance = null, createIntent = true, onHitlCard = null } = {}) {
  if (AUTO_SUBMIT_ENABLED === true) {
    throw new Error('REFUSE: AUTO_SUBMIT_ENABLED must stay false');
  }
  const db = dbInstance || getDb();
  ensurePaperTradingTables(db);
  const list = Array.isArray(messages) ? messages : [];
  const results = [];

  for (const msg of list) {
    if (!isZhaoTradeChannelMessage(msg)) {
      results.push({ message_id: msg?.id, skipped: true, reason: 'NOT_ZHAO_TRADE_CHANNEL' });
      continue;
    }
    const parsed = parseZhaoFilledPrint(msg.content);
    if (!parsed) {
      results.push({ message_id: msg.id, skipped: true, reason: 'NO_FILLED_PRINT' });
      continue;
    }

    const existing = existingSignalForMessage(db, msg.id);
    if (existing) {
      results.push({
        message_id: msg.id,
        skipped: true,
        reason: 'ALREADY_PERSISTED',
        signal_id: existing.signal_id
      });
      continue;
    }

    const tArrive = Number(msg.poll_seen_at || msg.t_arrive);
    const signalId = `sig_zhao_${msg.id}`;
    const signal = {
      signal_id: signalId,
      message_id: msg.id,
      channel_id: msg.channel_id,
      speaker_id: ZHAO_SENDER_ID,
      speaker_name: msg.sender_name || 'xiaozhaolucky',
      ticker: parsed.ticker,
      action: parsed.action,
      price: parsed.price,
      quantity: 1,
      reason: String(msg.content || '').slice(0, 200),
      parse_status: 'ok',
      source: PRINT_SOURCE,
      created_at: Number(msg.created_at) || Date.now(),
      t_arrive: Number.isFinite(tArrive) && tArrive > 0 ? Math.trunc(tArrive) : Date.now(),
      px_arrive: null,
      px_arrive_source: null
    };
    saveTradeSignal(signal, db);

    const row = db.prepare('SELECT * FROM trade_signals WHERE signal_id = ?').get(signalId);
    const out = {
      message_id: msg.id,
      skipped: false,
      parsed,
      signal: row,
      intent: null,
      intent_reason: null
    };

    const printAt = Number(msg.created_at) || Date.now();
    const prior = findIntentForFingerprint(db, {
      ticker: parsed.ticker,
      side: parsed.action,
      pxZhao: parsed.price,
      createdAt: printAt
    });
    if (!createIntent || prior) {
      out.intent_reason = prior ? 'SIGNAL_ONLY_DUPLICATE_FINGERPRINT' : 'INTENT_DISABLED';
      out.fingerprint = zhaoPrintFingerprint({
        senderId: ZHAO_SENDER_ID,
        ticker: parsed.ticker,
        side: parsed.action,
        pxZhao: parsed.price,
        createdAt: printAt
      });
    } else {
      const bridged = convertSignalToTradeIntent({
        ...signal,
        px_arrive: null,
        px_arrive_source: null
      }, { dbInstance: db });
      out.intent = bridged.intent || null;
      out.intent_reason = bridged.reason || null;
      if (out.intent && String(out.intent.source || '').includes('zhao_follow')) {
        throw new Error('REFUSE: persist must not write source=zhao_follow');
      }
      if (out.intent && out.intent.status === 'SUBMITTED') {
        throw new Error('REFUSE: persist must not submit');
      }
      if (out.intent && out.intent.status === 'PENDING_HITL') {
        db.prepare('UPDATE trade_intents SET created_at = ? WHERE intent_id = ?').run(printAt, out.intent.intent_id);
        out.intent.created_at = printAt;
        out.fingerprint = zhaoPrintFingerprint({
          senderId: ZHAO_SENDER_ID,
          ticker: parsed.ticker,
          side: parsed.action,
          pxZhao: parsed.price,
          createdAt: printAt
        });
        const emit = onHitlCard || ((intent, sig) => emitZhaoPrintHitlCard(intent, sig, db));
        out.hitl_card = emit(out.intent, row);
      }
    }

    results.push(out);
  }

  return results;
}
