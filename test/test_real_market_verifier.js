/**
 * test/test_real_market_verifier.js
 * 验证真实券商行情/K线数据空间偏差校验器
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import { verifyRealMarketData } from '../tools/knowledge/real_market_confluence_verifier.js';

console.log('===========================================================');
console.log('🧪 [Test Verifier] 真实券商行情/K线数据校验器单测套件');
console.log('===========================================================');

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ontology_card (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      schema_json TEXT,
      tickers_json TEXT,
      provider TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trade_signals (
      signal_id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      channel_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

const db = setupTestDb();
// 插入测试卡片与真单
db.prepare(`
  INSERT INTO ontology_card (id, title, schema_json, tickers_json, provider, created_at)
  VALUES ('card_test_1', 'IREN 阻力', '{"support_resistance":{"support":[43],"resistance":[46]}}', '["IREN"]', 'multimodal_vl', 1789400000000)
`).run();

db.prepare(`
  INSERT INTO trade_signals (signal_id, ticker, action, price, quantity, channel_id, created_at)
  VALUES ('sig_test_1', 'IREN', 'BUY', 43.1, 100, 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN', 1789400000000)
`).run();

// 运行检验
const reports = await verifyRealMarketData(['IREN'], { dbInstance: db });
assert.ok(reports.length === 1, '应成功拉取并验证 1 个标的');
const r = reports[0];
assert.strictEqual(r.ticker, 'IREN');
assert.ok(r.market.realCurrentPrice > 0, '真实价格必须大于0');
assert.ok(r.confluence_verification.zhao_multimodal.level === 46, '应正确匹配到多模态点位 46');
console.log('  ✅ 真实券商行情拉取与点位空间偏差验证完全通过！');
