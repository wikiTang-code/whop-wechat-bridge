import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('🛑 尊照指令：物理清空干洗所有 news_* 社区资讯任务');
console.log('====================================================\n');

const res = db.prepare("DELETE FROM task_queue WHERE task_type LIKE 'news_%'").run();

console.log(`✅ 成功物理干洗销毁了 ${res.changes} 个 news_* 社区资讯任务！`);
console.log('🛡️ 算力已全部释放，停止所有资讯后台自动消费，等待单篇调优测试！');
