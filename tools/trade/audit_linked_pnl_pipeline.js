#!/usr/bin/env node
/**
 * tools/trade/audit_linked_pnl_pipeline.js
 * [REQ-054 / DEBT-021] 交易单人工审核增量联动流水线与利润重算引擎
 * 
 * 核心设计原则：
 * 1. 【人工审核权威覆盖 (Audit Priority Override)】：
 *    - 优先采信 follow_replay_queue 中 status='corrected' 的人工纠正数据；
 *    - 严格排除 status='confirmed_skip' 与 'classified_strategy'，防止脏讨论污染流水；
 * 2. 【动态 FIFO 配对与胜率重算】：
 *    - 分别统计「全量机器粗测」与「人工纠偏优先」两套账本，直观揭示人工审核带来的精度增益；
 * 3. 【SLM 黄金反馈飞轮 (REQ-036 联动)】：
 *    - 将人工修正的买卖方向、点位提取错误转换为标准问答对，沉淀至 slm_audit_golden_pairs.json。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const DB_PATH = path.join(ROOT_DIR, 'whop_archive.db');

export const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
export const ZHAO_SENDER_NAME = 'xiaozhaolucky';
export const EXCLUSIVE_CHANNELS = [
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS'
];

/**
 * 执行人工审核增量联动分析与利润重算
 */
