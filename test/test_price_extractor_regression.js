/**
 * test_price_extractor_regression.js
 * 核心目标：建立黄金回归测试基准集 (Golden Benchmark)，杜绝任何打补丁导致的逻辑回退！
 */

import { extractSemanticPrice } from '../price_extractor.js';

const GOLDEN_TEST_CASES = [
  // 1. 已审历史标准批次卖出
  {
    raw: '866出一半 855的lite',
    ticker: 'LITE',
    action: 'SELL',
    expectedPrice: 866,
    expectedLot: 855,
    desc: '#22 LITE 半仓出 855 批次'
  },
  {
    raw: '875出剩下一半 855的lite',
    ticker: 'LITE',
    action: 'SELL',
    expectedPrice: 875,
    expectedLot: 855,
    desc: '#24 LITE 出剩下一半 855 批次'
  },
  {
    raw: '885出一半 859的lite',
    ticker: 'LITE',
    action: 'SELL',
    expectedPrice: 885,
    expectedLot: 859,
    desc: '#36 LITE 半仓出 859 批次'
  },
  {
    raw: '930-931附近出剩下一半 859的lite',
    ticker: 'LITE',
    action: 'SELL',
    expectedPrice: 930.5,
    expectedLot: 859,
    desc: '#37 LITE 区间出剩下一半 859 批次'
  },

  // 2. 带有修饰副词、助词、做T说明的复杂批次卖出 (重点防切片回退)
  {
    raw: '7.99 也是出一半 7.67的conl买2份卖一份',
    ticker: 'CONL',
    action: 'SELL',
    expectedPrice: 7.99,
    expectedLot: 7.67,
    desc: '#29 CONL 带“也是”与“买2卖1”复杂尾缀 (绝不能切断为 7.6 和 7)'
  },
  {
    raw: '14.41可以卖一半14.01的tsll买2卖1份这样 降本',
    ticker: 'TSLL',
    action: 'SELL',
    expectedPrice: 14.41,
    expectedLot: 14.01,
    desc: 'TSLL 带“可以卖一半”与“降本”'
  },
  {
    raw: '101.2出98.7的crwv',
    ticker: 'CRWV',
    action: 'SELL',
    expectedPrice: 101.2,
    expectedLot: 98.7,
    desc: '#16 CRWV 紧凑无空格卖出'
  },
  {
    raw: '98.3出  98.1 的第二轮的crwv',
    ticker: 'CRWV',
    action: 'SELL',
    expectedPrice: 98.3,
    expectedLot: 98.1,
    desc: '#25 CRWV 带多空格与“第二轮”'
  },

  // 3. 买回 / 接回 / 回吸模式
  {
    raw: '7.67在买回 7.99卖出的部分conl 就是不断套利降本',
    ticker: 'CONL',
    action: 'BUY',
    expectedPrice: 7.67,
    expectedLot: 7.99,
    desc: 'CONL 7.67买回7.99卖出部分'
  },
  {
    raw: '840在接回875卖出的lite',
    ticker: 'LITE',
    action: 'BUY',
    expectedPrice: 840,
    expectedLot: 875,
    desc: 'LITE 840在接回875卖出的'
  },

  // 4. 标准买入与开仓
  {
    raw: '865附近 开了三分之一常规仓的lite 止损 842',
    ticker: 'LITE',
    action: 'BUY',
    expectedPrice: 865,
    expectedLot: null,
    desc: '#6 LITE 标准买入带止损'
  },
  {
    raw: '855开了 lite第一个三分之常规仓 还后面再开2次每个股 价格拉开开三次',
    ticker: 'LITE',
    action: 'BUY',
    expectedPrice: 855,
    expectedLot: null,
    desc: '#20 LITE 标准买入带计划'
  },
  {
    raw: '18.25开了三分之一常规仓的cifr 止损在17.4',
    ticker: 'CIFR',
    action: 'BUY',
    expectedPrice: 18.25,
    expectedLot: null,
    desc: '#8 CIFR 标准买入'
  },

  // 5. 平本出 / 平仓
  {
    raw: '47.8 的iren在47.8 平本出',
    ticker: 'IREN',
    action: 'SELL',
    expectedPrice: 47.8,
    expectedLot: 47.8,
    desc: 'IREN 47.8 平本出'
  },
  {
    raw: '13.7附近平本出13.6的tsll',
    ticker: 'TSLL',
    action: 'SELL',
    expectedPrice: 13.7,
    expectedLot: 13.6,
    desc: 'TSLL 13.7附近平本出13.6的'
  },
  {
    raw: '885-886附近出lite的日内',
    ticker: 'LITE',
    action: 'SELL',
    expectedPrice: 885.5,
    expectedLot: null,
    desc: '#9 LITE 区间日内出'
  }
];

console.log('===========================================================');
console.log('🧪 启动赵哥交易语义解析器 Golden Regression 自动化回归测试套件');
console.log(`基准用例数: ${GOLDEN_TEST_CASES.length} 笔`);
console.log('===========================================================\n');

let passed = 0;
let failed = 0;

for (let i = 0; i < GOLDEN_TEST_CASES.length; i++) {
  const tc = GOLDEN_TEST_CASES[i];
  const res = extractSemanticPrice(tc.raw, tc.ticker, tc.action);
  
  const priceMatches = res.price !== null && Math.abs(res.price - tc.expectedPrice) < 0.1;
  const lotMatches = tc.expectedLot === null ? (res.sourceLotPrice === null || res.sourceLotPrice === undefined) : (res.sourceLotPrice !== null && Math.abs(res.sourceLotPrice - tc.expectedLot) < 0.1);

  if (priceMatches && lotMatches) {
    passed++;
    console.log(`✅ [PASS] #${i + 1} ${tc.desc} -> price: ${res.price}, lot: ${res.sourceLotPrice}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] #${i + 1} ${tc.desc}`);
    console.error(`   原文: "${tc.raw}"`);
    console.error(`   期望: price=${tc.expectedPrice}, lot=${tc.expectedLot}`);
    console.error(`   实际: price=${res.price}, lot=${res.sourceLotPrice} (debug: ${res.debug})`);
  }
}

console.log('\n===========================================================');
if (failed === 0) {
  console.log(`🎉 全部通过！PASS: ${passed}/${GOLDEN_TEST_CASES.length} (0 回退，100% 契合黄金标准)`);
  process.exit(0);
} else {
  console.error(`🚨 发现回退！FAIL: ${failed}/${GOLDEN_TEST_CASES.length}`);
  process.exit(1);
}
