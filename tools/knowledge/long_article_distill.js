#!/usr/bin/env node
/**
 * tools/knowledge/long_article_distill.js
 * [DEBT-019] 早期历史长文本发言细颗粒度重蒸馏引擎
 * 
 * 严格遵循安全红线与合规要求：
 * 1. 纯只读连接读取历史原始发言；
 * 2. 大V身份绝对硬锁（sender_id = 'user_4yeplXgbguTu4'，即 xiaozhaolucky）；
 * 3. 严格针对 2025 年早期长文本（>100 字符），提取深层策略、仓位风控与宏观心法；
 * 4. 幂等生成标准 ontology_card 格式资产。
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
const ZHAO_SENDER_NAME = 'xiaozhaolucky';
const EARLY_END_TS = new Date('2026-01-01T00:00:00Z').getTime();

export function distillEarlyLongArticles(db, options = {}) {
  const { persist = false, minLength = 100 } = options;

  console.log('===========================================================');
  console.log('🧠 [DEBT-019] 早期历史长文本细颗粒度重蒸馏与深层心法提取');
  console.log(`   模式: ${persist ? 'PERSIST (写入数据库)' : 'DRY-RUN (仅提取落盘 JSON)'}`);
  console.log('===========================================================');

  // 1. 查询 2025 年赵哥长文发言
  const messages = db.prepare(`
    SELECT id, channel_id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE sender_id = ?
      AND created_at < ?
      AND length(content) >= ?
    ORDER BY created_at ASC
  `).all(ZHAO_SENDER_ID, EARLY_END_TS, minLength);

  console.log(`📊 命中 2025 年早期长文语料: ${messages.length} 篇 (字符数 >= ${minLength})`);

  const extractedCards = [];

  // 2. 细颗粒度深层策略模式识别库
  for (const msg of messages) {
    const text = String(msg.content || '').trim();
    const dateStr = new Date(msg.created_at).toISOString().slice(0, 10);

    // --- 模式 A: 尾盘强平抢V与开盘回踩买点 (核心时间窗口战法) ---
    if (/尾盘|强平|抢V|3点半|开盘回踩|捡漏/.test(text)) {
      extractedCards.push({
        id: `ocard_early_long_pat_${msg.id}_v`,
        card_type: 'pattern',
        title: `[历史长文复盘] 美股黄金时间窗口战法（开盘回踩捡漏与尾盘强平抢V）`,
        trigger_text: `美股日内关键交易时间窗口：① 开盘回踩回流资金介入点；② 尾盘 15:00~15:45 机构保证金强平V点`,
        action_text: `开盘回踩若不破关键支撑可逢低分批建仓；日内异动逢高减半或止盈；尾盘强平极值区机器抢筹时抓极速V反`,
        theory_text: text.slice(0, 400),
        schema_json: JSON.stringify({
          category: 'time_window_execution',
          time_windows: ['09:30-10:30 ET', '15:00-15:45 ET'],
          core_tactics: ['open_dip_absorption', 'power_hour_margin_squeeze_v']
        }),
        tickers_json: JSON.stringify(['SPY', 'QQQ', 'SOXL', 'TSLL']),
        source_message_ids_json: JSON.stringify([msg.id]),
        provider: 'heuristic_early_longtext_v1',
        created_at: msg.created_at
      });
    }

    // --- 模式 B: 仓位管理二分法与风控铁律 (Risk Rule) ---
    if (/仓位|二分|分批|减半|止损|砍仓|浮亏|回撤|熔断|加仓/.test(text)) {
      extractedCards.push({
        id: `ocard_early_long_risk_${msg.id}`,
        card_type: 'risk_rule',
        title: `[历史长文心法] 仓位二分法与极端行情防踩踏风控铁律`,
        trigger_text: `市场波动剧烈、单边下跌或持仓触及关键风控阀值时`,
        action_text: `坚守仓位纪律，开仓严格分批（如二分法/三分法）；破关键支撑坚决执行减半或止损，绝不与趋势死扛`,
        theory_text: text.slice(0, 400),
        schema_json: JSON.stringify({
          rule_type: 'capital_preservation',
          position_allocation: 'staged_entry_half_rule',
          stop_loss_discipline: 'strict_breakdown_cut'
        }),
        tickers_json: JSON.stringify([]),
        source_message_ids_json: JSON.stringify([msg.id]),
        provider: 'heuristic_early_longtext_v1',
        created_at: msg.created_at
      });
    }

    // --- 模式 C: 宏观流动性推演与财报/关税博弈 (Macro) ---
    if (/流动性|中概|关税|亚太|降息|加息|财报|大选|国债|特朗普|中东/.test(text)) {
      extractedCards.push({
        id: `ocard_early_long_macro_${msg.id}`,
        card_type: 'macro',
        title: `[历史长文研判] 宏观流动性外溢、地缘/关税与财报多空传导`,
        trigger_text: `全球流动性拐点、重磅政策发布、关税声明或大科技财报密集发布期`,
        action_text: `结合全球资金流向（如亚太共振、美元指数、地缘溢价）判定美股大周期阻力与支撑，逆向埋伏预期差`,
        theory_text: text.slice(0, 400),
        schema_json: JSON.stringify({
          macro_domain: 'global_liquidity_transmission',
          impact_channels: ['tariff_policy', 'earnings_iv_crush', 'cross_market_resonance']
        }),
        tickers_json: JSON.stringify(['SPY', 'QQQ']),
        source_message_ids_json: JSON.stringify([msg.id]),
        provider: 'heuristic_early_longtext_v1',
        created_at: msg.created_at
      });
    }

    // --- 模式 D: 标的专属波段点位与长线埋伏战法 (Asset Memory / Pattern with Levels) ---
    const tickerMatch = text.match(/\b(TSLA|TSLL|NVDA|NVDL|QQQ|SPY|IREN|CRWV|LITE|COHR|MU|DRAM|AMD|PLTR|SMCI|RDDT)\b/i);
    const priceMatch = text.match(/(?:支撑|阻力|买入|跌到|现价|最低价|跳到|看到|目标)[^\d$]{0,8}\$?(\d{1,4}(?:\.\d{1,2})?)/i) ||
                       text.match(/\$(\d{1,4}(?:\.\d{1,2})?)/);

    if (tickerMatch && priceMatch) {
      const ticker = tickerMatch[1].toUpperCase();
      const level = parseFloat(priceMatch[1]);
      if (level > 0.5 && level < 5000) {
        extractedCards.push({
          id: `ocard_early_long_level_${msg.id}_${ticker}`,
          card_type: 'pattern',
          title: `[历史长文埋伏] ${ticker} 波段关键点位与战略建仓区间`,
          trigger_text: `${ticker} 触及历史战略建仓位 $${level}，或出现长线跳空缺口企稳特征`,
          action_text: `在 $${level} 附近耐心分批低吸长拿，做好底仓配置，结合日线级别底背离进场`,
          theory_text: text.slice(0, 400),
          schema_json: JSON.stringify({
            ticker,
            support_resistance: {
              support: [level],
              resistance: []
            },
            entry_style: 'strategic_dip_accumulation'
          }),
          tickers_json: JSON.stringify([ticker]),
          source_message_ids_json: JSON.stringify([msg.id]),
          provider: 'heuristic_early_longtext_v1',
          created_at: msg.created_at
        });
      }
    }
  }

  // 去重 (以 ID 为准)
  const uniqueCardsMap = new Map();
  for (const c of extractedCards) {
    if (!uniqueCardsMap.has(c.id)) {
      uniqueCardsMap.set(c.id, c);
    }
  }
  const uniqueCards = Array.from(uniqueCardsMap.values());

  console.log(`🎯 成功重蒸馏出高质量本体知识卡片: ${uniqueCards.length} 张`);

  // 输出到 runtime json
  const outDir = path.resolve('data/runtime');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'early_long_article_cards.json');
  fs.writeFileSync(outPath, JSON.stringify(uniqueCards, null, 2), 'utf8');
  console.log(`📁 提纯知识卡片已落盘至: ${outPath}`);

  let persistedCount = 0;
  let skippedCount = 0;

  if (persist) {
    const insertCard = db.prepare(`
      INSERT OR IGNORE INTO ontology_card (
        id, card_type, title, trigger_text, action_text, theory_text,
        schema_json, tickers_json, source_message_ids_json, provider, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    db.transaction(() => {
      for (const card of uniqueCards) {
        const res = insertCard.run(
          card.id,
          card.card_type,
          card.title,
          card.trigger_text,
          card.action_text,
          card.theory_text,
          card.schema_json,
          card.tickers_json,
          card.source_message_ids_json,
          card.provider,
          'approved',
          card.created_at || now,
          now
        );
        if (res.changes > 0) persistedCount++;
        else skippedCount++;
      }
    })();

    console.log(`✅ 本地 ontology_card 落库成功: 新增 ${persistedCount} 张, 幂等跳过 ${skippedCount} 张`);
  }

  const finalCardCount = db.prepare('SELECT count(*) as c FROM ontology_card').get().c;
  console.log(`📊 ontology_card 表当前总卡片数: ${finalCardCount} 张\n`);

  return {
    ok: true,
    processed_messages_count: messages.length,
    extracted_cards_count: uniqueCards.length,
    persisted_count: persistedCount,
    skipped_count: skippedCount,
    final_card_count: finalCardCount,
    cards: uniqueCards
  };
}

if (process.argv[1] && process.argv[1].endsWith('long_article_distill.js')) {
  const args = process.argv.slice(2);
  const persist = args.includes('--persist');
  const dbPath = process.env.SQLITE_PATH || (fs.existsSync('whop_archive.db') ? 'whop_archive.db' : 'data/whop_bridge.db');
  const db = new Database(dbPath, { readonly: !persist });
  distillEarlyLongArticles(db, { persist });
  db.close();
}
