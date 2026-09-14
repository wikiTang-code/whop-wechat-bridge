#!/usr/bin/env node
/**
 * Ask human before shell can run production C2 / human-approve.
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

const command = String(payload.command || '');
const risky = /human-approve|gcp\.pm2_restart|gcp\.deploy_align|pm2\s+restart|git\s+reset\s+--hard/.test(command);

if (risky) {
  process.stdout.write(JSON.stringify({
    permission: 'ask',
    user_message: 'Production / destructive ops shell command — review before allowing.',
    agent_message: 'This shell command may execute production C2 or human-approve. Ask the user.',
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({ permission: 'allow' }));
process.exit(0);
