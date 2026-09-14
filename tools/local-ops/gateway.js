import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCatalog } from './load-catalog.js';
import { redactJson } from './redact.js';
import { FORBIDDEN_IDS, PROD_C2_IDS, LOCAL_C2_IDS } from './forbidden.js';
import { createConfirmStore } from './confirm.js';
import { createGexAdapter } from './adapters/gex.js';
import { createLmAdapter } from './adapters/lm.js';
import { createSshAdapter } from './adapters/ssh.js';
import { createDashAdapter } from './adapters/dash.js';
import { createBrokerAdapter } from './adapters/broker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(here, '../..');

const CLASS_RANK = { C0: 0, C1: 1, C2: 2, C3: 3, C4: 4 };
const PROD_SET = new Set(PROD_C2_IDS);

function deny(code, message, extra = {}) {
  return {
    ok: false,
    denied: true,
    code,
    message,
    ...extra,
  };
}

function allowedClasses(maxClass) {
  const rank = CLASS_RANK[maxClass] ?? 0;
  return Object.keys(CLASS_RANK).filter((c) => CLASS_RANK[c] <= rank);
}

function stripConfirm(args = {}) {
  const next = { ...args };
  delete next.confirm_token;
  return next;
}

export function createGateway(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const catalogPath = options.catalogPath || path.join(here, 'catalog.yaml');
  const catalog = options.catalog || loadCatalog(catalogPath);
  const maxClass = catalog.max_class || 'C0';
  const confirm = options.confirmStore || createConfirmStore({
    nowFn: options.nowFn,
    persistPath: options.confirmPersistPath || path.join(here, 'state', 'confirm-tokens.json'),
  });
  let c2Busy = false;
  const auditLogPath = options.auditLogPath || path.join(here, 'audit', 'audit.log');

  function appendAudit(entry) {
    try {
      fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
      const line = JSON.stringify({
        ts: options.nowFn ? new Date(options.nowFn()).toISOString() : new Date().toISOString(),
        ...redactJson(entry),
      }) + '\n';
      fs.appendFileSync(auditLogPath, line, 'utf8');
    } catch {
      // best-effort audit logging
    }
  }

  const adapters = options.adapters || {
    gex: createGexAdapter({ rootDir, nowFn: options.nowFn, ...(options.gex || {}) }),
    lm: createLmAdapter({
      stateDir: path.join(here, 'state'),
      sshHost: catalog.ssh_host,
      ...(options.lm || {}),
    }),
    dash: createDashAdapter(options.dash || {}),
    ssh: createSshAdapter({
      recipesDir: path.join(here, 'remote'),
      host: catalog.ssh_host,
      remoteRoot: catalog.remote_root,
      ...(options.ssh || {}),
    }),
    broker: options.broker || createBrokerAdapter(options.brokerApi || {
      async getAccountBalances() {
        const lb = await import(path.join(rootDir, 'brokers', 'longbridge.js'));
        return lb.getAccountBalances();
      },
      async getActivePositions() {
        const lb = await import(path.join(rootDir, 'brokers', 'longbridge.js'));
        return lb.getActivePositions();
      },
      async getTodayOrders() {
        const lb = await import(path.join(rootDir, 'brokers', 'longbridge.js'));
        return lb.getTodayOrders();
      },
    }),
  };

  const byId = new Map(catalog.capabilities.map((c) => [c.id, c]));
  const allow = allowedClasses(maxClass);
  const denyClasses = Object.keys(CLASS_RANK).filter((c) => !allow.includes(c));

  function whoami() {
    return {
      ok: true,
      phase: catalog.phase,
      max_class: maxClass,
      role: CLASS_RANK[maxClass] >= 2
        ? ((Number(String(catalog.phase).replace(/^P/i, '')) || 0) >= 3 ? 'prod_c2_hitl' : 'local_c2_ops')
        : 'local_ops',
      allow,
      deny: denyClasses,
      capabilities: catalog.capabilities.map((c) => c.id),
      note: 'Local C2: confirm_token. Production C2: confirm_token + CLI human-approve (not MCP).',
      local_c2: [...LOCAL_C2_IDS],
      prod_c2: [...PROD_C2_IDS],
    };
  }

  async function execute(cap, args) {
    if (cap.adapter === 'gateway' || cap.id === 'ops.whoami') {
      return redactJson(whoami());
    }
    const adapter = adapters[cap.adapter];
    if (!adapter || typeof adapter.invoke !== 'function') {
      return deny('no_adapter', `adapter missing: ${cap.adapter}`, { id: cap.id });
    }
    try {
      const data = await adapter.invoke(cap.id, args, cap);
      return redactJson({ ok: true, id: cap.id, data });
    } catch (err) {
      return {
        ok: false,
        denied: false,
        code: 'invoke_failed',
        id: cap.id,
        message: err.message || String(err),
      };
    }
  }

  return {
    catalog,
    listCatalog() {
      return {
        ok: true,
        phase: catalog.phase,
        max_class: maxClass,
        capabilities: catalog.capabilities.map((c) => ({
          id: c.id,
          class: c.class,
          where: c.where,
          description: c.description,
        })),
      };
    },

    listPending() {
      return { ok: true, pending: confirm.listPending() };
    },

    /**
     * Human-only. Do not expose via MCP tools.
     */
    humanApprove(token) {
      const result = confirm.humanApprove(token);
      appendAudit({
        event: 'human_approve',
        id: result.id || null,
        token_prefix: token ? String(token).slice(0, 8) : null,
        ok: Boolean(result.ok),
        reason: result.reason || null,
      });
      if (!result.ok) {
        return deny('human_approve_failed', result.reason, { confirm_token: token });
      }
      return { ok: true, ...result };
    },

    tailAudit(lines = 20) {
      try {
        if (!fs.existsSync(auditLogPath)) return [];
        const content = fs.readFileSync(auditLogPath, 'utf8');
        const all = content.trim().split('\n').filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        return all.slice(-lines);
      } catch {
        return [];
      }
    },

    async confirm(token, id, args = {}) {
      return this.invoke(id, { ...args, confirm_token: token });
    },

    async invoke(id, args = {}) {
      const name = String(id || '').trim();
      if (FORBIDDEN_IDS.includes(name) || name.includes('place_order')) {
        return deny('forbidden', `capability ${name} is forbidden`, { id: name });
      }
      if (/^gcp\.(cutover_dual|rollback_mono|env_set)$/.test(name)) {
        return deny('forbidden', `${name} deferred (not in P3)`, { id: name, class: 'C2' });
      }

      const cap = byId.get(name);
      if (!cap) {
        return deny('unknown', `capability not registered: ${name}`, { id: name });
      }
      if (CLASS_RANK[cap.class] > CLASS_RANK[maxClass]) {
        return deny('class_denied', `max class is ${maxClass}`, { id: name, class: cap.class });
      }

      const cleanArgs = stripConfirm(args);
      const requiresHuman = PROD_SET.has(name);

      if (name === 'gcp.deploy_align') {
        const sha = String(cleanArgs.sha || '');
        if (!/^[0-9a-f]{40}$/.test(sha)) {
          return deny('bad_args', 'sha must be 40 lowercase hex chars', { id: name });
        }
      }
      if (name === 'gcp.pm2_restart') {
        const allowed = new Set(['whop-web-dashboard', 'whop-ingest-worker', 'whop-wechat-bridge']);
        if (!allowed.has(String(cleanArgs.name || ''))) {
          return deny('bad_args', 'name must be whop-web-dashboard|whop-ingest-worker|whop-wechat-bridge', { id: name });
        }
      }

      if (cap.class === 'C2') {
        const token = args.confirm_token;
        if (!token) {
          const issued = confirm.issue(name, cleanArgs, {
            action: name,
            args: cleanArgs,
            where: cap.where,
            note: requiresHuman
              ? 'Production C2: run `node tools/local-ops/cli.js human-approve <token>` then confirm'
              : 'Re-invoke with the same args plus confirm_token within 60s',
          }, { requiresHuman });
          appendAudit({
            event: 'issue_confirm_token',
            id: name,
            class: 'C2',
            token_prefix: issued.confirm_token.slice(0, 8),
            requires_human: requiresHuman,
            target: cleanArgs.name || cleanArgs.sha || null,
            args: cleanArgs,
          });
          return {
            ok: false,
            denied: true,
            code: requiresHuman ? 'human_confirm_required' : 'confirm_required',
            id: name,
            class: 'C2',
            message: requiresHuman
              ? 'Production C2 requires human-approve then confirm_token.'
              : 'C2 requires confirm_token. Re-invoke with the returned token.',
            ...issued,
          };
        }
        const consumed = confirm.consume(token, name, cleanArgs);
        if (!consumed.ok) {
          return deny('confirm_failed', consumed.reason, {
            id: name,
            class: 'C2',
            requires_human: requiresHuman,
          });
        }
        if (c2Busy) {
          return deny('busy', 'another C2 operation is in progress', { id: name, class: 'C2' });
        }
        c2Busy = true;
        try {
          const result = await execute(cap, cleanArgs);
          if (result && typeof result === 'object') {
            result.human_gated = Boolean(consumed.was_human);
          }
          appendAudit({
            event: 'execute_c2',
            id: name,
            class: 'C2',
            token_prefix: token ? String(token).slice(0, 8) : null,
            human_gated: Boolean(consumed.was_human),
            target: cleanArgs.name || cleanArgs.sha || null,
            args: cleanArgs,
            ok: Boolean(result && result.ok),
            error: result?.error || result?.message || null,
          });
          return result;
        } finally {
          c2Busy = false;
        }
      }

      return execute(cap, cleanArgs);
    },
  };
}

export function createDefaultGateway() {
  return createGateway();
}
