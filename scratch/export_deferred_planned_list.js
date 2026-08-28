import fs from 'fs';

console.log('====================================================');
console.log('📦 整理 Tier 1 包含计划/历史挂单的延迟清单 (l2a_deferred_planned_list)');
console.log('====================================================\n');

const sourceCuPath = 'data/samples/l2a_broadcast_cu_1195.jsonl';
const sourceLines = fs.readFileSync(sourceCuPath, 'utf-8').trim().split('\n').filter(Boolean);
const sourceMap = new Map();
for (const l of sourceLines) {
  const obj = JSON.parse(l);
  const text = (obj.dialogue_messages || []).map(m => m.text).join(' ');
  sourceMap.set(obj.cu_id, text);
}

const DEFERRED_CU_IDS = [
  { cu_id: 'cu_trade_00044', reason: '周一跳空计划长拿单清单' },
  { cu_id: 'cu_trade_00081', reason: 'RKLB 期权 0.6吸/0.7-0.8减 计划单' },
  { cu_id: 'cu_trade_00164', reason: '周一高开计划减仓币股' },
  { cu_id: 'cu_trade_00237', reason: '38.8出2000股/18.5-18.8低吸做T单' },
  { cu_id: 'cu_trade_00193', reason: '历史成交复盘单与二次握手' }
];

const deferredList = DEFERRED_CU_IDS.map(d => ({
  cu_id: d.cu_id,
  reason: d.reason,
  source_text: sourceMap.get(d.cu_id) || '',
  status: "deferred_planned"
}));

const outDeferredPath = 'data/runs/l2a_deferred_planned_list.jsonl';
fs.writeFileSync(outDeferredPath, deferredList.map(d => JSON.stringify(d)).join('\n'), 'utf-8');

console.log(`✅ 已成功导出 ${deferredList.length} 条延迟计划清单至: ${outDeferredPath}`);
