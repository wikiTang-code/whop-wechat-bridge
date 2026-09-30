/**
 * Read-only gap list. Prints regex miss / alias hit / landed.
 * Does not open a database and does not write.
 * Usage: node scripts/trade/list_zhao_print_gaps.js <messages.json>
 * JSON: [{ id, content, signal_ticker }]
 */
import { readFileSync } from 'fs';
import { parseZhaoFilledPrint } from '../../tools/trade/zhao_print_persist.js';
import { parseAliasPrint } from '../../tools/trade/ticker_alias.js';

const file = process.argv[2];
const rows = JSON.parse(readFileSync(file, 'utf8'));
const out = [];
for (const row of rows) {
  const regex = parseZhaoFilledPrint(row.content);
  const alias = regex ? null : parseAliasPrint(row.content);
  let kind = 'chatter';
  if (regex) kind = row.signal_ticker ? 'landed' : 'regex_unwritten';
  else if (alias) kind = 'alias_miss_on_prod';
  else if (/加了|买了|加回|开了|出掉|出了一半|出一半|出了|出剩下/.test(String(row.content || '').replace(/\s+/g, ''))) kind = 'verb_miss';
  out.push({ id: row.id, kind, regex: regex?.ticker || null, alias: alias?.ticker || null, content: String(row.content || '').slice(0, 80) });
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
