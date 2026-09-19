/**
 * tools/knowledge/multimodal_context_aligner.js
 * CHG-029 / REQ-038 — 多模态真图与上下文流式对齐处理器 (Streaming Aligner)
 *
 * 核心职责:
 * 1. 践行 Top 级流式解耦原则 (CHG-029): 不必等全部真图批跑完毕，已提取的 OK 真图即刻流转;
 * 2. 状态机标记防漏: 扫描 message_vision_meta 中 status='ok' 的真图，与 messages 表对齐;
 * 3. 产出高质量多模态战法卡片 (provider='multimodal_vl')，沉淀至 ontology_card;
 * 4. 为 T2 胜率归因与 T3 共振雷达提供精准的视觉点位与形态学支撑。
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDb, ensureOntologyCardTable } from '../../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');

/**
 * 严格白名单脱敏 (剥离买卖指令)
 */
export function stripTradingDirectives(str) {
  if (!str) return '';
  return String(str)
    .replace(/\b(BUY|STRONG_BUY|SELL|STRONG_SELL)\b/gi, '[FILTERED]')
    .replace(/(建议买入|建议卖出|立即做多|立即做空|开仓做多|开仓做空|无脑多|无脑空|做多|做空|买入|卖出)+/g, '[建议已过滤]')
    .trim();
}

export const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';

/**
 * 点位带内校验 (过滤期权毛刺与非标的噪点)
 */
export function filterInBandSR(sr, ticker) {
  if (!sr || typeof sr !== 'object') return { support: [], resistance: [] };
  const sym = String(ticker || '').trim().toUpperCase();
  const lo = sym === 'TSLL' ? 1 : 50;
  const hi = sym === 'TSLL' ? 200 : 900;
  
  const filterList = (list) => {
    if (!Array.isArray(list)) return [];
    return list.map(Number).filter((n) => Number.isFinite(n) && (sym ? (n >= lo && n <= hi) : true));
  };

  return {
    support: filterList(sr.support),
    resistance: filterList(sr.resistance),
  };
}

/**
 * 流式对齐执行器
 */
