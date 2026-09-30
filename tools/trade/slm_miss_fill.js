/**
 * CHG-064: 1.5B only after regex and the alias table both miss.
 * Always deferred. Default infer returns null and does not call a model or WeCom.
 */
import { deferOffHot } from '../ingest/hot_defer.js';

export async function defaultSlmInfer() {
  return null;
}

export function scheduleSlmMissFill(msg, { defer = deferOffHot, infer = defaultSlmInfer, onCard = null } = {}) {
  defer(async () => {
    const hit = await infer(msg);
    if (!hit || typeof onCard !== 'function') return;
    await onCard({ message_id: msg?.id, candidate: hit, via: 'slm_1_5b' });
  });
}
