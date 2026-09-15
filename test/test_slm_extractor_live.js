/**
 * test_slm_extractor_live.js
 * 验证基于 LM Studio 14B 反代理的专有交易语义抽取器
 */

import { extractTradeWithSLM } from '../slm-extractor.js';

const TEST_INPUTS = [
  {
    raw: '866出一半 855的lite',
    desc: '批次卖出与指定原成本'
  },
  {
    raw: '7.67在买回 7.99卖出的部分conl 就是不断套利降本',
    desc: '做T买回加仓'
  },
  {
    raw: '18.25开了三分之一常规仓的cifr 止损在17.4',
    desc: '标准开仓带止损'
  },
  {
    raw: '指数在7450压力后选择往下补7200缺口，建议大家多看少动',
    desc: '纯大盘宏观分析（应当拒识，无交易）'
  }
];

async function main() {
  console.log('🧪 启动 SLM Extractor 本地 14B 实时端侧测试...\n');
  
  for (const item of TEST_INPUTS) {
    console.log(`----------------------------------------`);
    console.log(`用例: ${item.desc}`);
    console.log(`输入: "${item.raw}"`);
    const start = Date.now();
    const result = await extractTradeWithSLM(item.raw, { timeoutMs: 10000 });
    const elapsed = Date.now() - start;
    console.log(`耗时: ${elapsed}ms | 提取源: ${result.source}`);
    console.log(`提取结果:`, JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
