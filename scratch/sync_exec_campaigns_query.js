import { getDb } from '../database.js';

const db = getDb();
db.pragma('busy_timeout = 10000');

// 1. 检查最新 campaigns
const lots = db.prepare("SELECT ticker, initial_price, open_reason, open_time FROM campaigns ORDER BY open_time DESC LIMIT 10").all();

console.log('====================================================');
console.log(`✅ 成功落库【历史股票期权记录区】(forum_feed) 实盘 Lots！当前展示最新 10 条:`);
console.log('====================================================\n');

console.table(lots.map(l => ({
  symbol: l.ticker,
  price: `$${l.initial_price}`,
  time: new Date(l.open_time).toLocaleString(),
  lots_and_reason: l.open_reason
})));
