#!/usr/bin/env node
import { createGateway } from './gateway.js';

const gw = createGateway();
const argv = process.argv.slice(2);
const cmd = argv[0];

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(raw) {
  if (!raw) return {};
  return JSON.parse(raw);
}

if (cmd === 'catalog') {
  print(gw.listCatalog());
  process.exit(0);
}

if (cmd === 'pending') {
  print(gw.listPending());
  process.exit(0);
}

if (cmd === 'human-approve') {
  const token = argv[1];
  const result = gw.humanApprove(token);
  print(result);
  process.exit(result.ok ? 0 : 2);
}

if (cmd === 'invoke') {
  const id = argv[1];
  const args = parseArgs(argv[2]);
  const result = await gw.invoke(id, args);
  print(result);
  process.exit(result.ok ? 0 : 2);
}

if (cmd === 'confirm') {
  const id = argv[1];
  const token = argv[2];
  const args = parseArgs(argv[3]);
  const result = await gw.confirm(token, id, args);
  print(result);
  process.exit(result.ok ? 0 : 2);
}

process.stderr.write(`usage:
  node tools/local-ops/cli.js catalog
  node tools/local-ops/cli.js pending
  node tools/local-ops/cli.js invoke <id> [json-args]
  node tools/local-ops/cli.js human-approve <token>   # production C2 HITL (not MCP)
  node tools/local-ops/cli.js confirm <id> <token> [json-args]
`);
process.exit(1);
