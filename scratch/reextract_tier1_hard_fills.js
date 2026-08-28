import fs from 'fs';

console.log('====================================================');
console.log('🎯 Tier 1 18 条硬动词漏抽窗口精准补抽与合并');
console.log('====================================================\n');

const cleanedPath = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const lines = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean);
const records = lines.map(l => JSON.parse(l));

// 建立精确补抽映射
const TIER1_FILL_FIXES = {
  'cu_trade_00955': [
    {
      "action": "BUY",
      "ticker": "TSLL",
      "price": 12.32,
      "fraction": "部分",
      "condition": "12.32加回12.87卖出的tsll",
      "status": "filled",
      "instrument": "etf_2x"
    },
    {
      "action": "BUY",
      "ticker": "HOOD",
      "price": 85.65,
      "fraction": "一半",
      "condition": "85.65开了hood常规仓的一半",
      "status": "filled",
      "instrument": "equity"
    }
  ],
  'cu_trade_01174': [
    {
      "action": "BUY",
      "ticker": "AVGO",
      "price": 380.0,
      "fraction": "三分之一",
      "condition": "380加回三分之一常规仓",
      "status": "filled",
      "instrument": "equity"
    },
    {
      "action": "BUY",
      "ticker": "LITE",
      "price": 827.5,
      "fraction": "三分之一",
      "condition": "827.5加了三分之一常规仓",
      "status": "filled",
      "instrument": "equity"
    }
  ]
};

let patchedCount = 0;
for (const r of records) {
  if (TIER1_FILL_FIXES[r.cu_id]) {
    r.parsed = r.parsed || {};
    r.parsed.speech_act = 'trade_action';
    r.parsed.actions = TIER1_FILL_FIXES[r.cu_id];
    r.parsed.parse_status = 'ok';
    r.parse_ok = true;
    patchedCount++;
    console.log(`✅ [${r.cu_id}] 成功补齐 ${r.parsed.actions.length} 笔硬成交单: ${r.parsed.actions.map(a => `${a.action} ${a.ticker}@${a.price}`).join(', ')}`);
  }
}

fs.writeFileSync(cleanedPath, records.map(r => JSON.stringify(r)).join('\n'), 'utf-8');

console.log(`\n🎉 Tier 1 精准补抽完成！合并入库 ${patchedCount} 组真实硬成交窗口！`);
