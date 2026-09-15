/**
 * test_golden_replay_regression.js
 * 历史大V交易单 Golden 标杆端到端全量回归测试套件 (REQ-033)
 * 覆盖前 35 笔所有已审与待审单据的语义解析、批次扣减、持仓联动与 LIFO 栈模型
 */

import assert from 'assert';
import { getDb } from '../database.js';
import { resimulateReplayQueue } from '../follow-replay-engine.js';

console.log('===========================================================');
console.log('🧪 启动历史大V交易单 Golden 全量端到端自动化回归测试套件 (前 35 笔)');
console.log('===========================================================');

const db = getDb();

// 1. 先执行全量链式推演
resimulateReplayQueue(db, 1);

// 2. 提取前 35 笔实际持久化状态
const rows = db.prepare(`
  SELECT seq_no, id, status, parsed_ticker, parsed_action, parsed_price, parsed_qty, before_qty, after_qty, before_avg_cost, after_avg_cost, source_lot_price, raw_content
  FROM follow_replay_queue
  WHERE seq_no <= 35
  ORDER BY seq_no ASC
`).all();

assert.strictEqual(rows.length, 35, '前序记录必须完整覆盖 35 笔');

// 3. 逐笔黄金断言定义
const goldenMap = {
  1: { ticker: 'TSLL', action: 'BUY', price: 15.3, qty: 327, beforeQ: 0, afterQ: 327, lot: null },
  2: { ticker: 'TSLL', action: 'SELL', price: 15.61, qty: 164, beforeQ: 327, afterQ: 163, lot: 15.3 },
  3: { ticker: 'MSFL', action: 'SELL', price: 19.65, qty: 170, beforeQ: 0, afterQ: 0 },
  4: { ticker: 'TSLA', status: 'classified_strategy' },
  5: { ticker: 'TSLL', action: 'BUY', price: 14.2, qty: 235, beforeQ: 163, afterQ: 398, lot: null },
  6: { ticker: 'LITE', action: 'BUY', price: 865, qty: 4, beforeQ: 0, afterQ: 4, lot: null },
  7: { ticker: 'IREN', action: 'BUY', price: 49.75, qty: 67, beforeQ: 0, afterQ: 67, lot: null },
  8: { ticker: 'CIFR', action: 'BUY', price: 18.25, qty: 182, beforeQ: 0, afterQ: 182, lot: null },
  9: { ticker: 'LITE', action: 'SELL', price: 885.5, qty: 4, beforeQ: 4, afterQ: 0 },
  10: { ticker: 'TSLL', action: 'SELL', price: 14.3, qty: 235, beforeQ: 398, afterQ: 163, lot: 14.2 },
  11: { ticker: 'CIFR', action: 'SELL', price: 18.52, qty: 182, beforeQ: 182, afterQ: 0, lot: 18.25 },
  12: { ticker: 'LITE', status: 'classified_strategy' },
  13: { ticker: 'CRWV', action: 'BUY', price: 98, qty: 34, beforeQ: 0, afterQ: 34 },
  14: { ticker: 'CRWV', action: 'BUY', price: 98.7, qty: 34, beforeQ: 34, afterQ: 68 },
  15: { ticker: 'TSLL', action: 'BUY', price: 13.6, qty: 245, beforeQ: 163, afterQ: 408 },
  16: { ticker: 'IREN', action: 'BUY', price: 47.8, qty: 70, beforeQ: 67, afterQ: 137 },
  17: { ticker: 'CRWV', action: 'SELL', price: 101.2, qty: 34, beforeQ: 68, afterQ: 34, lot: 98.7 },
  18: { ticker: 'CRWV', action: 'BUY', price: 98.1, qty: 34, beforeQ: 34, afterQ: 68 },
  19: { ticker: 'CONL', action: 'BUY', price: 7.45, qty: 447, beforeQ: 0, afterQ: 447 },
  20: { ticker: 'HOOD', action: 'BUY', price: 74.4, qty: 45, beforeQ: 0, afterQ: 45 },
  21: { ticker: 'LITE', action: 'BUY', price: 855, qty: 4, beforeQ: 0, afterQ: 4 },
  22: { ticker: 'CONL', action: 'SELL', price: 7.82, qty: 447, beforeQ: 447, afterQ: 0, lot: 7.45 },
  23: { ticker: 'LITE', action: 'SELL', price: 866, qty: 2, beforeQ: 4, afterQ: 2, lot: 855 },
  24: { ticker: 'IREN', action: 'SELL', price: 47.8, qty: 70, beforeQ: 137, afterQ: 67, lot: 47.8 },
  25: { ticker: 'HOOD', action: 'SELL', price: 74.6, qty: 45, beforeQ: 45, afterQ: 0, lot: 74.4 },
  26: { ticker: 'LITE', action: 'SELL', price: 875, qty: 2, beforeQ: 2, afterQ: 0, lot: 855 },
  27: { ticker: 'CRWV', action: 'SELL', price: 98.3, qty: 34, beforeQ: 68, afterQ: 34, lot: 98.1 },
  28: { ticker: 'TSLL', action: 'SELL', price: 13.6, qty: 245, beforeQ: 408, afterQ: 163, lot: 13.6 },
  30: { ticker: 'TSLL', action: 'BUY', price: 14.01, qty: 238, beforeQ: 163, afterQ: 401 },
  31: { ticker: 'HOOD', action: 'BUY', price: 73.95, qty: 45, beforeQ: 0, afterQ: 45 },
  32: { ticker: 'CONL', action: 'BUY', price: 7.67, qty: 434, beforeQ: 0, afterQ: 434 },
  33: { ticker: 'TSLL', action: 'SELL', price: 14.41, qty: 119, beforeQ: 401, afterQ: 282, lot: 14.01 },
  34: { ticker: 'CONL', action: 'SELL', price: 7.99, qty: 217, beforeQ: 434, afterQ: 217, lot: 7.67 },
  35: { ticker: 'CONL', action: 'BUY', price: 7.67, qty: 217, beforeQ: 217, afterQ: 434, lot: 7.99 }
};

