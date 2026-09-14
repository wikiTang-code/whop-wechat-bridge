import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const TTL_MS_LOCAL = 60_000;
const TTL_MS_HUMAN = 5 * 60_000;

function stableHash(id, args) {
  const keys = Object.keys(args || {}).sort();
  const normalized = JSON.stringify(args || {}, keys);
  return crypto.createHash('sha256').update(`${id}\0${normalized}`).digest('hex').slice(0, 24);
}

function makeToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function loadMap(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function saveMap(filePath, map) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const obj = Object.fromEntries(map.entries());
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

/**
 * Confirm tokens for C2.
 * Local C2: confirm_token only (60s).
 * Production C2: confirm_token + human_acked via CLI human-approve (5m).
 */
export function createConfirmStore({
  ttlMs = TTL_MS_LOCAL,
  humanTtlMs = TTL_MS_HUMAN,
  nowFn = () => Date.now(),
  persistPath = null,
} = {}) {
  let tokens = persistPath ? loadMap(persistPath) : new Map();

  function persist() {
    if (persistPath) saveMap(persistPath, tokens);
  }

  function purge() {
    const now = nowFn();
    let changed = false;
    for (const [k, v] of tokens) {
      if (!v || typeof v !== 'object' || v.expiresAt <= now) {
        tokens.delete(k);
        changed = true;
      }
    }
    if (changed) persist();
  }

  function reload() {
    if (persistPath) tokens = loadMap(persistPath);
    purge();
  }

  return {
    issue(id, args, summary, { requiresHuman = false } = {}) {
      reload();
      const argsHash = stableHash(id, args);
      for (const [k, v] of tokens) {
        if (v.id === id && v.argsHash === argsHash) tokens.delete(k);
      }
      const token = makeToken();
      const ttl = requiresHuman ? humanTtlMs : ttlMs;
      const expiresAt = nowFn() + ttl;
      tokens.set(token, {
        id,
        argsHash,
        expiresAt,
        summary,
        requiresHuman: Boolean(requiresHuman),
        humanAcked: false,
        humanAckedAt: null,
      });
      persist();
      return {
        confirm_token: token,
        expires_in_sec: Math.round(ttl / 1000),
        expires_at: new Date(expiresAt).toISOString(),
        id,
        args_hash: argsHash,
        requires_human: Boolean(requiresHuman),
        human_acked: false,
        summary,
      };
    },

    humanApprove(token) {
      reload();
      const key = String(token || '');
      const entry = tokens.get(key);
      if (!entry) return { ok: false, reason: 'invalid_or_expired_token' };
      if (!entry.requiresHuman) {
        return { ok: false, reason: 'human_approve_not_required' };
      }
      entry.humanAcked = true;
      entry.humanAckedAt = new Date(nowFn()).toISOString();
      tokens.set(key, entry);
      persist();
      return {
        ok: true,
        confirm_token: key,
        id: entry.id,
        human_acked: true,
        human_acked_at: entry.humanAckedAt,
        expires_at: new Date(entry.expiresAt).toISOString(),
        summary: entry.summary,
      };
    },

    peek(token) {
      reload();
      const entry = tokens.get(String(token || ''));
      if (!entry) return null;
      return { ...entry };
    },

    listPending() {
      reload();
      const out = [];
      for (const [token, v] of tokens) {
        out.push({
          confirm_token: token,
          id: v.id,
          requires_human: Boolean(v.requiresHuman),
          human_acked: Boolean(v.humanAcked),
          expires_at: new Date(v.expiresAt).toISOString(),
          summary: v.summary,
        });
      }
      return out;
    },

    consume(token, id, args) {
      reload();
      const key = String(token || '');
      const entry = tokens.get(key);
      if (!entry) return { ok: false, reason: 'invalid_or_expired_token' };
      if (entry.id !== id) return { ok: false, reason: 'token_id_mismatch' };
      if (entry.argsHash !== stableHash(id, args)) return { ok: false, reason: 'token_args_mismatch' };
      if (entry.requiresHuman && !entry.humanAcked) {
        return { ok: false, reason: 'human_approve_required' };
      }
      tokens.delete(key);
      persist();
      return { ok: true, was_human: Boolean(entry.requiresHuman) };
    },

    _size() {
      reload();
      return tokens.size;
    },
  };
}

export { stableHash, TTL_MS_LOCAL, TTL_MS_HUMAN };
