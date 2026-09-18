#!/usr/bin/env node
/**
 * tools/knowledge/batch_distill_pipeline.js
 * REQ-037 Phase 3: 大批次离线策略本体卡片知识蒸馏流水线
 * 
 * 核心功能：
 * 1. 扫描 messages 历史高价值策略与风控发言
 * 2. 批量提炼四大策略本体卡片 (risk_rule, pattern, macro, asset_memory)
 * 3. 支持断点续传、幂等防重与 SQLite 批量事务提交
 * 4. 离线零显存争用，为实盘参谋与知识图谱奠定核心资产
 */

import { initDb, getDb, ensureOntologyCardTable, saveOntologyCard } from '../../database.js';
import { extractCardsHeuristic } from './ontology-card-distill.js';

/** messages.tickers may be JSON array string or comma-separated */
export function parseMessageTickers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim().toUpperCase()).filter(Boolean);
  const s = String(raw).trim();
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      return parsed.map((t) => String(t).trim().toUpperCase()).filter(Boolean);
    }
  } catch (_) {}
  return s.split(/[,|\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
}

export async function runBatchDistill(options = {}) {
  const {
    limit = 200,
    dryRun = false,
    force = false,
    batchSize = 50,
    dbInstance = null
  } = options;

  initDb();
  const db = dbInstance || getDb();
  ensureOntologyCardTable(db);

  console.log('===========================================================');
  console.log(`🚀 启动大批次策略本体卡片知识蒸馏流水线 (REQ-037 Phase 3)`);
  console.log(`参数配置: Limit=${limit}, DryRun=${dryRun}, Force=${force}, BatchSize=${batchSize}`);
  console.log('===========================================================\n');

  // 1. 查询已蒸馏过的 message_id 列表，支持断点续传
  const processedMessageIds = new Set();
  if (!force) {
    const existing = db.prepare(`
      SELECT source_message_ids_json FROM ontology_card
      WHERE provider = 'heuristic_distill_v1' AND source_message_ids_json IS NOT NULL
    `).all();
    for (const row of existing) {
      try {
        const ids = JSON.parse(row.source_message_ids_json);
        if (Array.isArray(ids)) {
          ids.forEach(id => processedMessageIds.add(id));
        }
      } catch (_) {}
    }
  }
  console.log(`[Batch Distill] 已处理索引库排重集合包含: ${processedMessageIds.size} 条历史消息`);

  // 2. 检索包含策略本体特征的大V发言
  const candidateQuery = `
    SELECT id, content, tickers, created_at, sender_name, channel_id
    FROM messages
    WHERE content IS NOT NULL AND LENGTH(TRIM(content)) >= 10
      AND (
        content LIKE '%止损%' OR content LIKE '%降仓%' OR content LIKE '%砍仓%'
        OR content LIKE '%缺口%' OR content LIKE '%突破%' OR content LIKE '%加仓%'
        OR content LIKE '%做T%' OR content LIKE '%风控%' OR content LIKE '%回踩%'
        OR content LIKE '%箱体%' OR content LIKE '%喇叭口%' OR content LIKE '%支撑%'
        OR content LIKE '%阻力%' OR content LIKE '%破位%' OR content LIKE '%底仓%'
        OR content LIKE '%股性%' OR content LIKE '%主力%' OR content LIKE '%洗盘%'
        OR content LIKE '%降息%' OR content LIKE '%加息%' OR content LIKE '%流动性%'
      )
    ORDER BY created_at DESC
  `;
  const allCandidates = db.prepare(candidateQuery).all();
  console.log(`[Batch Distill] 全库检索命中策略特征消息共: ${allCandidates.length} 条`);

  // 过滤已处理项
  const pendingCandidates = force 
    ? allCandidates.slice(0, limit)
    : allCandidates.filter(m => !processedMessageIds.has(m.id)).slice(0, limit);

  console.log(`[Batch Distill] 本批次待蒸馏消息数: ${pendingCandidates.length} 条\n`);

  if (pendingCandidates.length === 0) {
    console.log('🎉 所有命中策略特征的消息均已蒸馏入库，当前无增量待处理单据！');
    return {
      success: true,
      scanned: 0,
      cardsProduced: 0,
      stats: { risk_rule: 0, pattern: 0, macro: 0, asset_memory: 0 }
    };
  }

  // 3. 执行蒸馏提炼与事务批处理
  let totalCardsProduced = 0;
  const cardTypeDistribution = {
    risk_rule: 0,
    pattern: 0,
    macro: 0,
    asset_memory: 0
  };
  const tickerMentions = {};

  const tx = db.transaction((cardsBatch) => {
    for (const card of cardsBatch) {
      saveOntologyCard(card, db);
    }
  });

  const saveBatchWithRetry = async (cardsBatch, maxRetries = 5) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        tx(cardsBatch);
        return;
      } catch (err) {
        const isBusy = err.code === 'SQLITE_BUSY' || (err.message && err.message.includes('locked'));
        if (isBusy && attempt < maxRetries) {
          const waitMs = attempt * 100;
          await new Promise(r => setTimeout(r, waitMs));
        } else {
          throw err;
        }
      }
    }
  };

  let currentBatch = [];
  let processedCount = 0;

  for (const msg of pendingCandidates) {
    processedCount++;
    const meta = {
      id: msg.id,
      message_id: msg.id,
      tickers: parseMessageTickers(msg.tickers)
    };

    const cards = extractCardsHeuristic(msg.content, meta);
    for (const card of cards) {
      totalCardsProduced++;
      cardTypeDistribution[card.card_type] = (cardTypeDistribution[card.card_type] || 0) + 1;
      
      // 标的统计
      if (Array.isArray(card.tickers)) {
        for (const tk of card.tickers) {
          tickerMentions[tk] = (tickerMentions[tk] || 0) + 1;
        }
      }

      currentBatch.push(card);
    }

    if (!dryRun && currentBatch.length >= batchSize) {
      await saveBatchWithRetry(currentBatch);
      currentBatch = [];
      await new Promise(r => setTimeout(r, 20)); // 让出写锁与事件循环
    }
  }

  // 写入剩余批次
  if (!dryRun && currentBatch.length > 0) {
    await saveBatchWithRetry(currentBatch);
    currentBatch = [];
  }

  // 4. 统计与报告
  const sortedTickers = Object.entries(tickerMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log('===========================================================');
  console.log('📊 策略本体卡片知识蒸馏报告 (Distill Summary)');
  console.log('===========================================================');
  console.log(`- 扫描与解析消息: ${processedCount} 条`);
  console.log(`- 提炼生产卡片:   ${totalCardsProduced} 张 ${dryRun ? '(试运行，未落库)' : '(已成功入库 SQLite)'}`);
  console.log('\n四大策略本体卡片分布:');
  console.log(`  🛡️  风控心法 (risk_rule):    ${cardTypeDistribution.risk_rule || 0} 张`);
  console.log(`  📈  形态战法 (pattern):      ${cardTypeDistribution.pattern || 0} 张`);
  console.log(`  🌐  宏观逻辑 (macro):        ${cardTypeDistribution.macro || 0} 张`);
  console.log(`  🎯  标的股性 (asset_memory): ${cardTypeDistribution.asset_memory || 0} 张`);
  if (sortedTickers.length > 0) {
    console.log('\n涉及频次最高标的 Top 10:');
    sortedTickers.forEach(([tk, cnt], i) => {
      console.log(`  ${i + 1}. ${tk}: ${cnt} 次策略关联`);
    });
  }
  console.log('===========================================================\n');

  return {
    success: true,
    scanned: processedCount,
    cardsProduced: totalCardsProduced,
    stats: cardTypeDistribution,
    topTickers: sortedTickers
  };
}

// 支持 CLI 直接执行
const isDirectCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/knowledge/batch_distill_pipeline.js');
if (isDirectCli) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 200) : 200;
  const batchIdx = args.indexOf('--batch-size');
  const batchSize = batchIdx >= 0 ? Math.max(1, parseInt(args[batchIdx + 1], 10) || 50) : 50;

  runBatchDistill({ limit, dryRun, force, batchSize })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ 蒸馏流水线执行失败:', err);
      process.exit(1);
    });
}
