/**
 * test/test_spx_spy_converter.js
 * 单元测试：标普500指数 (SPX) 与 ETF (SPY) 跨时段动态等效换算引擎
 */

import assert from 'assert';
import {
  convertSpyToSpx,
  resolveSpxQuote,
  DEFAULT_SPX_SPY_RATIO,
  TRADINGVIEW_SPX500_URL,
  fetchTradingViewSpxSpot
} from '../tools/knowledge/index_equivalent_converter.js';

console.log('===========================================================');
console.log('🧪 [Test SPX Converter] SPX 与 SPY 跨时段动态等效换算引擎测试');
console.log('===========================================================\n');

// 1. 验证静态基准倍率换算
console.log('--- 1. 验证静态基准倍率换算 (10.0x) ---');
const spyPrice1 = 565.42;
const res1 = convertSpyToSpx(spyPrice1);
assert.strictEqual(res1.spx_equivalent_price, 5654.20);
assert.strictEqual(res1.ratio, 10.0);
assert.strictEqual(res1.method, 'STANDARD_RATIO');
assert.strictEqual(res1.is_derived, true);
console.log(`  ✅ 静态换算精准: SPY $${spyPrice1} -> SPX $${res1.spx_equivalent_price} (倍率: ${res1.ratio})`);

// 2. 验证基于昨收盘价的动态比率对齐换算
console.log('\n--- 2. 验证动态昨收比率对齐换算 ---');
const spxPrevClose = 5667.21;
const spyPrevClose = 565.12;
const dynamicRatio = spxPrevClose / spyPrevClose; // 约 10.0283
const res2 = convertSpyToSpx(568.00, { spxPrevClose, spyPrevClose });
const expectedPrice = parseFloat((568.00 * dynamicRatio).toFixed(2));
assert.strictEqual(res2.spx_equivalent_price, expectedPrice);
assert.strictEqual(res2.method, 'DYNAMIC_PREV_CLOSE_RATIO');
console.log(`  ✅ 动态比率换算精准: 昨收 SPX ${spxPrevClose} / SPY ${spyPrevClose} = ${res2.ratio} -> SPX $${res2.spx_equivalent_price}`);

// 3. 验证常规盘中 (RTH) 具备真实有效 SPX 行情时的直通透传
console.log('\n--- 3. 验证盘中有效真实 SPX 行情直通透传 ---');
const realSpxQuote = {
  ticker: 'SPX',
  symbol: '.SPX.US',
  last_price: 5660.85,
  prev_close: 5650.00,
};
const spyQuote = {
  ticker: 'SPY',
  symbol: 'SPY.US',
  last_price: 565.80,
  prev_close: 565.00,
};
const resolvedRth = resolveSpxQuote(realSpxQuote, spyQuote, { isRth: true });
assert.strictEqual(resolvedRth.last_price, 5660.85);
assert.strictEqual(resolvedRth.is_derived_from_spy, false);
console.log(`  ✅ 盘中真实行情直通通过: $${resolvedRth.last_price} (未被换算覆盖)`);

// 4. 验证非常规盘中 / 夜盘 / 盘前缺失 SPX 时自动通过 SPY 换算兜底
console.log('\n--- 4. 验证夜盘/盘前无 SPX 时自动通过 SPY 换算兜底 ---');
const offlineSpxQuote = {
  ticker: 'SPX',
  symbol: '.SPX.US',
  last_price: 0, // 盘前盘后无撮合现价
  prev_close: 5650.00,
};
const resolvedOffHours = resolveSpxQuote(offlineSpxQuote, spyQuote, { isRth: false });
assert.strictEqual(resolvedOffHours.is_derived_from_spy, true);
assert(resolvedOffHours.last_price > 5000, '换算后等效指数应处于正常大盘区间');
assert.strictEqual(resolvedOffHours.derived_meta.method, 'DYNAMIC_PREV_CLOSE_RATIO');
console.log(`  ✅ 夜盘换算兜底生效: 等效 SPX 现价 $${resolvedOffHours.last_price} (来源: SPY $${spyQuote.last_price})`);

// 5. 验证 TradingView SPX500 外部全天候实时图表参考通道
console.log('\n--- 5. 验证 TradingView SPX500 外部参考配置 ---');
assert(TRADINGVIEW_SPX500_URL.includes('CAPITALCOM%3ASPX500'), 'TradingView 参考链接应包含 CAPITALCOM:SPX500');
console.log(`  ✅ TradingView 外部参考图表配置正确: ${TRADINGVIEW_SPX500_URL}`);

// 探测 TradingView 公共指数 (可选网络连通性)
try {
  const tvSpot = await fetchTradingViewSpxSpot();
  if (tvSpot) {
    console.log(`  ✅ TradingView 实时行情探测通过: ${tvSpot.symbol} $${tvSpot.last_price} (${tvSpot.change_pct}%)`);
  } else {
    console.log(`  ℹ️ TradingView 探测网络离线或受限，已平稳优雅降级`);
  }
} catch (_) {
  console.log(`  ℹ️ TradingView 探测异常，已平稳优雅降级`);
}

console.log('\n===========================================================');
console.log('🎉 SPX 与 SPY 跨时段动态等效换算引擎单测全部 PASS！');
console.log('===========================================================');
