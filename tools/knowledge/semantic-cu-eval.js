/**
 * REQ-037 Phase 2 — Semantic CU boundary metrics.
 */

export function evalBoundaries(predictedStarts, goldStarts) {
  const pred = new Set((predictedStarts || []).filter(Boolean));
  const gold = new Set((goldStarts || []).filter(Boolean));
  let tp = 0;
  for (const id of pred) if (gold.has(id)) tp += 1;
  const precision = pred.size ? tp / pred.size : 0;
  const recall = gold.size ? tp / gold.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tp,
    fp: pred.size - tp,
    fn: gold.size - tp,
    precision,
    recall,
    f1,
    pred_n: pred.size,
    gold_n: gold.size,
  };
}

export function predictedStartsFromUnits(units) {
  return (units || []).map((u) => u.members?.[0]?.message_id).filter(Boolean);
}

/** Float32 LE buffer (message_embeddings.embedding) → Float32Array */
export function embeddingBufferToFloat32(buf) {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 4 || b.length % 4 !== 0) return null;
  const out = new Float32Array(b.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || !a.length || !b.length) return null;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
