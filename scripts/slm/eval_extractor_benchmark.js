/**
 * eval_extractor_benchmark.js
 * REQ-036 交易语义抽取器全量基准评测 (Golden Benchmark Suite)
 * 验证端侧抽取器与兜底引擎在复合交易、批次提取、抗幻觉负样本上的表现。
 */

import { extractTradeWithSLM } from '../../slm-extractor.js';
import { extractSemanticPrice } from '../../price_extractor.js';

const BENCHMARK_CASES = [
  // 1. 批次卖出与原成本
  {
    raw: '866出一半 855的lite',
    expectedSymbol: 'LITE',
    expectedAction: 'SELL',
    expectedPrice: 866,
    expectedLot: 855,
    isTrade: true
  },
  {
    raw: '7.99 也是出一半 7.67的conl买2份卖一份',
    expectedSymbol: 'CONL',
    expectedAction: 'SELL',
    expectedPrice: 7.99,
    expectedLot: 7.67,
    isTrade: true
  },
  // 2. 做T买回加仓
  {
    raw: '7.67在买回 7.99卖出的部分conl 就是不断套利降本',
    expectedSymbol: 'CONL',
    expectedAction: 'BUY',
    expectedPrice: 7.67,
    expectedLot: 7.99,
    isTrade: true
  },
  // 3. 标准买入与止损
  {
    raw: '865附近 开了三分之一常规仓的lite 止损 842',
    expectedSymbol: 'LITE',
    expectedAction: 'BUY',
    expectedPrice: 865,
    expectedLot: null,
    isTrade: true
  },
  {
    raw: '18.25开了三分之一常规仓的cifr 止损在17.4',
    expectedSymbol: 'CIFR',
    expectedAction: 'BUY',
    expectedPrice: 18.25,
    expectedLot: null,
    isTrade: true
  },
  // 4. 抗幻觉负样本 (绝不能提取出交易)
  {
    raw: '大盘在这个位置会有反复折锯，CPI数据出来前控制好整体仓位。',
    isTrade: false
  },
  {
    raw: '纳指今天高开低走，科技股整体承压，多看少动。',
    isTrade: false
  }
];

async function runBenchmark() {
  console.log('====================================================');
  console.log('📊 启动 REQ-036 交易语义抽取基准评测 (Benchmark)');
  console.log(`用例总数: ${BENCHMARK_CASES.length} (含正反样本)`);
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < BENCHMARK_CASES.length; i++) {
    const tc = BENCHMARK_CASES[i];
    const res = await extractTradeWithSLM(tc.raw, { timeoutMs: 3000 }); // 超时快速 fallback 到 tokenizer

    let ok = true;
    let reason = '';

    if (!tc.isTrade) {
      // 负样本测试：不能有交易
      if (res.has_trade && res.trades.length > 0) {
        ok = false;
        reason = `负样本发生幻觉！错误提取出交易: ${JSON.stringify(res.trades)}`;
      }
    } else {
      // 正样本测试：必须准确提取
      if (!res.has_trade || res.trades.length === 0) {
        ok = false;
        reason = '未能识别交易动作';
      } else {
        const tr = res.trades[0];
        if (tc.expectedSymbol && tr.symbol !== tc.expectedSymbol) {
          ok = false;
          reason += `标的错误(期望${tc.expectedSymbol}, 实际${tr.symbol}); `;
        }
        if (tc.expectedAction && tr.action !== tc.expectedAction) {
          ok = false;
          reason += `方向错误(期望${tc.expectedAction}, 实际${tr.action}); `;
        }
        if (tc.expectedPrice && Math.abs(tr.price - tc.expectedPrice) > 0.1) {
          ok = false;
          reason += `价格错误(期望${tc.expectedPrice}, 实际${tr.price}); `;
        }
        if (tc.expectedLot !== undefined && tc.expectedLot !== null) {
          if (!tr.source_lot_price || Math.abs(tr.source_lot_price - tc.expectedLot) > 0.1) {
            ok = false;
            reason += `批次成本错误(期望${tc.expectedLot}, 实际${tr.source_lot_price}); `;
          }
        }
      }
    }

    if (ok) {
      passed++;
      console.log(`✅ [PASS] #${i + 1} "${tc.raw.substring(0, 30)}..." [${res.source}]`);
    } else {
      failed++;
      console.error(`❌ [FAIL] #${i + 1} "${tc.raw}" [${res.source}]: ${reason}`);
    }
  }

  console.log('\n====================================================');
  console.log(`评测总结: 通过 ${passed} / ${BENCHMARK_CASES.length} (成功率: ${((passed / BENCHMARK_CASES.length) * 100).toFixed(1)}%)`);
  console.log('====================================================');

  if (failed === 0) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runBenchmark().catch(e => {
  console.error(e);
  process.exit(1);
});
