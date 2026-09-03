import {
  isGeminiKeyProtectError,
  isLmContextExceeded,
  isLmModelUnloaded,
  shouldRotateGeminiKeyOnError,
  truncatePromptForLocal,
  shouldSkipGeminiFallback,
  resolveTextRoute,
  LOCAL_PROMPT_SAFE_CHARS
} from '../ai-router-policy.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(isGeminiKeyProtectError('Gemini API failed with status 429: high demand'), '429 is key-protect');
assert(isGeminiKeyProtectError(new Error('status 401: ACCESS_TOKEN_TYPE_UNSUPPORTED')), '401 unsupported is key-protect');
assert(isGeminiKeyProtectError('API_KEY_INVALID'), 'invalid key is key-protect');
assert(!isGeminiKeyProtectError('Gemini API failed with status 500: oops'), '500 is not key-protect');
assert(!shouldRotateGeminiKeyOnError('Key #1 触发 429'), 'must not rotate on 429');

assert(isLmContextExceeded('LM Studio API failed with status 400: Context size has been exceeded'), 'context exceeded');
assert(isLmContextExceeded('LM_CONTEXT_EXCEEDED: n_ctx'), 'prefixed context error');
assert(shouldSkipGeminiFallback('Context size has been exceeded'), 'context must not dump to Gemini');
assert(!shouldSkipGeminiFallback('ECONNREFUSED 127.0.0.1:8080'), 'local-down may sparse-fallback');

assert(isLmModelUnloaded('Model unloaded'), 'model unloaded');

const long = 'A'.repeat(LOCAL_PROMPT_SAFE_CHARS + 5000);
const truncated = truncatePromptForLocal(long);
assert(truncated.length <= LOCAL_PROMPT_SAFE_CHARS + 80, 'truncate stays near cap');
assert(truncated.includes('truncated for local 14B'), 'truncate marker present');
assert(truncatePromptForLocal('short') === 'short', 'short prompts unchanged');

assert(resolveTextRoute({ cloudOnly: false, localReachable: true, hasGeminiKey: true }) === 'lm-studio', 'bulk path prefers 14B');
assert(resolveTextRoute({ cloudOnly: true, localReachable: true, hasGeminiKey: true }) === 'gemini', 'cloudOnly uses Gemini');
assert(resolveTextRoute({ cloudOnly: false, localReachable: false, hasGeminiKey: true }) === 'gemini', 'local down sparse Gemini');
assert(resolveTextRoute({ cloudOnly: false, localReachable: false, hasGeminiKey: false }) === 'none', 'no backends');

console.log('test_ai_router_policy: PASS');
