/**
 * test/test_multimodal_context_aligner_chg029.js
 * 验证 CHG-029 多模态真图与上下文流式增量对齐流水线
 */
import assert from 'assert';
import Database from 'better-sqlite3';
import {
  alignMultimodalCards,
  stripTradingDirectives,
  filterInBandSR,
} from '../tools/knowledge/multimodal_context_aligner.js';
import { ensureOntologyCardTable, ensureMessageVisionMetaTable } from '../database.js';

console.log('===========================================================');
console.log('🧪 [Test CHG-029/034] 多模态真图流式增量对齐单测套件');
console.log('===========================================================');

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  ensureOntologyCardTable(db);
  ensureMessageVisionMetaTable(db);
  return db;
}

// 1. 验证白名单脱敏
console.log('\n--- 1. 验证交易指令脱敏过滤 ---');
assert.strictEqual(stripTradingDirectives('建议买入 TSLA，立即做多'), '[建议已过滤] TSLA，[建议已过滤]');
assert.strictEqual(stripTradingDirectives('BUY 100 contracts'), '[FILTERED] 100 contracts');
console.log('  ✅ 白名单过滤校验通过');

// 1b. CHG-034 带内清洗
console.log('\n--- 1b. 验证 filterInBandSR 带内清洗 ---');
const cleaned = filterInBandSR({ support: [0.06, 350], resistance: [18.3, 370] }, 'TSLA');
assert.deepStrictEqual(cleaned.support, [350]);
assert.deepStrictEqual(cleaned.resistance, [370]);
const tsll = filterInBandSR({ support: [10], resistance: [900] }, 'TSLL');
assert.deepStrictEqual(tsll.support, [10]);
assert.deepStrictEqual(tsll.resistance, []);
console.log('  ✅ 带内清洗校验通过');

// 2. 验证流式增量对齐与状态机防漏
console.log('\n--- 2. 验证多模态流式增量对齐写入 ---');
const db = setupTestDb();

// 插入 mock 消息 (赵哥真实 sender_id)
db.prepare(`
  INSERT INTO messages (id, channel_id, sender_id, sender_name, content, created_at)
  VALUES ('msg_1', 'ch_1', 'user_4yeplXgbguTu4', 'xiaozhaolucky', '这里是二次探底，关注675支撑', 1700000000000)
`).run();

// 插入 mock 非赵哥消息 (应被过滤)
db.prepare(`
  INSERT INTO messages (id, channel_id, sender_id, sender_name, content, created_at)
  VALUES ('msg_fan', 'ch_1', 'user_fan_123', '赵哥小迷弟', '我也觉得会涨', 1700000000000)
`).run();
db.prepare(`
  INSERT INTO message_vision_meta (
    id, message_id, attach_index, local_path, ticker, timeframe,
    patterns_json, support_resistance_json, hand_drawn_annotation,
    schema_json, provider, status, created_at, updated_at
  ) VALUES (
    'vmeta_fan_0', 'msg_fan', 0, 'data/media/zhao/post_fan.jpg', 'SPY', '1D',
    '["双底"]', '{"support":[670.0]}', null,
    '{}', 'cloud_vl', 'ok', 1700000000000, 1700000000000
  )
`).run();

// 插入 mock 视觉元数据 (status='ok')
db.prepare(`
  INSERT INTO message_vision_meta (
    id, message_id, attach_index, local_path, ticker, timeframe,
    patterns_json, support_resistance_json, hand_drawn_annotation,
    schema_json, provider, status, created_at, updated_at
  ) VALUES (
    'vmeta_msg_1_0', 'msg_1', 0, 'data/media/zhao/post_1.jpg', 'SPY', '1D',
    '["双底","二次探底"]', '{"support":[675.0, 676.5],"resistance":[682.0]}', '红色手绘双箭头指向低点',
    '{}', 'cloud_vl', 'ok', 1700000000000, 1700000000000
  )
`).run();

// 插入 mock 桩数据 (status='stubbed' 应被过滤)
db.prepare(`
  INSERT INTO message_vision_meta (
    id, message_id, attach_index, local_path, ticker, timeframe,
    patterns_json, support_resistance_json, hand_drawn_annotation,
    schema_json, provider, status, created_at, updated_at
  ) VALUES (
    'vmeta_msg_2_0', 'msg_2', 0, 'data/media/zhao/post_2.jpg', null, null,
    '[]', null, null,
    '{}', 'stub', 'stubbed', 1700000000000, 1700000000000
  )
`).run();

const res1 = alignMultimodalCards({ dbInstance: db });
assert.strictEqual(res1.aligned_count, 1, '应成功增量对齐 1 张卡片');
assert.strictEqual(res1.tickers_covered.length, 1);
assert.strictEqual(res1.tickers_covered[0], 'SPY');
assert.strictEqual(res1.levels_extracted, 3, '应提取出 2个支撑 + 1个阻力');

const cardRow = db.prepare(`SELECT * FROM ontology_card WHERE id = 'card_mm_vmeta_msg_1_0'`).get();
assert.ok(cardRow, '必须成功写入 ontology_card');
assert.strictEqual(cardRow.provider, 'multimodal_vl');
assert.strictEqual(cardRow.card_type, 'level');
assert.strictEqual(cardRow.status, 'active');
assert.ok(cardRow.trigger_text.includes('675'), 'trigger_text 必须包含支撑位');
assert.ok(cardRow.title.includes('SPY'), 'title 必须包含 SPY');

// 3. 验证幂等性与防漏 (再次对齐应不产生重复)
console.log('\n--- 3. 验证幂等对齐防重 ---');
const res2 = alignMultimodalCards({ dbInstance: db });
assert.strictEqual(res2.pending_count, 0, '没有未对齐的，pending 应为 0');
assert.strictEqual(res2.aligned_count, 0, '幂等再次执行不重复写入');
console.log('  ✅ 幂等防重校验通过');

console.log('===========================================================');
console.log('🎉 [Test CHG-029] 多模态真图流式对齐单测全部 PASS！');
console.log('===========================================================');
