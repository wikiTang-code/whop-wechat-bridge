/**
 * REQ-037 Phase 2 — heuristic Semantic CU segmenter (v1).
 * Offline / sample only. Does not call VL or 14B.
 *
 * Boundary triggers (any):
 *  - idle gap > gapMs (default 30m)
 *  - primary ticker set changes (non-empty → different non-empty)
 * Optional future: embedding cosine drift via message_embeddings.
 */

function parseTickers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).toUpperCase()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t).toUpperCase()).filter(Boolean);
  } catch (_) {}
  return String(raw)
    .split(/[,\s|/]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

function primaryTicker(tickers) {
  return tickers[0] || null;
}

function tickerShift(prev, next) {
  if (!prev || !next) return false;
  return prev !== next;
}

/**
 * @param {Array<{id:string, channel_id?:string, created_at:number, tickers?:any, sender_name?:string}>} messages
 * @param {{ gapMs?: number, method?: string }} [opts]
 * @returns {Array<object>} CU drafts ready for saveSemanticCu
 */
export function segmentMessagesIntoSemanticCu(messages, opts = {}) {
  const gapMs = Number.isFinite(opts.gapMs) ? opts.gapMs : 30 * 60 * 1000;
  const method = opts.method || 'heuristic_v1';
  const sorted = [...(messages || [])].sort(
    (a, b) => Number(a.created_at) - Number(b.created_at) || String(a.id).localeCompare(String(b.id)),
  );
  if (!sorted.length) return [];

  const units = [];
  let bucket = [];
  let bucketPrimary = null;
  let bucketChannel = null;

  const flush = () => {
    if (!bucket.length) return;
    const startTs = Number(bucket[0].created_at) || 0;
    const endTs = Number(bucket[bucket.length - 1].created_at) || startTs;
    const id = `cu_${bucketChannel || 'na'}_${startTs}_${bucket[0].id}`;
    units.push({
      id,
      channel_id: bucketChannel || null,
      topic_label: bucketPrimary ? `ticker:${bucketPrimary}` : 'general',
      primary_ticker: bucketPrimary,
      start_ts: startTs,
      end_ts: endTs,
      method,
      status: 'draft',
      members: bucket.map((m, i) => ({
        message_id: m.id,
        seq: i,
        role: /群友|学员|user/i.test(String(m.sender_name || '')) ? 'question' : 'utterance',
      })),
      meta_json: { gap_ms: gapMs, heuristic: true },
    });
    bucket = [];
    bucketPrimary = null;
    bucketChannel = null;
  };

  for (const msg of sorted) {
    const tickers = parseTickers(msg.tickers);
    const p = primaryTicker(tickers);
    const ts = Number(msg.created_at) || 0;
    const channelId = msg.channel_id || null;

    if (!bucket.length) {
      bucket = [msg];
      bucketPrimary = p;
      bucketChannel = channelId;
      continue;
    }

    const prevTs = Number(bucket[bucket.length - 1].created_at) || 0;
    const gapBreak = ts - prevTs > gapMs;
    const channelBreak = channelId && bucketChannel && channelId !== bucketChannel;
    const topicBreak = tickerShift(bucketPrimary, p);

    if (gapBreak || channelBreak || topicBreak) {
      flush();
      bucket = [msg];
      bucketPrimary = p;
      bucketChannel = channelId;
    } else {
      bucket.push(msg);
      if (!bucketPrimary && p) bucketPrimary = p;
    }
  }
  flush();
  return units;
}
