import Database from 'better-sqlite3';
const db = new Database('/home/wikitang628/whop-wechat-bridge/whop_archive.db');
const info = db.prepare("DELETE FROM task_queue WHERE status IN ('pending', 'running', 'retry')").run();
console.log(`=== [DB Clean] 成功强力清除挂起任务数: ${info.changes} ===`);
