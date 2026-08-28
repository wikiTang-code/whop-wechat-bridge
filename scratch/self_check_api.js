import dotenv from 'dotenv';
dotenv.config();

console.log('====================================================');
console.log('🧪 全流程端到端自检：/api/zhao-positions 接口验证');
console.log('====================================================\n');

const u = process.env.DASHBOARD_USERNAME || process.env.ADMIN_USER || 'admin';
const p = process.env.DASHBOARD_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';

const authHeader = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

try {
  const res = await fetch('http://127.0.0.1:8085/api/zhao-positions', {
    headers: { Authorization: authHeader }
  });

  console.log('HTTP 状态码:', res.status, res.statusText);
  const json = await res.json();
  console.log('接口成功状态:', json.success);
  console.log('当前活跃持仓标的数:', json.data?.currentPositions?.length);
  
  if (json.data?.currentPositions?.length > 0) {
    console.log('\n持仓列表前 3 标的结构查验:');
    json.data.currentPositions.slice(0, 3).forEach(p => {
      console.log(`- [${p.ticker}] 当前持仓: ${p.totalQuantity} 股 | 仓位: ${p.lotBadge} | 均价: $${p.averageCost} | 市值: $${p.marketValue} | 浮盈: $${p.unrealizedPnL} | Lots批次数: ${p.lots?.length} | 全量历史交易数: ${p.allTrades?.length}`);
    });
  }
} catch (e) {
  console.error('自检发生异常:', e);
}
