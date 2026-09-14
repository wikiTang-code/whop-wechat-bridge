#!/usr/bin/env node
/**
 * Local HTTP adapter for WeCom inbound (127.0.0.1 only).
 * Expose via Cloudflare tunnel path /wecom/callback if needed — never use group webhook as inbound.
 */
import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createGateway } from './gateway.js';
import { createWecomHandler } from './wecom/callback.js';
import { createWecomPusher } from './wecom/push.js';

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

function missingWecomEnv() {
  const need = ['WECOM_OPS_TOKEN', 'WECOM_OPS_ENCODING_AES_KEY', 'WECOM_OPS_CORP_ID', 'WECOM_OPS_USERIDS'];
  return need.filter((k) => !process.env[k]);
}

export function createLocalOpsHttpServer(options = {}) {
  const gateway = options.gateway || createGateway();
  const env = options.env || process.env;
  const need = ['WECOM_OPS_TOKEN', 'WECOM_OPS_ENCODING_AES_KEY', 'WECOM_OPS_CORP_ID', 'WECOM_OPS_USERIDS'];
  const missing = need.filter((k) => !env[k]);
  const wecomEnabled = missing.length === 0;

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
  const port = options.port || Number(env.LOCAL_OPS_HTTP_PORT || PORT);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const logLine = (status, extra = '') => {
      process.stderr.write(
        `[local-ops-http] ${req.method} ${req.url || '/'} → ${status} ${Date.now() - started}ms${extra ? ` ${extra}` : ''}\n`,
      );
    };
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);

      if (req.method === 'GET' && url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          wecom_enabled: wecomEnabled,
          wecom_push_enabled: Boolean(pusher?.enabled),
          wecom_push_via: pusher?.via || null,
          missing_env: missing,
          bind: `${host}:${port}`,
        }));
        logLine(200);
        return;
      }

      if (url.pathname === '/wecom/callback') {
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

      res.writeHead(404);
      res.end('not found');
      logLine(404);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message || 'error');
      logLine(500, err.message || 'error');
    }
  });

  return { server, gateway, wecomEnabled, missing, host, port };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, wecomEnabled, missing, host, port } = createLocalOpsHttpServer();
  server.listen(port, host, () => {
    process.stderr.write(`[local-ops-http] listening http://${host}:${port}\n`);
    process.stderr.write(`[local-ops-http] wecom=${wecomEnabled ? 'on' : 'off'} missing=${missing.join(',') || '-'}\n`);
    process.stderr.write(`[local-ops-http] callback path: /wecom/callback\n`);
  });
}
