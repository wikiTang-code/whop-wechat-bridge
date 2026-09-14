#!/usr/bin/env node
/**
 * Local HTTP adapter for WeCom inbound (127.0.0.1 only).
 * Expose via tunnel path /wecom/callback if needed — never use group webhook as inbound.
 * REQ-034: Host / Origin / CSRF gate on /ui and /api/ops/* (WeCom path exempt — own crypto).
 */
import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createGateway } from './gateway.js';
import { createWecomHandler } from './wecom/callback.js';
import { createWecomPusher } from './wecom/push.js';
import { renderOpsUiHtml } from './ui/ops-console.js';
import {
  checkLocalOpsHttpGate,
  mintCsrfToken,
  isLoopbackRemote,
  isLoopbackHostHeader,
  isLoopbackOrigin,
  hasLocalOpsHeader,
} from './http-guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
dotenv.config({ path: path.join(root, '.env') });

const HOST = process.env.LOCAL_OPS_HTTP_HOST || '127.0.0.1';
const PORT = Number(process.env.LOCAL_OPS_HTTP_PORT || 18789);

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function denyJson(res, status, code, logLine) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: false, denied: true, code }));
  logLine(status, code);
}

/** CLI: X-Local-Ops:1 + loopback Host + no browser Origin → CSRF optional */
function isLocalCliInvoke(req, listenPort) {
  if (!hasLocalOpsHeader(req)) return false;
  if (!isLoopbackRemote(req.socket?.remoteAddress)) return false;
  if (!isLoopbackHostHeader(req.headers?.host, listenPort)) return false;
  if (req.headers?.origin && !isLoopbackOrigin(req.headers.origin, listenPort)) return false;
  return !req.headers?.origin;
}

