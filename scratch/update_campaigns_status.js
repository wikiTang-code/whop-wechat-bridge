import { getDb } from '../database.js';

const db = getDb();
console.log('====================================================');
console.log('🔄 更新 campaigns 表 16 笔记录区持仓 Lots 为 active 状态');
console.log('====================================================\n');

db.prepare("UPDATE campaigns SET status = 'active'").run();

const activeCount = db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").get()?.c;
console.log(`✅ 已将 campaigns 表全量 ${activeCount} 笔记录区持仓标记为 active 活跃呈现状态！`);
