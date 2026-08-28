import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📦 初始化 follow_decisions 独立跟单决策数据表');
console.log('====================================================\n');

db.exec(`
  CREATE TABLE IF NOT EXISTS follow_decisions (
    decision_id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    cu_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    decision_state TEXT NOT NULL,
    ticker TEXT NOT NULL,
    side TEXT NOT NULL,
    call_price REAL,
    arrival_price REAL,
    slip_bps REAL,
    ttl_remaining_sec REAL,
    executed_qty INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_follow_action ON follow_decisions (action_id);
  CREATE INDEX IF NOT EXISTS idx_follow_state ON follow_decisions (decision_state);
`);

console.log('✅ follow_decisions 独立决策表已成功就绪！');
