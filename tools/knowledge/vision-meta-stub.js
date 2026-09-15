/**
 * REQ-037 Phase 1 — stub vision extractor (no VL call).
 * Builds Visual Anchor schema from attachments + message text/tickers.
 * Real VL (local/cloud) is gated by Q-006; provider stays `stub` / status `pending_vl` when image present.
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

function parseAttachments(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function guessTicker(message) {
  if (message?.tickers) {
    try {
      const arr = typeof message.tickers === 'string' ? JSON.parse(message.tickers) : message.tickers;
      if (Array.isArray(arr) && arr[0]) return String(arr[0]).toUpperCase();
    } catch { /* ignore */ }
  }
  const text = String(message?.content || '');
  const m = text.match(/\b([A-Z]{1,5})\b/);
  return m ? m[1] : null;
}

function attachLocalPath(att) {
  if (!att || typeof att !== 'object') return null;
  return att.local_path || att.path || att.file || null;
}

function isImageAttachment(att, localPath) {
  const path = localPath || attachLocalPath(att) || '';
  if (IMAGE_EXT.test(path)) return true;
  const mime = String(att?.mime || att?.content_type || '');
  return /^image\//i.test(mime);
}

/**
 * @param {object} message — row with id, content, tickers, attachments
 * @returns {Array<object>} metas ready for saveMessageVisionMeta
 */
export function buildStubVisionMetas(message) {
  const attachments = parseAttachments(message.attachments);
  const ticker = guessTicker(message);
  const out = [];

  if (attachments.length === 0) {
    // content-only [IMAGE:url] — still record a pending slot for later VL
    const hasImageTag = /\[IMAGE:/i.test(String(message.content || ''));
    if (!hasImageTag) return out;
    const schema = {
      chart_type: 'UNKNOWN',
      ticker,
      timeframe: null,
      patterns: [],
      support_resistance: null,
      hand_drawn_annotation: 'content IMAGE tag only; awaiting VL (Q-006)',
    };
    out.push({
      message_id: message.id,
      attach_index: 0,
      local_path: null,
      schema,
      chart_type: schema.chart_type,
      ticker,
      provider: 'stub',
      status: 'pending_vl',
    });
    return out;
  }

  attachments.forEach((att, idx) => {
    const localPath = attachLocalPath(att);
    const image = isImageAttachment(att, localPath);
    const schema = {
      chart_type: image ? 'K_LINE' : 'UNKNOWN',
      ticker,
      timeframe: null,
      patterns: [],
      support_resistance: null,
      hand_drawn_annotation: image
        ? 'stub placeholder — hand-drawn / levels require VL (Q-006)'
        : 'non-image attachment',
    };
    out.push({
      message_id: message.id,
      attach_index: idx,
      local_path: localPath,
      schema,
      chart_type: schema.chart_type,
      ticker,
      provider: 'stub',
      status: image ? 'pending_vl' : 'stubbed',
    });
  });
  return out;
}
