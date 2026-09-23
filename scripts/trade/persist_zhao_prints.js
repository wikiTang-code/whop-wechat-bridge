#!/usr/bin/env node
/**
 * CHG-060 CLI — persist Zhao filled prints from messages (dry-run default).
 * Does not submit orders. Does not send WeCom.
 *
 *   node scripts/trade/persist_zhao_prints.js --db whop_archive.db --since 1789997400000
 *   node scripts/trade/persist_zhao_prints.js --db whop_archive.db --since 1789997400000 --apply
 */
import Database from 'better-sqlite3';
import {
  persistZhaoFilledPrints,
  parseZhaoFilledPrint,
  ZHAO_SENDER_ID,
  ALLOWED_CHANNELS
} from '../../tools/trade/zhao_print_persist.js';
import { AUTO_SUBMIT_ENABLED } from '../../tools/trade/paper_execution_engine.js';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { db: 'whop_archive.db', since: 0, apply: false, limit: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) out.db = argv[++i];
    else if (a === '--since' && argv[i + 1]) out.since = Number(argv[++i]) || 0;
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 200);
    else if (a === '--apply') out.apply = true;
  }
  return out;
}

function loadMsgs(conn, since, limit) {
  const placeholders = ALLOWED_CHANNELS.map(() => '?').join(',');
  return conn.prepare(`
    SELECT id, channel_id, sender_id, sender_name, content, created_at, poll_seen_at
    FROM messages
    WHERE sender_id = ?
      AND channel_id IN (${placeholders})
      AND created_at >= ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(ZHAO_SENDER_ID, ...ALLOWED_CHANNELS, since, limit);
}

function main() {
  if (AUTO_SUBMIT_ENABLED === true) {
    console.error('REFUSE AUTO_SUBMIT');
    process.exit(1);
  }
  const args = parseArgs();
  const conn = new Database(args.db, { readonly: !args.apply, timeout: 3000 });
  const msgs = loadMsgs(conn, args.since, args.limit);
  console.log(`db=${args.db} apply=${args.apply} msgs=${msgs.length} since=${args.since}`);

  if (!args.apply) {
    let n = 0;
    for (const m of msgs) {
      const p = parseZhaoFilledPrint(m.content);
      if (!p) continue;
      n += 1;
      console.log(`DRY\t${m.id}\t${p.action}\t${p.ticker}\t${p.price}\t${m.channel_id}\tpoll_seen=${m.poll_seen_at || ''}`);
    }
    console.log(`dry_prints=${n}`);
    conn.close();
    return;
  }

  const rows = persistZhaoFilledPrints(msgs, { dbInstance: conn });
  const written = rows.filter((r) => !r.skipped);
  const skipped = rows.filter((r) => r.skipped);
  console.log(`written=${written.length} skipped=${skipped.length}`);
  for (const r of written) {
    console.log(`OK\t${r.message_id}\t${r.parsed.action}\t${r.parsed.ticker}\t${r.parsed.price}\tsignal=${r.signal?.signal_id}\tintent=${r.intent?.intent_id || r.intent_reason || ''}`);
  }
  conn.close();
}

if (process.argv[1] && process.argv[1].includes('persist_zhao_prints')) {
  main();
}
