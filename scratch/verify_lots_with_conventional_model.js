import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('📊 赵哥常规仓模型解析结果最终查验');
console.log('====================================================\n');

const lots = db.prepare("SELECT ticker, initial_price, open_reason, open_time FROM campaigns ORDER BY open_time DESC").all();

console.log(`📚 campaigns 表已落库 ${lots.length} 笔基于【常规仓折算】的实盘 Lots:`);
console.table(lots.map(l => ({
  symbol: l.ticker,
  entry_price: `$${l.initial_price}`,
  time: new Date(l.open_time).toLocaleDateString(),
  reason_and_lots: l.open_reason
})));
