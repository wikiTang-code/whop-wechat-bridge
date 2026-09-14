#!/usr/bin/env node
/**
 * Soft gate for Cursor MCP: block production C2 / forbidden IDs from being
 * treated as agent-auto-executable. Gateway remains the real enforcer.
 */
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = await readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  payload = {};
}

const tool = String(payload.toolName || payload.tool || payload.name || '');
const args = payload.arguments || payload.args || {};
const id = String(args.id || '');
const combined = `${tool} ${id}`;

if (/human-approve|ops\.human_approve/.test(combined)) {
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    user_message: 'human-approve is CLI-only (HITL). Not available via MCP.',
  }));
  process.exit(0);
}

if (/place_order|cutover_dual|rollback_mono|env_set|pm2_delete|pm2_kill/.test(combined)) {
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    user_message: `Blocked: ${combined} is forbidden / deferred.`,
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({ permission: 'allow' }));
process.exit(0);
