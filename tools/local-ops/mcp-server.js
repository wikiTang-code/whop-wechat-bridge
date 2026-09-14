#!/usr/bin/env node
/**
 * Minimal MCP stdio adapter. No business logic — gateway is the enforcement point.
 * Protocol: newline-delimited JSON-RPC 2.0 (MCP stdio).
 */
import { createGateway } from './gateway.js';

const gw = createGateway();

const ALIASES = Object.freeze({
  ops_catalog: { kind: 'catalog' },
  gex_status: { kind: 'invoke', id: 'gex.status' },
  gex_summarize: { kind: 'invoke', id: 'gex.summarize' },
  gcp_health: { kind: 'invoke', id: 'gcp.health' },
  gcp_pm2_status: { kind: 'invoke', id: 'gcp.pm2_status' },
  lm_status: { kind: 'invoke', id: 'lm.status' },
});

function toolDef(name, description, properties, required) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function listTools() {
  return [
    toolDef('ops.catalog', 'List local-ops capabilities (P3: local C2 + production C2 HITL)', {}, []),
    toolDef('ops.invoke', 'Invoke a capability. Local C2 needs confirm_token. Production C2 needs human-approve (CLI) then confirm_token.', {
      id: { type: 'string', description: 'Capability id from ops.catalog' },
      args: {
        type: 'object',
        description: 'Optional args. For C2 include confirm_token after gates clear.',
      },
    }, ['id']),
    toolDef('ops.confirm', 'Confirm a pending C2 action with token (production C2 must be human-approved first via CLI)', {
      confirm_token: { type: 'string' },
      id: { type: 'string' },
      args: { type: 'object' },
    }, ['confirm_token', 'id']),
    toolDef('ops_catalog', 'Alias of ops.catalog', {}, []),
    toolDef('gex_status', 'Alias of ops.invoke gex.status', {}, []),
    toolDef('gex_summarize', 'Alias of ops.invoke gex.summarize — not an order signal', {}, []),
    toolDef('gcp_health', 'Alias of ops.invoke gcp.health via SSH recipe', {}, []),
    toolDef('gcp_pm2_status', 'Alias of ops.invoke gcp.pm2_status via SSH recipe', {}, []),
    toolDef('lm_status', 'Alias of ops.invoke lm.status', {}, []),
  ];
}

async function callTool(name, args = {}) {
  if (name === 'ops.catalog' || name === 'ops_catalog') {
    return gw.listCatalog();
  }
  if (name === 'ops.invoke') {
    return gw.invoke(args.id, args.args || {});
  }
  if (name === 'ops.confirm') {
    return gw.confirm(args.confirm_token, args.id, args.args || {});
  }
  const alias = ALIASES[name];
  if (alias?.kind === 'catalog') return gw.listCatalog();
  if (alias?.kind === 'invoke') return gw.invoke(alias.id, {});
  return { ok: false, denied: true, code: 'unknown_tool', message: `unknown MCP tool: ${name}` };
}

function okResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errResult(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolContent(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: payload && payload.ok === false,
  };
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return null;
  if (msg.method && String(msg.method).startsWith('notifications/')) return null;

  const { id, method, params } = msg;
  if (method === 'initialize') {
    return okResult(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'whop-local-ops', version: '0.4.0-p3' },
    });
  }
  if (method === 'ping') return okResult(id, {});
  if (method === 'tools/list') return okResult(id, { tools: listTools() });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const payload = await callTool(name, args);
    return okResult(id, toolContent(payload));
  }
  return errResult(id, -32601, `method not found: ${method}`);
}

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write(errResult(null, -32700, 'parse error'));
      continue;
    }
    try {
      const reply = await handle(msg);
      if (reply) write(reply);
    } catch (err) {
      write(errResult(msg.id ?? null, -32603, err.message || 'internal error'));
    }
  }
});

process.stdin.on('end', () => process.exit(0));