export function createLocalOpsHttpServer(options = {}) {
  const gateway = options.gateway || createGateway();
  const env = options.env || process.env;
  const need = ['WECOM_OPS_TOKEN', 'WECOM_OPS_ENCODING_AES_KEY', 'WECOM_OPS_CORP_ID', 'WECOM_OPS_USERIDS'];
  const missing = need.filter((k) => !env[k]);
  const wecomEnabled = missing.length === 0;
  const csrfToken = options.csrfToken || mintCsrfToken();

  let wecom = null;
  let pusher = null;
  if (wecomEnabled) {
    pusher = createWecomPusher({
      corpId: env.WECOM_OPS_CORP_ID,
      secret: env.WECOM_OPS_SECRET,
      agentId: env.WECOM_OPS_AGENT_ID,
      pushVia: env.WECOM_OPS_PUSH_VIA || 'gcp',
    });
    wecom = createWecomHandler({
      token: env.WECOM_OPS_TOKEN,
      encodingAesKey: env.WECOM_OPS_ENCODING_AES_KEY,
      corpId: env.WECOM_OPS_CORP_ID,
      allowedUserIds: env.WECOM_OPS_USERIDS,
      gateway,
      pusher,
    });
    if (!pusher.enabled) {
      process.stderr.write('[local-ops-http] wecom push OFF (set WECOM_OPS_SECRET + WECOM_OPS_AGENT_ID for async notify)\n');
    } else {
      process.stderr.write(`[local-ops-http] wecom push ON agent=${pusher.agentId} via=${pusher.via}\n`);
    }
  }

  const host = options.host || env.LOCAL_OPS_HTTP_HOST || HOST;
  const port = options.port != null ? Number(options.port) : Number(env.LOCAL_OPS_HTTP_PORT || PORT);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const logLine = (status, extra = '') => {
      process.stderr.write(
        `[local-ops-http] ${req.method} ${req.url || '/'} → ${status} ${Date.now() - started}ms${extra ? ` ${extra}` : ''}\n`,
      );
    };
    try {
      // No CORS: foreign browsers must not call this API.
      if (req.method === 'OPTIONS') {
        res.writeHead(405, { Allow: 'GET, POST' });
        res.end('method not allowed');
        logLine(405, 'options');
        return;
      }

      const listenPort = server.address()?.port || port;
      const url = new URL(req.url || '/', `http://${host}:${listenPort}`);

      // WeCom: crypto auth; Host may be public name via ssh -R. Still require loopback remote.
      if (url.pathname === '/wecom/callback') {
        if (!isLoopbackRemote(req.socket.remoteAddress)) {
          denyJson(res, 403, 'localhost_only', logLine);
          return;
        }
        if (!wecom) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end(`wecom not configured; missing ${missing.join(',')}`);
          logLine(503, 'wecom_off');
          return;
        }
        if (req.method === 'GET') {
          const out = wecom.handleVerify(Object.fromEntries(url.searchParams));
          res.writeHead(out.status, { 'Content-Type': out.contentType || 'text/plain' });
          res.end(out.body);
          logLine(out.status, 'verify');
          return;
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          let out;
          try {
            out = await wecom.handleMessage(Object.fromEntries(url.searchParams), body);
          } catch (err) {
            process.stderr.write(`[local-ops-http] wecom handle error: ${err.message}\n`);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('error');
            logLine(500, err.message);
            return;
          }
          res.writeHead(out.status, { 'Content-Type': out.contentType || 'text/plain' });
          res.end(out.body);
          logLine(out.status, `post body=${body.length}B`);
          return;
        }
        res.writeHead(405);
        res.end('method not allowed');
        logLine(405);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/healthz') {
        if (!isLoopbackRemote(req.socket.remoteAddress) || !isLoopbackHostHeader(req.headers?.host, listenPort)) {
          denyJson(res, 403, !isLoopbackRemote(req.socket.remoteAddress) ? 'localhost_only' : 'bad_host', logLine);
          return;
        }
        if (req.headers?.origin && !isLoopbackOrigin(req.headers.origin, listenPort)) {
          denyJson(res, 403, 'bad_origin', logLine);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          ok: true,
          wecom_enabled: wecomEnabled,
          wecom_push_enabled: Boolean(pusher?.enabled),
          wecom_push_via: pusher?.via || null,
          missing_env: missing,
          bind: `${host}:${listenPort}`,
          ui: '/ui',
          csrf: 'required_on_invoke',
        }));
        logLine(200);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/ui' || url.pathname === '/ui/')) {
        if (!isLoopbackRemote(req.socket.remoteAddress) || !isLoopbackHostHeader(req.headers?.host, listenPort)) {
          denyJson(res, 403, !isLoopbackRemote(req.socket.remoteAddress) ? 'localhost_only' : 'bad_host', logLine);
          return;
        }
        if (req.headers?.origin && !isLoopbackOrigin(req.headers.origin, listenPort)) {
          denyJson(res, 403, 'bad_origin', logLine);
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'self'",
          'Set-Cookie': `local_ops_csrf=${csrfToken}; Path=/; SameSite=Strict; HttpOnly; Max-Age=86400`,
        });
        res.end(renderOpsUiHtml({ csrfToken }));
        logLine(200, 'ui');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/ops/invoke') {
        const requireCsrf = !isLocalCliInvoke(req, listenPort);
        const gate = checkLocalOpsHttpGate(req, {
          listenPort,
          csrfToken,
          requireCsrf,
        });
        if (!gate.ok) {
          denyJson(res, gate.status, gate.code, logLine);
          return;
        }
        const body = await readBody(req, 64 * 1024);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'bad_json' }));
          logLine(400, 'bad_json');
          return;
        }
        const id = String(payload.id || '').trim();
        if (!id || id.includes('place_order') || id === 'human-approve') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, denied: true, code: 'bad_id' }));
          logLine(400, 'bad_id');
          return;
        }
        const result = await gateway.invoke(id, payload.args || {});
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
        logLine(200, id);
        return;
      }

      res.writeHead(404);
      res.end('not found');
      logLine(404);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message || 'error');
      logLine(500, err.message || 'error');
    }
  });

  return { server, gateway, wecomEnabled, missing, host, port, csrfToken };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, wecomEnabled, missing, host, port } = createLocalOpsHttpServer();
  server.listen(port, host, () => {
    process.stderr.write(`[local-ops-http] listening http://${host}:${port}\n`);
    process.stderr.write(`[local-ops-http] wecom=${wecomEnabled ? 'on' : 'off'} missing=${missing.join(',') || '-'}\n`);
    process.stderr.write(`[local-ops-http] callback path: /wecom/callback\n`);
    process.stderr.write('[local-ops-http] REQ-034 Host/Origin/CSRF gate on /ui and /api/ops/invoke\n');
  });
}
