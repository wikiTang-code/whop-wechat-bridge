import assert from 'assert';
import Database from 'better-sqlite3';
import { distillEarlyLongArticles } from '../tools/knowledge/long_article_distill.js';

console.log('🧪 [Test DEBT-019] 早期历史长文重蒸馏与深层心法提取单测');

// 1. 初始化内存测试数据库
const db = new Database(':memory:');

db.prepare(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    sender_id TEXT,
    sender_name TEXT,
    content TEXT,
    created_at INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE ontology_card (
    id TEXT PRIMARY KEY,
    card_type TEXT NOT NULL,
    title TEXT,
    trigger_text TEXT,
    action_text TEXT,
    theory_text TEXT,
    tickers_json TEXT,
    source_cu_id TEXT,
    source_message_ids_json TEXT,
    provider TEXT NOT NULL DEFAULT 'stub',
    status TEXT NOT NULL DEFAULT 'draft',
    schema_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

console.log('  ✅ 1. 内存测试表结构创建完成');

// 2. 注入包含深层心法、尾盘强平、宏观推演的 2025 年早期消息
const ZHAO_ID = 'user_4yeplXgbguTu4';
const NON_ZHAO_ID = 'user_other_fan';
const T_2025 = new Date('2025-10-15T12:00:00Z').getTime();
const T_2026 = new Date('2026-03-15T12:00:00Z').getTime();

const testMsgs = [
  // 模式 A+D: 赵哥 2025 年尾盘强平吸筹与 NVDL 点位长文
  {
    id: 'early_msg_1',
    channel_id: 'ch1',
    sender_id: ZHAO_ID,
    sender_name: 'xiaozhaolucky',
    content: '收盘更新收盘价看是不是V nvdl 英伟达双倍 盘后最低价跳到 85.6 周一跳空再跌到 78-80 附近可以买了长拿 最近有中东订单比较推荐 尾盘3点半强平抢V点吸筹',
    created_at: T_2025
  },
  // 模式 B+C: 赵哥 2025 年仓位二分法与宏观关税流动性长文
  {
    id: 'early_msg_2',
    channel_id: 'ch1',
    sender_id: ZHAO_ID,
    sender_name: 'xiaozhaolucky',
    content: '微牛和中概股因为关税预期和全球流动性出现回调 仓位严格执行二分法分批买入 破位坚决减半止损 亚太共振带动美股高开 不与大趋势对抗',
    created_at: T_2025 + 1000
  },
  // 过滤用例 1: 非赵哥的长文 (必须被排除)
  {
    id: 'early_msg_3',
    channel_id: 'ch1',
    sender_id: NON_ZHAO_ID,
    sender_name: 'guest_user',
    content: '群友长篇大论分析市场流动性和尾盘强平吸筹 建议大家仓位二分法买入 TSLA $240',
    created_at: T_2025 + 2000
  },
  // 过滤用例 2: 2026 年以后的消息 (不属于 2025 早期长文)
  {
    id: 'early_msg_4',
    channel_id: 'ch1',
    sender_id: ZHAO_ID,
    sender_name: 'xiaozhaolucky',
    content: '2026年的新发言 尾盘3点半强平 仓位二分法控制总暴露',
    created_at: T_2026
  }
];

const insertStmt = db.prepare(`INSERT INTO messages (id, channel_id, sender_id, sender_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
for (const m of testMsgs) {
  insertStmt.run(m.id, m.channel_id, m.sender_id, m.sender_name, m.content, m.created_at);
}

console.log('  ✅ 2. 测试消息注入完成 (含大V硬锁与时间边界)');

// 3. 执行重蒸馏测试 (指定 outDir: false 避免覆盖真实生产产物)
const dryRes = distillEarlyLongArticles(db, { persist: false, minLength: 50, outDir: false });
assert.strictEqual(dryRes.processed_messages_count, 2, '应仅命中赵哥 2025 年的 2 条长文 (过滤群友与2026年)');
assert(dryRes.extracted_cards_count >= 3, '应提取出多张深层策略与心法卡片');

// 校验卡片类型覆盖
const cardTypes = new Set(dryRes.cards.map(c => c.card_type));
assert(cardTypes.has('pattern'), '必须包含 pattern 战法卡');
assert(cardTypes.has('risk_rule'), '必须包含 risk_rule 风控规则卡');
assert(cardTypes.has('macro'), '必须包含 macro 宏观映射卡');
console.log('  ✅ 3. 深层心法提取与三类核心卡片模式匹配通过');

// 4. 执行落库与幂等性校验
const persistRes1 = distillEarlyLongArticles(db, { persist: true, minLength: 50, outDir: false });
assert.strictEqual(persistRes1.persisted_count, dryRes.extracted_cards_count, '首次落库数量应与提取数量一致');
assert.strictEqual(persistRes1.final_card_count, dryRes.extracted_cards_count);

const persistRes2 = distillEarlyLongArticles(db, { persist: true, minLength: 50, outDir: false });
assert.strictEqual(persistRes2.persisted_count, 0, '重复执行新增应为 0');
assert.strictEqual(persistRes2.skipped_count, dryRes.extracted_cards_count, '重复执行应全部幂等跳过');
assert.strictEqual(persistRes2.final_card_count, dryRes.extracted_cards_count, '总卡片数保持不变');
console.log('  ✅ 4. 幂等入库与状态机校验通过');

// 5. 生产真实运行时产物门禁指标校验 (DEBT-019 Gate)
import fs from 'fs';
import path from 'path';

const runtimeCardsPath = path.resolve('data/runtime/early_long_article_cards.json');
const runtimeQaPath = path.resolve('data/runtime/slm_qa_pairs.json');

assert.ok(fs.existsSync(runtimeCardsPath), 'early_long_article_cards.json 产物必须存在');
assert.ok(fs.existsSync(runtimeQaPath), 'slm_qa_pairs.json 产物必须存在');

const runtimeCards = JSON.parse(fs.readFileSync(runtimeCardsPath, 'utf8'));
const runtimeQa = JSON.parse(fs.readFileSync(runtimeQaPath, 'utf8'));

assert.ok(runtimeCards.length >= 300, `DEBT-019 门禁：提纯深层卡片应 >= 300 张，实测: ${runtimeCards.length}`);
assert.ok(runtimeQa.length >= 500, `DEBT-019 门禁：SLM 问答对训练集应 >= 500 组，实测: ${runtimeQa.length}`);
console.log(`  ✅ 5. DEBT-019 核心门禁通过: 深层卡片 ${runtimeCards.length} 张 (>=300), 问答对 ${runtimeQa.length} 组 (>=500)`);

db.close();
console.log('🎉 [Test DEBT-019] 早期历史长文重蒸馏与深层心法提取单测全部 PASS！\n');

