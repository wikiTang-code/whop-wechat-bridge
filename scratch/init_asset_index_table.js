import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🏛️ 初始化全局资产主索引表 (asset_index & asset_index_ticker)');
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
    action_count INTEGER DEFAULT 0,
    file_path TEXT,
    extra_meta TEXT
  );

  CREATE TABLE IF NOT EXISTS asset_index_ticker (
    asset_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    PRIMARY KEY (asset_id, ticker)
  );

  CREATE INDEX IF NOT EXISTS idx_asset_cu ON asset_index(cu_id);
  CREATE INDEX IF NOT EXISTS idx_asset_layer ON asset_index(layer);
  CREATE INDEX IF NOT EXISTS idx_asset_speaker ON asset_index(speaker);
  CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_index(parse_status);
  CREATE INDEX IF NOT EXISTS idx_ticker_lookup ON asset_index_ticker(ticker);
`);

console.log('✅ asset_index 与 asset_index_ticker 辅助表创建成功！');
