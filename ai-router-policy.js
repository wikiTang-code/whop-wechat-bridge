/**
 * AI Router policy (local-14B first):
 * 1. Default bulk/online text (news reduce, RAG, routine chat analysis, task-queue jobs 14B can do)
 *    goes to local LM Studio qwen2.5-14b-instruct when reachable.
 * 2. Gemini is reserved for vision / explicit cloud-only, plus sparse fallback when 14B is down
 *    (strict rate limits so Key #1 is not slammed).
 * 3. On Gemini 429/401/invalid: fail over to 14B; do NOT rotate to Key #2 in a tight loop.
 * 4. On 14B context-exceeded: truncate/split or skip; do not dump onto Gemini in a burst.
 * Keep the existing Gemini key pool; never hardcode keys.
 */

export const LOCAL_LM_DEFAULT_MODEL = 'qwen2.5-14b-instruct';
export const LOCAL_LM_DEFAULT_BASE = 'http://127.0.0.1:8080';
export const LOCAL_PROMPT_SAFE_CHARS = 12000;

export function isGeminiKeyProtectError(errOrText) {
  const msg = String(errOrText?.message || errOrText || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('429') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('access_token_type_unsupported') ||
    msg.includes('api key not valid') ||
    msg.includes('api_key_invalid') ||
    msg.includes('invalid api key') ||
    msg.includes('resource_exhausted') ||
    (msg.includes('quota') && (msg.includes('exceed') || msg.includes('exhausted')))
  );
}

export function isLmContextExceeded(errOrText) {
  const msg = String(errOrText?.message || errOrText || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('lm_context_exceeded') ||
    msg.includes('context size has been exceeded') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('prompt is too long') ||
    msg.includes('too many tokens') ||
    msg.includes('n_ctx') ||
    msg.includes('context window')
  );
}

export function isLmModelUnloaded(errOrText) {
  const msg = String(errOrText?.message || errOrText || '').toLowerCase();
  return msg.includes('model unloaded') || msg.includes('model_not_found') || msg.includes('failed to load model');
}

export function shouldRotateGeminiKeyOnError(errOrText) {
  // Keep the key-pool code path, but never burn Key #2 on 429/401/invalid.
  return !isGeminiKeyProtectError(errOrText);
}

export function truncatePromptForLocal(prompt, maxChars = LOCAL_PROMPT_SAFE_CHARS) {
  const text = String(prompt || '');
  if (text.length <= maxChars) return text;
  const headLen = Math.floor(maxChars * 0.55);
  const tailLen = maxChars - headLen - 80;
  const head = text.slice(0, headLen);
  const tail = text.slice(-Math.max(tailLen, 0));
  return `${head}\n\n... [truncated for local 14B context window; middle omitted] ...\n\n${tail}`;
}

export function shouldSkipGeminiFallback(errOrText) {
  // Context overflow on 14B must not cascade into a Gemini burst.
  return isLmContextExceeded(errOrText);
}

/** P0-4 / Q1: when local tunnel circuit is open, bulk jobs must not dump onto Gemini. */
export function shouldBlockGeminiForLocalDown({ circuitOpen = false, allowSparseGemini = false } = {}) {
  if (!circuitOpen) return false;
  return !allowSparseGemini;
}

export function resolveTextRoute({ cloudOnly = false, localReachable = false, hasGeminiKey = false, circuitOpen = false, allowSparseGemini = false } = {}) {
  if (cloudOnly) {
    return hasGeminiKey ? 'gemini' : (localReachable ? 'lm-studio' : 'none');
  }
  if (localReachable && !circuitOpen) return 'lm-studio';
  // Q1: tunnel down → suspend bulk (none), unless explicit sparse Gemini for critical online paths (Q2)
  if (circuitOpen && !allowSparseGemini) return 'none';
  if (hasGeminiKey) return 'gemini';
  return 'none';
}