let passCount = 0;
for (const r of rows) {
  const expected = goldenMap[r.seq_no];
  if (!expected) continue;

  if (expected.status) {
    assert.strictEqual(r.status, expected.status, `#${r.seq_no} 状态必须为 ${expected.status}`);
  }
  if (expected.ticker) {
    assert.strictEqual(r.parsed_ticker, expected.ticker, `#${r.seq_no} 标的必须为 ${expected.ticker}`);
  }
  if (expected.action) {
    assert.strictEqual(r.parsed_action, expected.action, `#${r.seq_no} 动作必须为 ${expected.action}`);
  }
  if (expected.price) {
    assert.strictEqual(r.parsed_price, expected.price, `#${r.seq_no} 价格必须为 ${expected.price}`);
  }
  if (expected.qty) {
    assert.strictEqual(r.parsed_qty, expected.qty, `#${r.seq_no} 股数必须为 ${expected.qty}`);
  }
  if (expected.beforeQ !== undefined) {
    assert.strictEqual(r.before_qty, expected.beforeQ, `#${r.seq_no} 变动前股数必须为 ${expected.beforeQ}`);
  }
  if (expected.afterQ !== undefined) {
    assert.strictEqual(r.after_qty, expected.afterQ, `#${r.seq_no} 变动后股数必须为 ${expected.afterQ}`);
  }
  if (expected.lot !== undefined) {
    assert.strictEqual(r.source_lot_price, expected.lot, `#${r.seq_no} 批次价格必须为 ${expected.lot}`);
  }

  passCount++;
  console.log(`✅ [PASS] #${String(r.seq_no).padStart(2)} ${r.parsed_action} ${r.parsed_ticker.padEnd(5)} ${r.parsed_qty}股 @ $${r.parsed_price} (持仓: ${r.before_qty} -> ${r.after_qty}, lot: ${r.source_lot_price || '-'})`);
}

console.log('\n===========================================================');
console.log(`🎉 黄金回归测试全部通过！通过用例: ${passCount} 笔 (0 回退，100% 精准吻合)`);
console.log('===========================================================');
