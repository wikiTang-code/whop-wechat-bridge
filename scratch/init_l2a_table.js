import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

db.exec(`
  CREATE TABLE IF NOT EXISTS l2a_order_candidates (
    cu_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    channel_id TEXT,
    et_session TEXT,
    et_date TEXT,
    speech_act TEXT,
    actions_json TEXT,
    claims_json TEXT,
    raw_text TEXT,
    parse_ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_speech_act ON l2a_order_candidates(speech_act);
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_date ON l2a_order_candidates(et_date);
`);

console.log('✅ l2a_order_candidates 表初始化完成！');
