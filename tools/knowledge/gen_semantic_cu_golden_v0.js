#!/usr/bin/env node
/** One-shot generator for tools/knowledge/semantic_cu_golden_v0.json */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gap = 30 * 60 * 1000;
const msgs = [];
const starts = [];
let t = 1_700_000_000_000;

const push = (m, isStart) => {
  msgs.push(m);
  if (isStart) starts.push(m.id);
};

for (let i = 0; i < 12; i++) {
  const id0 = `gap_${i}_a`;
  const id1 = `gap_${i}_b`;
  push({ id: id0, channel_id: 'chA', created_at: t, tickers: '["TSLA"]', sender_name: '赵哥' }, true);
  t += 60_000;
  push({ id: id1, channel_id: 'chA', created_at: t, tickers: '["TSLA"]', sender_name: '群友' }, false);
  t += gap + 60_000;
}

const tickers = ['NVDA', 'AMD', 'AAPL', 'META', 'MSFT', 'COIN', 'MSTR', 'BABA', 'PDD', 'CIFR', 'SMCI', 'ARM'];
t += 1000;
for (const tk of tickers) {
  const id = `tk_${tk}`;
  push({ id, channel_id: 'chA', created_at: t, tickers: JSON.stringify([tk]), sender_name: '赵哥' }, true);
  t += 90_000;
  push({ id: `${id}_b`, channel_id: 'chA', created_at: t, tickers: JSON.stringify([tk]), sender_name: '赵哥' }, false);
  t += 90_000;
}

for (let i = 0; i < 6; i++) {
  const ch = i % 2 === 0 ? 'chA' : 'chB';
  push({
    id: `ch_${i}`,
    channel_id: ch,
    created_at: t,
    tickers: '["SPY"]',
    sender_name: '赵哥',
  }, true);
  t += 120_000;
}

const payload = {
  req: 'REQ-037',
  phase: 2,
  version: 'v0_synthetic',
  note: 'Synthetic oracle for heuristic_v1 acceptance path; human chat labels still preferred long-term.',
  gap_ms: gap,
  boundary_starts: starts,
  messages: msgs,
};

const out = path.join(__dirname, 'semantic_cu_golden_v0.json');
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ out, messages: msgs.length, starts: starts.length })}\n`);
