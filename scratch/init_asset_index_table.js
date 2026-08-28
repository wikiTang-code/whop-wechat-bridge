import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🏛️ 初始化全局资产主索引表 (asset_index)');
console.log('====================================================\n');

db.exec(`
  CREATE TABLE IF NOT EXISTS asset_index (
    asset_id TEXT PRIMARY KEY,
    layer TEXT NOT NULL,
    speaker TEXT NOT NULL,
    cu_id TEXT,
    message_ids TEXT,
    kids TEXT,
    tickers TEXT,
    created_at_utc TEXT NOT NULL,
    created_at_et TEXT NOT NULL,
    parse_status TEXT NOT NULL,
    file_path TEXT,
    extra_meta TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_asset_cu ON asset_index(cu_id);
  CREATE INDEX IF NOT EXISTS idx_asset_layer ON asset_index(layer);
  CREATE INDEX IF NOT EXISTS idx_asset_speaker ON asset_index(speaker);
  CREATE INDEX IF NOT EXISTS idx_asset_tickers ON asset_index(tickers);
`);

console.log('✅ asset_index 统一资产主索引表与多维复合索引创建成功！');
