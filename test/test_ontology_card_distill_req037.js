/**
 * test_ontology_card_distill_req037.js
 * REQ-037 Phase 3: 策略本体树四大卡片蒸馏与持久化测试
 */

import assert from 'assert';
import Database from 'better-sqlite3';
import {
  ensureOntologyCardTable,
  listOntologyCards
} from '../database.js';
import {
  extractCardsHeuristic,
  distillOntologyCards
} from '../tools/knowledge/ontology-card-distill.js';

console.log('===========================================================');
console.log('🧪 [Test REQ-037 Phase 3] 交易体系本体树四大策略卡片蒸馏测试');
console.log('===========================================================\n');

const db = new Database(':memory:');
ensureOntologyCardTable(db);

// 1. 验证心法守则卡抽取 (risk_rule)
console.log('--- 1. 验证心法守则卡 (risk_rule) 抽取 ---');
const riskText = '弱势反弹跌破周五低点无条件止损，降仓至三四成，底仓不盲动';
const riskCards = extractCardsHeuristic(riskText, { message_id: 'm_risk_1', tickers: ['TSLA'] });
assert.strictEqual(riskCards.length, 1, '必须提取出 1 张心法卡');
assert.strictEqual(riskCards[0].card_type, 'risk_rule');
assert.strictEqual(riskCards[0].provider, 'heuristic_distill_v1');
assert.strictEqual(riskCards[0].status, 'distilled');
assert.ok(riskCards[0].action_text.includes('止损') || riskCards[0].action_text.includes('低水位'));
console.log('✅ risk_rule 心法守则卡抽取通过:', riskCards[0].title);

// 2. 验证形态战法卡抽取 (pattern)
console.log('\n--- 2. 验证形态战法卡 (pattern) 抽取 ---');
const patternText = '看这个30分钟级别的喇叭口，回补7200缺口前不加大仓，盘中冲高先做T高抛';
const patCards = extractCardsHeuristic(patternText, { message_id: 'm_pat_1' });
assert.ok(patCards.length >= 1, '必须提取出形态卡');
const pat = patCards.find(c => c.card_type === 'pattern');
assert.ok(pat, '必须包含 pattern 卡片');
assert.ok(pat.trigger_text.includes('缺口') || pat.action_text.includes('做T'));
console.log('✅ pattern 形态战法卡抽取通过:', pat.title);

// 3. 验证宏观逻辑卡抽取 (macro)
console.log('\n--- 3. 验证宏观逻辑卡 (macro) 抽取 ---');
const macroText = '美联储降息预期被市场充分计入，若鲍威尔表态偏鹰，成长科技股估值将承压';
const macroCards = extractCardsHeuristic(macroText, { message_id: 'm_mac_1' });
const mac = macroCards.find(c => c.card_type === 'macro');
assert.ok(mac, '必须包含 macro 卡片');
assert.ok(mac.theory_text.includes('贴现率') || mac.theory_text.includes('现金流'));
console.log('✅ macro 宏观逻辑卡抽取通过:', mac.title);

// 4. 验证标的股性记忆卡抽取 (asset_memory)
console.log('\n--- 4. 验证标的股性记忆卡 (asset_memory) 抽取 ---');
const assetText = 'TSLA 这只股洗盘极其凶狠，历史关键位 422 支撑点如果不稳不要盲目低吸';
const assetCards = extractCardsHeuristic(assetText, { message_id: 'm_ass_1', tickers: ['TSLA'] });
const ass = assetCards.find(c => c.card_type === 'asset_memory');
assert.ok(ass, '必须包含 asset_memory 卡片');
assert.deepStrictEqual(ass.tickers, ['TSLA']);
assert.ok(ass.theory_text.includes('主力') || ass.theory_text.includes('筹码'));
console.log('✅ asset_memory 标的记忆卡抽取通过:', ass.title);

// 5. 验证抗闲聊与噪音拦截
console.log('\n--- 5. 验证日常闲聊与噪音拦截 ---');
const chitChatTexts = ['早上好', '大家辛苦了！', '收盘了吃饭去', '哈哈', '亏惨了'];
for (const chat of chitChatTexts) {
  const empty = extractCardsHeuristic(chat);
  assert.strictEqual(empty.length, 0, `闲聊 "${chat}" 必须被过滤，不能生成垃圾卡片`);
}
console.log('✅ 抗闲聊与噪音过滤全部拦截成功');

// 6. 验证端到端入库与检索持久化
console.log('\n--- 6. 验证端到端入库与持久化检索 ---');
await distillOntologyCards(riskText, { meta: { cu_id: 'cu_001', message_id: 'm_001', tickers: ['TSLA'] } }, db);
await distillOntologyCards(patternText, { meta: { cu_id: 'cu_002', message_id: 'm_002' } }, db);

const { rows: riskRows, total: riskTotal } = listOntologyCards({ cardType: 'risk_rule', dbInstance: db });
assert.ok(riskTotal >= 1, '应成功检索出 risk_rule 卡片');
assert.strictEqual(riskRows[0].card_type, 'risk_rule');
assert.strictEqual(riskRows[0].provider, 'heuristic_distill_v1');

const { total: allTotal } = listOntologyCards({ dbInstance: db });
assert.ok(allTotal >= 2, '数据库中应成功沉淀至少 2 张结构化策略卡');
console.log('✅ 端到端入库与 listOntologyCards 检索校验通过');

console.log('\n===========================================================');
console.log('🎉 REQ-037 Phase 3 策略本体四大卡片蒸馏套件全部 PASS！');
console.log('===========================================================\n');

