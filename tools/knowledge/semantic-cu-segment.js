/**
 * REQ-037 Phase 2 — heuristic + optional embedding-drift Semantic CU segmenter.
 * Offline / sample only. Does not call VL or 14B.
 *
 * Boundary triggers (any):
 *  - idle gap > gapMs (default 30m)
 *  - primary ticker set changes (non-empty → different non-empty)
 *  - channel_id changes
 *  - (embed_drift_v1) cosine(prev, cur) < embedThreshold when both embeddings present
 */

import { cosineSimilarity } from './semantic-cu-eval.js';

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

function resolveEmbedding(msg, embeddingsById) {
  if (msg?.embedding) return msg.embedding;
  if (embeddingsById && msg?.id != null) return embeddingsById[msg.id] || null;
  return null;
}

/**
 * @param {Array<object>} messages
 * @param {{
 *   gapMs?: number,
 *   method?: 'heuristic_v1'|'embed_drift_v1',
 *   embedThreshold?: number,
 *   embeddingsById?: Record<string, Float32Array|number[]>
 * }} [opts]
 * @returns {Array<object>} CU drafts ready for saveSemanticCu
 */
export function segmentMessagesIntoSemanticCu(messages, opts = {}) {
  const gapMs = Number.isFinite(opts.gapMs) ? opts.gapMs : 30 * 60 * 1000;
  const method = opts.method || 'heuristic_v1';
  const useEmbed = method === 'embed_drift_v1' || opts.embedDrift === true;
  const embedThreshold = Number.isFinite(opts.embedThreshold) ? opts.embedThreshold : 0.55;
  const embeddingsById = opts.embeddingsById || null;

  const sorted = [...(messages || [])].sort(
    (a, b) => Number(a.created_at) - Number(b.created_at) || String(a.id).localeCompare(String(b.id)),
  );
  if (!sorted.length) return [];

  const units = [];
  let bucket = [];
  let bucketPrimary = null;
  let bucketChannel = null;
  let bucketCentroid = null;

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
      meta_json: {
        gap_ms: gapMs,
        heuristic: true,
        embed_drift: useEmbed,
        embed_threshold: useEmbed ? embedThreshold : null,
      },
    });
    bucket = [];
    bucketPrimary = null;
    bucketChannel = null;
    bucketCentroid = null;
  };

  for (const msg of sorted) {
    const tickers = parseTickers(msg.tickers);
    const p = primaryTicker(tickers);
    const ts = Number(msg.created_at) || 0;
    const channelId = msg.channel_id || null;
    const emb = resolveEmbedding(msg, embeddingsById);

    if (!bucket.length) {
      bucket = [msg];
      bucketPrimary = p;
      bucketChannel = channelId;
      bucketCentroid = emb || null;
      continue;
    }

    const prevTs = Number(bucket[bucket.length - 1].created_at) || 0;
    const gapBreak = ts - prevTs > gapMs;
    const channelBreak = channelId && bucketChannel && channelId !== bucketChannel;
    const topicBreak = tickerShift(bucketPrimary, p);

    let embedBreak = false;
    if (useEmbed && emb && bucketCentroid) {
      const sim = cosineSimilarity(bucketCentroid, emb);
      if (sim != null && sim < embedThreshold) embedBreak = true;
    }

    if (gapBreak || channelBreak || topicBreak || embedBreak) {
      flush();
      bucket = [msg];
      bucketPrimary = p;
      bucketChannel = channelId;
      bucketCentroid = emb || null;
    } else {
      bucket.push(msg);
      if (!bucketPrimary && p) bucketPrimary = p;
      if (emb) {
        if (!bucketCentroid) {
          bucketCentroid = emb;
        } else if (bucketCentroid.length === emb.length) {
          // running mean of vectors in the CU
          const next = new Float32Array(bucketCentroid.length);
          const n = bucket.length;
          for (let i = 0; i < next.length; i++) {
            next[i] = bucketCentroid[i] + (emb[i] - bucketCentroid[i]) / n;
          }
          bucketCentroid = next;
        }
      }
    }
  }
  flush();
  return units;
}