export function alignMultimodalCards(options = {}) {
  const {
    dbInstance = getDb(),
    dryRun = false,
    limit = 1000,
    forceAllSenders = false,
  } = options;

  ensureOntologyCardTable(dbInstance);

  // 1. 查询所有已提取成功的真实多模态元数据 (AGENTS §6.9 硬锁赵哥 sender_id)
  const senderClause = forceAllSenders ? "" : "AND m.sender_id = 'user_4yeplXgbguTu4'";
  const visionRows = dbInstance.prepare(`
    SELECT 
      v.id as vision_id,
      v.message_id,
      v.attach_index,
      v.ticker,
      v.timeframe,
      v.patterns_json,
      v.support_resistance_json,
      v.hand_drawn_annotation,
      v.local_path,
      v.created_at as vision_created_at,
      m.content as msg_content,
      m.created_at as msg_created_at,
      m.sender_name,
      m.sender_id
    FROM message_vision_meta v
    LEFT JOIN messages m ON v.message_id = m.id
    WHERE v.status = 'ok' AND v.provider != 'stub' ${senderClause}
    ORDER BY v.updated_at ASC
  `).all();

  console.log(`[Aligner] 🔍 发现已就绪的真实多模态元数据: ${visionRows.length} 条`);

  // 2. 检查 ontology_card 已有的多模态卡片 (防漏去重)
  const existingCardIds = new Set(
    dbInstance.prepare(`SELECT id FROM ontology_card WHERE provider = 'multimodal_vl'`)
      .all()
      .map((r) => r.id)
  );

  const pending = visionRows.filter((r) => !existingCardIds.has(`card_mm_${r.vision_id}`));
  console.log(`[Aligner] ⏳ 待增量对齐卡片: ${pending.length} 条 (已对齐: ${existingCardIds.size})`);

  const toProcess = pending.slice(0, limit);
  const results = {
    total_ready: visionRows.length,
    already_aligned: existingCardIds.size,
    pending_count: pending.length,
    aligned_count: 0,
    tickers_covered: new Set(),
    levels_extracted: 0,
    items: [],
  };

  if (dryRun) {
    console.log('[Aligner] 💡 dry-run 模式，跳过卡片实际写入');
    return results;
  }

  const insertCardStmt = dbInstance.prepare(`
    INSERT OR REPLACE INTO ontology_card (
      id,
      card_type,
      title,
      trigger_text,
      action_text,
      theory_text,
      tickers_json,
      source_cu_id,
      source_message_ids_json,
      provider,
      status,
      schema_json,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @card_type,
      @title,
      @trigger_text,
      @action_text,
      @theory_text,
      @tickers_json,
      @source_cu_id,
      @source_message_ids_json,
      @provider,
      @status,
      @schema_json,
      @created_at,
      @updated_at
    )
  `);

  const tx = dbInstance.transaction(() => {
    for (const item of toProcess) {
      const cardId = `card_mm_${item.vision_id}`;
      const ticker = item.ticker ? item.ticker.trim().toUpperCase() : null;
      if (ticker) results.tickers_covered.add(ticker);

      // 解析 patterns
      let patterns = [];
      try {
        patterns = JSON.parse(item.patterns_json || '[]');
      } catch (_) {}

      // 解析 support_resistance 并应用带内清洗
      let rawSr = { support: [], resistance: [] };
      try {
        rawSr = JSON.parse(item.support_resistance_json || '{"support":[],"resistance":[]}');
      } catch (_) {}
      const sr = filterInBandSR(rawSr, ticker);

      const hasLevels = (sr.support && sr.support.length > 0) || (sr.resistance && sr.resistance.length > 0);
      if (hasLevels) {
        results.levels_extracted += (sr.support?.length || 0) + (sr.resistance?.length || 0);
      }

      // 组装标题与类型
      const cardType = hasLevels ? 'level' : (patterns.length > 0 ? 'pattern' : 'market_structure');
      const patternSummary = patterns.length > 0 ? patterns.join('/') : (hasLevels ? '关键点位结构' : '图表形态观察');
      const title = `[多模态] ${ticker || '大盘/观察'} ${patternSummary}`;

      // 触发逻辑描述
      let triggerParts = [];
      if (sr.support && sr.support.length) triggerParts.push(`支撑位: ${sr.support.join(', ')}`);
      if (sr.resistance && sr.resistance.length) triggerParts.push(`阻力位: ${sr.resistance.join(', ')}`);
      if (item.hand_drawn_annotation) triggerParts.push(`手绘批注: ${stripTradingDirectives(item.hand_drawn_annotation)}`);
      const triggerText = triggerParts.join(' | ') || '图表结构观察';

      // 动作/战法描述 (严格去交易化)
      const actionText = stripTradingDirectives(
        `重点跟踪 ${ticker || '标的'} ${patternSummary}。关注关键支撑与阻力区间反应，做好仓位与风险管理。`
      );

      // 理论正文 (结合大V原始发言)
      const cleanMsg = stripTradingDirectives(
        (item.msg_content || '').replace(/\[IMAGE:[^\]]+\]/g, '[K线图表]').trim()
      );
      const theoryText = cleanMsg || `赵哥于 ${item.msg_created_at ? new Date(item.msg_created_at).toISOString() : '盘中'} 分享的实战图表分析。`;

      const schemaObj = {
        vision_id: item.vision_id,
        local_path: item.local_path,
        ticker,
        timeframe: item.timeframe,
        patterns,
        support_resistance: sr,
        support_resistance_json: JSON.stringify(sr),
        hand_drawn_annotation: item.hand_drawn_annotation,
        sender_id: item.sender_id,
        sender_name: item.sender_name,
        aligned_from: 'message_vision_meta',
      };

      const now = Date.now();
      const cardPayload = {
        id: cardId,
        card_type: cardType,
        title,
        trigger_text: triggerText,
        action_text: actionText,
        theory_text: theoryText,
        tickers_json: JSON.stringify(ticker ? [ticker] : []),
        source_cu_id: null,
        source_message_ids_json: JSON.stringify([item.message_id]),
        provider: 'multimodal_vl',
        status: 'active',
        schema_json: JSON.stringify(schemaObj),
        created_at: item.msg_created_at || item.vision_created_at || now,
        updated_at: now,
      };

      insertCardStmt.run(cardPayload);
      results.aligned_count++;
      results.items.push({
        id: cardId,
        ticker,
        type: cardType,
        hasLevels,
      });
    }
  });

  tx();
  results.tickers_covered = Array.from(results.tickers_covered);
  return results;
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let limit = 1000;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10) || 1000;
  }

  console.log('===========================================================');
  console.log('🔄 [CHG-029] 多模态真图与上下文流式增量对齐流水线');
  console.log('===========================================================');

  const res = alignMultimodalCards({ dryRun, limit });
  console.log('--- 对齐完成报告 ---');
  console.log(JSON.stringify(res, null, 2));
}
