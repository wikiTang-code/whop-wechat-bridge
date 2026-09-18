/**
 * test/test_ontology_query_engine.js
 * 单元测试：交易体系策略本体知识图谱智能检索与匹配引擎
 */

import Database from 'better-sqlite3';
import { queryKnowledgeCards } from '../tools/knowledge/ontology_query_engine.js';
import { ensureOntologyCardTable, saveOntologyCard } from '../database.js';

console.log('===========================================================');
console.log('🧪 启动 REQ-037 策略本体知识图谱智能检索引擎单测');
console.log('===========================================================\n');

// 创建内存数据库
const testDb = new Database(':memory:');
ensureOntologyCardTable(testDb);

// 准备模拟卡片
const sampleCards = [
  {
    id: 'card_nvda_risk',
    card_type: 'risk_rule',
    title: 'NVDA 极端行情防踩踏止损纪律',
    trigger_text: '跌破118支撑位出现破位转折',
    action_text: '无条件止损砍仓，底仓不盲动',
    theory_text: '左侧防暴跌踩踏，资金安全第一',
    tickers: ['NVDA'],
    provider: 'test_engine',
    status: 'distilled',
    schema: { confidence: 0.95 }
  },
  {
    id: 'card_qqq_pattern',
    card_type: 'pattern',
    title: 'QQQ 突破箱体缺口回踩做T战法',
    trigger_text: '30分钟突破缺口后回踩确认',
    action_text: '低吸加仓做T，降低持仓均价',
    theory_text: '筹码密集区交换与突破回踩确认逻辑',
    tickers: ['QQQ', 'TQQQ'],
    provider: 'test_engine',
    status: 'distilled',
    schema: { confidence: 0.90 }
  },
  {
    id: 'card_fed_macro',
    card_type: 'macro',
    title: '美联储利率决议与流动性紧缩逻辑',
    trigger_text: '鲍威尔讲话偏鹰暗示延缓降息',
    action_text: '控制美股成长股权益敞口，逢高防守',
    theory_text: '全球流动性总闸门驱动资产折现率重估',
    tickers: ['SPY', 'QQQ'],
    provider: 'test_engine',
    status: 'distilled',
    schema: { confidence: 0.88 }
  }
];

for (const c of sampleCards) {
  saveOntologyCard(c, testDb);
}

// 1. 验证根据 Ticker 精确匹配
console.log('[测试 1] 验证指定标的精确检索与加权...');
const nvdaResults = queryKnowledgeCards({
  ticker: 'NVDA',
  dbInstance: testDb
});

if (nvdaResults.length === 0 || nvdaResults[0].card.id !== 'card_nvda_risk') {
  console.error('❌ NVDA 精确检索失败:', nvdaResults);
  process.exit(1);
}
if (nvdaResults[0].score < 50) {
  console.error('❌ 标的精确匹配得分偏低:', nvdaResults[0].score);
  process.exit(1);
}
console.log(`  ✅ NVDA 精确检索通过 (Top 1: ${nvdaResults[0].card.title}, 得分: ${nvdaResults[0].score})`);

// 2. 验证意图语义与关键词匹配
console.log('\n[测试 2] 验证形态意图关键词 "突破回踩加仓" 召回...');
const patternResults = queryKnowledgeCards({
  text: '突破回踩加仓做T',
  dbInstance: testDb
});

if (patternResults.length === 0 || patternResults[0].card.card_type !== 'pattern') {
  console.error('❌ 形态意图关键词检索失败:', patternResults);
  process.exit(1);
}
console.log(`  ✅ 意图关键词成功命中 Pattern 卡片 (Top 1: ${patternResults[0].card.title}, 得分: ${patternResults[0].score})`);

// 3. 验证卡片类型物理过滤
console.log('\n[测试 3] 验证 cardType 过滤参数生效...');
const macroOnly = queryKnowledgeCards({
  cardType: 'macro',
  dbInstance: testDb
});

if (macroOnly.length !== 1 || macroOnly[0].card.card_type !== 'macro') {
  console.error('❌ cardType 过滤失效:', macroOnly);
  process.exit(1);
}
console.log(`  ✅ cardType="macro" 严格过滤通过 (命中: ${macroOnly[0].card.title})`);

// 4. 验证空参优雅降级
console.log('\n[测试 4] 验证全空参数下优雅降级召回...');
const emptyResults = queryKnowledgeCards({
  limit: 2,
  dbInstance: testDb
});

if (emptyResults.length !== 2) {
  console.error('❌ 空参降级失败:', emptyResults);
  process.exit(1);
}
console.log('  ✅ 空参优雅降级通过，正确返回默认降序卡片');

console.log('\n===========================================================');
console.log('🎉 REQ-037 策略本体知识图谱智能检索引擎单测全部 PASS！');
console.log('===========================================================');
