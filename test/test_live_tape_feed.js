/**
 * test/test_live_tape_feed.js
 * 验证自动驾驶感知总线 (Live Sensor Hub) 与四维共振决策
 */

import assert from 'assert';
import { toLongbridgeSymbol, deriveTapeEventFromDepth, runOnlineConfluenceScan } from '../tools/knowledge/live_tape_feed.js';
import { getDb } from '../database.js';

console.log('===========================================================');
console.log('🧪 [Test Live Feed] 自动驾驶感知总线与在线共振决策单测');
console.log('===========================================================\n');

// 1. 测试 Symbol 转换
console.log('--- 1. 验证长桥 Symbol 格式转换 ---');
assert.strictEqual(toLongbridgeSymbol('tsla'), 'TSLA.US');
assert.strictEqual(toLongbridgeSymbol('SPY.US'), 'SPY.US');
assert.strictEqual(toLongbridgeSymbol('QQQ'), 'QQQ.US');
console.log('  ✅ Symbol 转换校验通过');

// 2. 测试 Depth 买卖特征抽取
console.log('\n--- 2. 验证 Depth 盘口微观大单特征抽取 ---');
const mockDepth = {
  asks: [
    { price: '365.10', volume: 100 },
    { price: '365.20', volume: 200 }
  ],
  bids: [
    { price: '365.00', volume: 800 },
    { price: '364.90', volume: 1200 }
  ]
};

const tape = deriveTapeEventFromDepth('TSLA', 365.0, mockDepth);
assert(tape !== null, 'Tape 不应为空');
assert.strictEqual(tape.is_sweep, true, '买单严重积压应触发 is_sweep');
assert(tape.block_buy_usd > 0, '买一金额应大于0');
assert.strictEqual(tape.depth_summary.top_bid, '365.00 x 800');
console.log(`  ✅ 盘口深度特征提取通过: 买卖比率=${tape.imbalance_ratio}, 买一金额=$${tape.block_buy_usd}`);

// 3. 测试在线共振执行 (使用 Mock QuoteContext)
console.log('\n--- 3. 验证在线共振扫描与杠杆 ETF 动态投影 ---');
const mockQuoteCtx = {
  quote: async (symbols) => {
    return [
      { symbol: 'TSLA.US', lastDone: '364.50', prevClose: '360.00', high: '368.00', low: '358.00', volume: 50000000 },
      { symbol: 'SPY.US', lastDone: '761.50', prevClose: '760.00', high: '763.00', low: '758.00', volume: 60000000 },
    ];
  },
  depth: async (symbol) => mockDepth,
};

const results = await runOnlineConfluenceScan(['TSLA', 'SPY'], {
  quoteCtx: mockQuoteCtx,
  dbInstance: getDb(),
});

assert(Array.isArray(results), '结果应为数组');
assert.strictEqual(results.length, 2, '应扫描2个标的');

const tslaRes = results.find(r => r.ticker === 'TSLA');
assert(tslaRes, '必须包含 TSLA 扫描结果');
assert(tslaRes.confluence_score >= 0, '共振总分应存在');
assert(tslaRes.leveraged_etf, 'TSLA 必须有对应的 2x 做多 ETF (TSLL) 折算');
assert.strictEqual(tslaRes.leveraged_etf.etf, 'TSLL');
assert.strictEqual(tslaRes.leveraged_etf.leverage, 2);

console.log(`  ✅ TSLA 共振总分: ${tslaRes.confluence_score} (${tslaRes.confluence_level})`);
console.log(`  ✅ TSLL 动态折算 ETF 现价: $${tslaRes.leveraged_etf.etf_current_price}, 支撑点位:`, tslaRes.leveraged_etf.projected_support);

console.log('\n===========================================================');
console.log('🎉 自动驾驶感知总线与在线共振决策测试全部 PASS！');
console.log('===========================================================');