export function runAuditLinkedPnLPipeline(options = {}) {
  const db = options.db || new Database(DB_PATH, { readonly: !options.apply });
  const apply = !!options.apply;

  // 1. 扫描 follow_replay_queue 中的审核进度
  const queueRows = db.prepare(`
    SELECT id, pool_id, message_id, raw_content, parsed_ticker, parsed_action,
           parsed_price, parsed_qty, status, corrected_json, reviewed_at, seq_no, created_at
    FROM follow_replay_queue
    ORDER BY seq_no ASC
  `).all();

  const auditStats = {
    total_queue: queueRows.length,
    pending: 0,
    confirmed_skip: 0,
    corrected: 0,
    classified_strategy: 0
  };

  const auditMapByMsgId = new Map();
  for (const row of queueRows) {
    if (auditStats[row.status] !== undefined) {
      auditStats[row.status]++;
    }
    if (row.message_id) {
      auditMapByMsgId.set(row.message_id, row);
    }
  }

  const auditProgressPct = auditStats.total_queue > 0
    ? (((auditStats.confirmed_skip + auditStats.corrected + auditStats.classified_strategy) / auditStats.total_queue) * 100).toFixed(2)
    : '0.00';

  // 2. 提取专属频道的原始大V消息并融合审核数据
  const placeholders = EXCLUSIVE_CHANNELS.map(() => '?').join(',');
  const messages = db.prepare(`
    SELECT id, channel_id, sender_id, sender_name, content, created_at
    FROM messages
    WHERE channel_id IN (${placeholders})
      AND sender_id = ?
    ORDER BY created_at ASC
  `).all(...EXCLUSIVE_CHANNELS, ZHAO_SENDER_ID);

  const BUY_REGEX = /(?:买入|开仓|加仓|建仓|低吸|做多|追|抄底|买点|入场|买call|买put|开call|开put|上了|上车|干了|打了|买了|加了|接了|打底|试仓|小仓位)/i;
  const SELL_REGEX = /(?:卖出|平仓|减仓|止盈|止损|砍仓|走人|清仓|落袋|出掉|割肉|出call|出put|收米|获利|离场|分批走|保本|卖了|走了|清了|出了|减了|止了|跑了|止血|出本|翻倍出)/i;

  const TICKER_MAP = [
    [/TSLL|特斯拉两倍|特斯拉双倍/i, 'TSLL'],
    [/TSLA|特斯拉/i, 'TSLA'],
    [/NVDL|英伟达两倍|英伟达双倍/i, 'NVDL'],
    [/NVDA|英伟达/i, 'NVDA'],
    [/SOXL|半导体三倍|半导体/i, 'SOXL'],
    [/QQQ|纳指/i, 'QQQ'],
    [/SPY|标普/i, 'SPY'],
    [/IREN/i, 'IREN'],
    [/NBIS/i, 'NBIS'],
    [/CRWV/i, 'CRWV'],
    [/LITE/i, 'LITE'],
    [/COHR/i, 'COHR'],
    [/MU|美光/i, 'MU'],
    [/AMD/i, 'AMD'],
    [/PLTR/i, 'PLTR'],
    [/SMCI|超微/i, 'SMCI'],
    [/ARM/i, 'ARM'],
    [/AVGO|博通/i, 'AVGO'],
    [/MSTR|微策/i, 'MSTR'],
    [/CONL|COIN|coinbase|币安/i, 'CONL'],
    [/AAPL|苹果/i, 'AAPL'],
    [/AMZN|亚马逊/i, 'AMZN'],
    [/MSFT|微软/i, 'MSFT'],
    [/META/i, 'META'],
    [/GOOGL|谷歌/i, 'GOOGL'],
    [/MARA/i, 'MARA'],
    [/INTC|英特尔/i, 'INTC'],
    [/RDDT/i, 'RDDT'],
    [/MSFL/i, 'MSFL'],
    [/WDC/i, 'WDC'],
    [/OKLO/i, 'OKLO']
  ];
  const PRICE_REGEX = /(?:\$|@|\bat\b|\b价格\b|\b现价\b|\b成本\b)?\s*(\d{1,4}(?:\.\d{1,2})?)/i;

  const fusedSignals = [];
  const slmGoldenPairs = [];

  for (const msg of messages) {
    const text = String(msg.content || '');
    const auditRecord = auditMapByMsgId.get(msg.id);

    // 若被人工跳过或分类为非具体交易讨论，则剔除
    if (auditRecord && (auditRecord.status === 'confirmed_skip' || auditRecord.status === 'classified_strategy')) {
      slmGoldenPairs.push({
        type: 'negative_filtering',
        raw_text: text,
        expected: 'NON_TRADE_DISCUSSION',
        note: `人工审核判定为无需跟单/讨论发言: status=${auditRecord.status}`
      });
      continue;
    }

    let ticker = null;
    let action = null;
    let price = null;
    let quantity = 100;
    let sourceTier = 'machine_raw';

    if (auditRecord && auditRecord.status === 'corrected' && auditRecord.corrected_json) {
      try {
        const c = JSON.parse(auditRecord.corrected_json);
        const cor = c.corrected || {};
        ticker = (cor.ticker || auditRecord.parsed_ticker || '').toUpperCase();
        action = (cor.action || auditRecord.parsed_action || '').toUpperCase();
        price = parseFloat(cor.price !== undefined ? cor.price : auditRecord.parsed_price) || 0;
        quantity = parseInt(cor.quantity !== undefined ? cor.quantity : auditRecord.parsed_qty, 10) || 100;
        sourceTier = 'human_verified';

        // 沉淀至 SLM 问答对
        slmGoldenPairs.push({
          type: 'correction_learning',
          raw_text: text,
          machine_parsed: {
            ticker: auditRecord.parsed_ticker,
            action: auditRecord.parsed_action,
            price: auditRecord.parsed_price
          },
          human_ground_truth: {
            ticker,
            action,
            price,
            quantity
          },
          correction_reason: `机器误判，人工纠偏为 ${action} ${ticker} @ $${price}`
        });
      } catch (_) {}
    }

    // 若无人工纠错，按规则解析
    if (!ticker || !action) {
      const isBuy = BUY_REGEX.test(text);
      const isSell = SELL_REGEX.test(text);
      if (!isBuy && !isSell) continue;

      for (const [re, sym] of TICKER_MAP) {
        if (re.test(text)) {
          ticker = sym;
          break;
        }
      }
      if (!ticker) continue;

      action = isBuy && !isSell ? 'BUY' : isSell && !isBuy ? 'SELL' : (text.indexOf('买') < text.indexOf('卖') ? 'BUY' : 'SELL');

      const priceMatch = text.match(/\$(\d{1,4}(?:\.\d{1,2})?)/) || text.match(PRICE_REGEX);
      if (priceMatch) {
        const p = parseFloat(priceMatch[1]);
        if (Number.isFinite(p) && p > 0.1 && p < 10000) {
          price = p;
        }
      }
    }

    fusedSignals.push({
      message_id: msg.id,
      channel_id: msg.channel_id,
      created_at: msg.created_at,
      ticker,
      action,
      price: price || 0,
      quantity,
      source_tier: sourceTier,
      raw_content: text.slice(0, 120).replace(/[\r\n]+/g, ' ')
    });
  }

  // 3. FIFO 闭环配对与盈亏统计
  const openPositions = {};
  const closedPairs = [];

  for (const sig of fusedSignals) {
    const t = sig.ticker;
    if (!openPositions[t]) openPositions[t] = [];
    if (sig.action === 'BUY') {
      openPositions[t].push(sig);
    } else if (sig.action === 'SELL') {
      if (openPositions[t].length > 0) {
        const buy = openPositions[t].shift();
        const pnlPct = (buy.price > 0 && sig.price > 0)
          ? ((sig.price - buy.price) / buy.price) * 100
          : null;
        const holdHours = (sig.created_at - buy.created_at) / (1000 * 3600);
        const hasHumanAudit = buy.source_tier === 'human_verified' || sig.source_tier === 'human_verified';

        closedPairs.push({
          ticker: t,
          buy,
          sell: sig,
          pnl_pct: pnlPct,
          is_win: pnlPct !== null ? pnlPct > 0 : null,
          hold_hours: holdHours,
          has_human_audit: hasHumanAudit
        });
      }
    }
  }

  // 4. 统计计算
  const scoredPairs = closedPairs.filter(p => p.pnl_pct !== null);
  const winPairs = scoredPairs.filter(p => p.is_win);
  const lossPairs = scoredPairs.filter(p => !p.is_win);

  const totalWinAmount = winPairs.reduce((acc, p) => acc + p.pnl_pct, 0);
  const totalLossAmount = Math.abs(lossPairs.reduce((acc, p) => acc + p.pnl_pct, 0));
  const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount) : (totalWinAmount > 0 ? 99.9 : 0);

  const overallWinRate = scoredPairs.length > 0
    ? (winPairs.length / scoredPairs.length)
    : 0;

  // 人工已审核高精子集
  const auditedPairs = scoredPairs.filter(p => p.has_human_audit);
  const auditedWins = auditedPairs.filter(p => p.is_win);
  const auditedWinRate = auditedPairs.length > 0
    ? (auditedWins.length / auditedPairs.length)
    : 0;

  // 5. 若启用 apply，将已纠偏信号同步刷新至 trade_signals
  let syncedSignalsCount = 0;
  if (apply) {
    const upsertStmt = db.prepare(`
      INSERT INTO trade_signals (
        signal_id, message_id, channel_id, speaker_id, speaker_name,
        ticker, action, price, quantity, stop_loss, reason, parse_status, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signal_id) DO UPDATE SET
        ticker = excluded.ticker,
        action = excluded.action,
        price = excluded.price,
        quantity = excluded.quantity,
        source = excluded.source,
        reason = excluded.reason
    `);

    db.transaction(() => {
      for (const sig of fusedSignals) {
        if (sig.source_tier === 'human_verified') {
          const sigId = `sig_audit_${sig.ticker}_${sig.created_at}_${sig.action}`;
          upsertStmt.run(
            sigId,
            sig.message_id,
            sig.channel_id,
            ZHAO_SENDER_ID,
            ZHAO_SENDER_NAME,
            sig.ticker,
            sig.action,
            sig.price,
            sig.quantity,
            null,
            `[人工审核纠偏权威单] ${sig.raw_content}`,
            'ok',
            'manual_correct_verified',
            sig.created_at
          );
          syncedSignalsCount++;
        }
      }
    })();
  }

  const result = {
    generated_at: new Date().toISOString(),
    audit_progress: {
      ...auditStats,
      audit_progress_pct: `${auditProgressPct}%`
    },
    signal_summary: {
      total_fused_signals: fusedSignals.length,
      human_verified_signals: fusedSignals.filter(s => s.source_tier === 'human_verified').length,
      machine_raw_signals: fusedSignals.filter(s => s.source_tier === 'machine_raw').length,
      total_closed_pairs: closedPairs.length,
      scored_pairs_count: scoredPairs.length
    },
    performance_metrics: {
      overall_win_rate_pct: (overallWinRate * 100).toFixed(2),
      profit_factor: profitFactor.toFixed(2),
      audited_subset_count: auditedPairs.length,
      audited_win_rate_pct: (auditedWinRate * 100).toFixed(2),
      avg_hold_hours: scoredPairs.length > 0
        ? (scoredPairs.reduce((acc, p) => acc + p.hold_hours, 0) / scoredPairs.length).toFixed(1)
        : '0.0'
    },
    slm_feedback_pairs_count: slmGoldenPairs.length,
    apply_synced_count: syncedSignalsCount
  };

  // 产物落盘
  const RUNTIME_DIR = path.join(ROOT_DIR, 'data/runtime');
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  const summaryPath = path.join(RUNTIME_DIR, 'audit_linked_pnl_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2), 'utf-8');

  const slmPath = path.join(RUNTIME_DIR, 'slm_audit_golden_pairs.json');
  fs.writeFileSync(slmPath, JSON.stringify(slmGoldenPairs, null, 2), 'utf-8');

  return {
    summary: result,
    closedPairs,
    slmGoldenPairs
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const apply = process.argv.includes('--apply');
  const res = runAuditLinkedPnLPipeline({ apply });
  console.log('===========================================================');
  console.log('📊 [REQ-054 / DEBT-021] 审核联动与胜率重算完成');
  console.log(`   人工审核进度: ${res.summary.audit_progress.audit_progress_pct} (${res.summary.audit_progress.confirmed_skip + res.summary.audit_progress.corrected + res.summary.audit_progress.classified_strategy}/${res.summary.audit_progress.total_queue})`);
  console.log(`   人工纠偏有效信号: ${res.summary.signal_summary.human_verified_signals} 笔`);
  console.log(`   闭环配对总数: ${res.summary.signal_summary.total_closed_pairs} 对 (可计分: ${res.summary.signal_summary.scored_pairs_count})`);
  console.log(`   总体胜率: ${res.summary.performance_metrics.overall_win_rate_pct}% | 盈亏比: ${res.summary.performance_metrics.profit_factor}`);
  console.log(`   已审核样本子集胜率: ${res.summary.performance_metrics.audited_win_rate_pct}% (N=${res.summary.performance_metrics.audited_subset_count})`);
  console.log(`   SLM 反馈黄金语料: ${res.summary.slm_feedback_pairs_count} 组已沉淀至 slm_audit_golden_pairs.json`);
  if (apply) {
    console.log(`   已同步入库权威信号: ${res.summary.apply_synced_count} 笔`);
  }
  console.log('===========================================================');
}
