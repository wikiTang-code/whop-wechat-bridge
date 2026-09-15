/**
 * follow-replay-engine.js - 历史大V交易单回放校验与移动端纠错反馈引擎 (REQ-033)
 * 
 * 核心流程：
 * 1. 抽取特朗普访华（2026-05-15）至今所有赵哥交易单，建立持久化回放队列表 follow_replay_queue；
 * 2. 步进式推送：每次仅推送当前队头单据至企业微信群；
 * 3. 两种交互反馈路径：
 *    - 路径 A: 微信内点击一键确认跳过 -> 记录 confirmed_skip -> 自动推送下一条；
 *    - 路径 B: 微信内点击修正 -> 唤起移动端极简表单 -> 修改基础要素提交 -> 纠正入库 -> 自动推送下一条。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import { extractSemanticPrice, extractSemanticAction } from './price_extractor.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.TUNNEL_URL) return process.env.TUNNEL_URL;
  try {
    const tunnelFile = path.join(__dirname, 'data', 'tunnel_url.txt');
    if (fs.existsSync(tunnelFile)) {
      const u = fs.readFileSync(tunnelFile, 'utf8').trim();
      if (u.startsWith('http')) return u;
    }
  } catch (_) {}
  return `http://${process.env.HOST_IP || '192.168.1.18'}:${process.env.PORT || 8085}`;
}
const REPLAY_SECRET = process.env.WECOM_HITL_SECRET || 'follow_replay_secret_key_2026';
const TRUMP_VISIT_START_TS = 1778803200000; // 2026-05-15 00:00:00 UTC

/**
 * 初始化回放数据库表结构
 */
export function initReplayTable(db = getDb()) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS follow_replay_queue (
      id TEXT PRIMARY KEY,
      pool_id TEXT,
      message_id TEXT,
      created_at INTEGER NOT NULL,
      raw_content TEXT NOT NULL,
      parsed_ticker TEXT NOT NULL,
      parsed_action TEXT NOT NULL,
      parsed_price REAL NOT NULL,
      parsed_qty INTEGER NOT NULL,
      fraction_desc TEXT,
      fraction_ratio REAL,
      before_qty INTEGER DEFAULT 0,
      before_avg_cost REAL DEFAULT 0,
      after_qty INTEGER DEFAULT 0,
      after_avg_cost REAL DEFAULT 0,
      user_qty INTEGER DEFAULT 0,
      user_avg_cost REAL DEFAULT 0,
      zhao_before_pct REAL DEFAULT 0,
      zhao_after_pct REAL DEFAULT 0,
      zhao_total_exp_pct REAL DEFAULT 0,
      user_ticker_pct REAL DEFAULT 0,
      user_total_exp_pct REAL DEFAULT 0,
      source_lot_price REAL DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      corrected_json TEXT,
      reviewed_at INTEGER,
      seq_no INTEGER
    )
  `).run();

  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN fraction_desc TEXT").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN fraction_ratio REAL").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN before_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN before_avg_cost REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN after_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN after_avg_cost REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_qty INTEGER DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_avg_cost REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN zhao_before_pct REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN zhao_after_pct REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN zhao_total_exp_pct REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_ticker_pct REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN user_total_exp_pct REAL DEFAULT 0").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE follow_replay_queue ADD COLUMN source_lot_price REAL DEFAULT NULL").run(); } catch (_) {}

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_replay_status ON follow_replay_queue(status, seq_no ASC)
  `).run();

  // 大V策略与条件单资产库 (REQ-033: 将非即时交易单的分析/预判/计划沉淀为永久资产)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS strategy_assets (
      id TEXT PRIMARY KEY,
      replay_id TEXT,
      message_id TEXT,
      ticker TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      plan_type TEXT DEFAULT 'condition_plan',
      trigger_condition TEXT,
      created_at INTEGER NOT NULL,
      saved_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    )
  `).run();
}

/**
 * 生成回放单操作签名 Token
 */
export function generateReplayToken(id, ticker, action) {
  const payload = `replay|${id}|${ticker}|${action}|${REPLAY_SECRET}`;
  return crypto.createHmac('sha256', REPLAY_SECRET).update(payload).digest('hex').substring(0, 24);
}

/**
 * 校验签名 Token
 */
export function verifyReplayToken(id, ticker, action, token) {
  if (!token) return false;
  const expected = generateReplayToken(id, ticker, action);
  return token === expected;
}

/**
 * 提炼仓位多维度描述（区分 BUY 的资金常规仓维度 与 SELL 的特定批次/标的持仓维度）
 */
export function formatFractionDesc(fractionName, fractionRatio, rawContent, action = 'BUY', sourceLotPrice = null) {
  const raw = rawContent || '';
  const isSell = (action || '').toUpperCase() === 'SELL';

  if (isSell) {
    const lotPrefix = sourceLotPrice ? `前序 $${sourceLotPrice} 批次` : '该标的在持';
    if (raw.includes('出剩下一半') || raw.includes('剩下一半') || raw.includes('出剩下')) {
      return `出清剩余持仓 (清空${lotPrefix}剩余全部份额)`;
    }
    if (raw.includes('清仓') || raw.includes('出完') || raw.includes('全出') || raw.includes('平仓') || raw.includes('先出完')) {
      return `全部清仓 (100% 清空${lotPrefix})`;
    }
    if (/(出|卖|减|平).*一半/i.test(raw) || raw.includes('减半') || raw.includes('半仓') || raw.includes('0.5')) {
      return `减持 1/2 份额 (卖出${lotPrefix}的 50%)`;
    }
    if (raw.includes('三分之一') || raw.includes('1/3')) {
      return `减持 1/3 份额 (卖出${lotPrefix}的 33%)`;
    }
    if (sourceLotPrice) {
      return `出清批次 (清空${lotPrefix})`;
    }
    return '常规平仓/减持 (未明确比例)';
  }

  // BUY 侧：针对资金维度与常规仓维度的表述
  if (raw.includes('常规仓的一半') || raw.includes('一半常规仓') || raw.includes('一半做日内')) {
    return '0.5 笔常规仓 (约占总资金 5.0%)';
  }
  if (raw.includes('三分之一常规仓') || raw.includes('1/3常规仓') || raw.includes('1/3 常规仓') || raw.includes('三分之常规仓')) {
    return '1/3 笔常规仓 (约占总资金 3.3%)';
  }
  if (raw.includes('常规仓') && !raw.includes('一半') && !raw.includes('三分之一')) {
    return '1 笔标准常规仓 (约占总资金 10.0%)';
  }
  // 清洗 fractionName，去除所有历史拼接的 "(约占总资金...)" 括号及冗余空白
  const cleanName = (fractionName || '')
    .replace(/\(约占总资金\s*[\d.]*%\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (fractionRatio) {
    const pct = (fractionRatio * 10).toFixed(1);
    return cleanName ? `${cleanName} (约占总资金 ${pct}%)` : `(约占总资金 ${pct}%)`;
  }
  if (cleanName) {
    return cleanName;
  }
  return '常规建仓 (未明确比例)';
}

/**
 * 从 trade_review_pool 初始化加载待回放单据
 */
export function loadReplayCandidates(db = getDb(), startTs = TRUMP_VISIT_START_TS, forceReload = false) {
  initReplayTable(db);

  if (forceReload) {
    db.prepare("DELETE FROM follow_replay_queue").run();
  } else {
    const existingCount = db.prepare("SELECT count(*) as c FROM follow_replay_queue").get().c;
    if (existingCount > 0) {
      return existingCount;
    }
  }

  // 抓取 2026-05-15 至今的池记录
  const candidates = db.prepare(`
    SELECT id, message_id, ticker, action, price, fraction_name, fraction_ratio, before_qty, before_avg_cost, after_qty, after_avg_cost, raw_content, created_at
    FROM trade_review_pool
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(startTs);

  console.log(`[Follow Replay] 从历史记录中提取到 ${candidates.length} 条待回放校验单据...`);

  const insertStmt = db.prepare(`
    INSERT INTO follow_replay_queue 
      (id, pool_id, message_id, created_at, raw_content, parsed_ticker, parsed_action, parsed_price, parsed_qty, fraction_desc, fraction_ratio, before_qty, before_avg_cost, after_qty, after_avg_cost, zhao_before_pct, zhao_after_pct, zhao_total_exp_pct, user_qty, user_avg_cost, user_ticker_pct, user_total_exp_pct, source_lot_price, status, seq_no)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  // 从 2026-05-15 起零基线以【批次 Lot 为整体】推演赵哥账本
  const zhaoSimLots = {}; // ticker -> [ { seqNo, qty, price } ]

  const runBatch = db.transaction((rows) => {
    let seq = 1;
    for (const r of rows) {
      const replayId = `rpl_${r.id}`;
      const tickerClean = (r.ticker || '').toUpperCase();
      const action = (r.action || 'BUY').toUpperCase();
      const { price: extractedPrice, sourceLotPrice } = extractSemanticPrice(r.raw_content, tickerClean, action);
      const price = extractedPrice !== null ? extractedPrice : null;
      if (price === null) {
        console.warn('[Follow Replay] price not extracted, skip', r.id, r.message_id);
        continue;
      }

      // 赵哥变动前持仓 (从 0 开始以【批次 Lot 为整体】链式推演)
      if (!zhaoSimLots[tickerClean]) zhaoSimLots[tickerClean] = [];
      const lots = zhaoSimLots[tickerClean];
      const beforeQty = lots.reduce((sum, l) => sum + l.qty, 0);
      const beforeTotalCost = lots.reduce((sum, l) => sum + l.qty * l.price, 0);
      const beforeAvgCost = beforeQty > 0 ? Number((beforeTotalCost / beforeQty).toFixed(2)) : 0;

      // 仓位表述提炼
      const fractionDesc = formatFractionDesc(r.fraction_name, r.fraction_ratio, r.raw_content);

      // 计算本单目标比例 (标准常规仓按 10% 算，0.5 笔常规仓按 5%)
      let targetFractionPct = 0.05;
      const raw = r.raw_content || '';
      if (raw.includes('常规仓的一半') || raw.includes('一半常规仓') || raw.includes('一半做日内')) {
        targetFractionPct = 0.05;
      } else if (raw.includes('三分之一') || raw.includes('1/3')) {
        targetFractionPct = 0.0333;
      } else if (raw.includes('半仓') || raw.includes('出一半')) {
        targetFractionPct = 0.05;
      } else if (r.fraction_ratio) {
        targetFractionPct = r.fraction_ratio * 0.1;
      }

      let deltaQty = 0;
      if (action === 'BUY') {
        deltaQty = price > 0 ? Math.max(1, Math.round((100000 * targetFractionPct) / price)) : 100;
        lots.push({ seqNo: seq, qty: deltaQty, price });
      } else {
        // SELL: 核心逻辑 —— 以【被卖出的那一批次整体为单位】进行操作
        let targetLot = null;
        if (sourceLotPrice != null) {
          targetLot = lots.slice().reverse().find(l => Math.abs(l.price - sourceLotPrice) < 0.5 && l.qty > 0);
        }
        if (!targetLot) {
          const priceMatches = raw.match(/出.*?(\d+(?:\.\d+)?)/) || raw.match(/(\d+(?:\.\d+)?)\s*的/);
          if (priceMatches) {
            const targetPrice = parseFloat(priceMatches[1]);
            targetLot = lots.slice().reverse().find(l => Math.abs(l.price - targetPrice) < 0.5 && l.qty > 0);
          }
        }

        if (targetLot) {
          // 命中了目标批次：以该批次当前总股数为整体基数！
          if (raw.includes('出剩下一半') || raw.includes('剩下一半') || raw.includes('清仓') || raw.includes('出完') || raw.includes('全出')) {
            deltaQty = targetLot.qty;
            targetLot.qty = 0;
          } else if (raw.includes('出一半') || raw.includes('半仓')) {
            deltaQty = Math.ceil(targetLot.qty / 2);
            targetLot.qty -= deltaQty;
          } else if (raw.includes('三分之一') || raw.includes('1/3')) {
            deltaQty = Math.round(targetLot.qty / 3);
            targetLot.qty -= deltaQty;
          } else {
            // 默认整批全部卖出出清！
            deltaQty = targetLot.qty;
            targetLot.qty = 0;
          }
        } else {
          // 未指定特定买入价批次：采用实战栈结构 (LIFO / 后进先出)，优先平最近反弹做T的低位批次
          if (raw.includes('清仓') || raw.includes('出完') || raw.includes('平出') || raw.includes('全出') || raw.includes('出剩下一半')) {
            deltaQty = beforeQty;
            lots.forEach(l => l.qty = 0);
          } else if (raw.includes('出一半') || raw.includes('半仓')) {
            deltaQty = Math.ceil(beforeQty / 2);
            let rem = deltaQty;
            for (let i = lots.length - 1; i >= 0; i--) {
              const l = lots[i];
              if (l.qty > 0) {
                const d = Math.min(l.qty, rem);
                l.qty -= d;
                rem -= d;
                if (rem <= 0) break;
              }
            }
          } else {
            // 默认以栈顶 (最新做T批次) 优先平出
            const latestLot = lots.slice().reverse().find(l => l.qty > 0);
            if (latestLot) {
              deltaQty = latestLot.qty;
              latestLot.qty = 0;
            } else {
              deltaQty = beforeQty > 0 ? Math.min(beforeQty, Math.max(1, Math.round((100000 * targetFractionPct) / price))) : 0;
            }
          }
        }
      }

      const afterQty = lots.reduce((sum, l) => sum + l.qty, 0);
      const afterTotalCost = lots.reduce((sum, l) => sum + l.qty * l.price, 0);
      const afterAvgCost = afterQty > 0 ? Number((afterTotalCost / afterQty).toFixed(2)) : 0;

      // 计算单票权重与全盘总仓位 (基于标准 $100,000 规模)
      const zhaoBeforePct = Number(((beforeQty * price / 100000) * 100).toFixed(1));
      const zhaoAfterPct = Number(((afterQty * price / 100000) * 100).toFixed(1));

      let totalZhaoVal = 0;
      for (const s in zhaoSimLots) {
        totalZhaoVal += zhaoSimLots[s].reduce((sum, l) => sum + l.qty * l.price, 0);
      }
      const zhaoTotalExpPct = Number(((totalZhaoVal / 100000) * 100).toFixed(1));

      // 个人模拟账户 (零基准模式)
      const uQty = 0;
      const uCost = 0;
      const uTickerPct = 0.0;
      const uTotalExpPct = 0.0;

      insertStmt.run(
        replayId,
        r.id,
        r.message_id || '',
        r.created_at,
        r.raw_content || '',
        tickerClean,
        action,
        price,
        deltaQty,
        fractionDesc,
        r.fraction_ratio || null,
        beforeQty,
        beforeAvgCost,
        afterQty,
        afterAvgCost,
        zhaoBeforePct,
        zhaoAfterPct,
        zhaoTotalExpPct,
        uQty,
        uCost,
        uTickerPct,
        uTotalExpPct,
        sourceLotPrice ?? null,
        seq++
      );
    }
  });

  runBatch(candidates);
  return candidates.length;
}

/**
 * 级联推演引擎 (Cascade Re-simulation Engine)
 * 核心设计：
 * 1. 历史终态账本继承：遍历 seq_no < fromSeqNo 的所有已确认/已修正单据 (排除策略与非交易)，推演出基准在持批次 (zhaoSimLots)。
 * 2. 待审队列级联重算：从 fromSeqNo 起遍历所有待审单据 (status = 'pending')：
 *    - 语义抽取真实价格 (extractSemanticPrice) 与指向批次成本 (source_lot_price)；
 *    - 变动前持仓与均价链式衔接；
 *    - 买入按真实价格计算目标股数；
 *    - 卖出以【目标买入批次整体】为基数，半仓按批次/2，剩下一半/出完/清仓按全清整批，彻底避免碎股残留；
 *    - 变动后持仓、权重占比精准更新；
 *    - 批量写回 follow_replay_queue。
 */
export function resimulateReplayQueue(db = getDb(), fromSeqNo = 1) {
  initReplayTable(db);

  // 一次性获取全量单据，按真实 seq_no 升序排列
  const allRows = db.prepare(`
    SELECT id, seq_no, pool_id, message_id, raw_content, parsed_ticker, parsed_action, parsed_price, parsed_qty, fraction_desc, fraction_ratio, source_lot_price, status
    FROM follow_replay_queue
    ORDER BY seq_no ASC
  `).all();

  if (allRows.length === 0) return 0;

  const updatePendingStmt = db.prepare(`
    UPDATE follow_replay_queue
    SET parsed_action = ?,
        parsed_price = ?,
        parsed_qty = ?,
        source_lot_price = ?,
        fraction_desc = ?,
        before_qty = ?,
        before_avg_cost = ?,
        after_qty = ?,
        after_avg_cost = ?,
        zhao_before_pct = ?,
        zhao_after_pct = ?,
        zhao_total_exp_pct = ?
    WHERE id = ?
  `);

  const updateReviewedStmt = db.prepare(`
    UPDATE follow_replay_queue
    SET source_lot_price = ?,
        before_qty = ?,
        before_avg_cost = ?,
        after_qty = ?,
        after_avg_cost = ?,
        zhao_before_pct = ?,
        zhao_after_pct = ?,
        zhao_total_exp_pct = ?
    WHERE id = ?
  `);

  const zhaoSimLots = {}; // ticker -> [ { seqNo, qty, price } ]
  let recomputedCount = 0;

  const runTx = db.transaction((rows) => {
    for (const r of rows) {
      if (r.status === 'rejected_non_trade' || r.status === 'classified_strategy') {
        continue;
      }

      const ticker = (r.parsed_ticker || '').toUpperCase();
      let action = (r.parsed_action || 'BUY').toUpperCase();
      const raw = r.raw_content || '';

      if (!zhaoSimLots[ticker]) zhaoSimLots[ticker] = [];
      const lots = zhaoSimLots[ticker];

      const beforeQty = lots.reduce((sum, l) => sum + l.qty, 0);
      const beforeTotalCost = lots.reduce((sum, l) => sum + l.qty * l.price, 0);
      const beforeAvgCost = beforeQty > 0 ? Number((beforeTotalCost / beforeQty).toFixed(2)) : 0;

      // 语义解析真实成交价与批次价
      const { price: extPrice, sourceLotPrice: extSourceLot } = extractSemanticPrice(raw, ticker, action);
      const sourceLotPrice = extSourceLot !== null ? extSourceLot : r.source_lot_price;

      // 判断该单据是否为已由人工审核/修正过的单据（或序号在重算起点前）
      const isReviewed = (r.status !== 'pending') || (r.seq_no < fromSeqNo);

      let price = r.parsed_price;
      let deltaQty = r.parsed_qty;
      let fractionDesc = r.fraction_desc;

      if (!isReviewed) {
        // 动态校准待审单的买卖方向 (针对 "买回/加回/接回/回买" 等核心动词，纠正防止因带“卖出”被误判为 SELL)
        if (/买回|加回|接回|回买/.test(raw)) {
          action = 'BUY';
        } else if (/回吸/.test(raw) && !/出.*回吸|再出.*回吸/.test(raw)) {
          action = 'BUY';
        }

        price = (extPrice !== null && extPrice > 0) ? extPrice : (r.parsed_price || 100);

        // 离谱价格拦截与基于栈的持仓成本辅助纠偏 (Sanity & Stack Contextual Correction)
        if (action === 'SELL' && beforeAvgCost > 0 && price > 0) {
          const ratio = price / beforeAvgCost;
          if (ratio < 0.2 || ratio > 5.0) {
            // 发生离谱价格偏移 (例如持仓成本 107.5，提取出 1.0)
            const cleanRaw = raw.replace(/(\d+)\s*[。，、·]\s*(\d+)/g, '$1.$2');
            const allNums = Array.from(cleanRaw.matchAll(/\b(\d+(?:\.\d+)?)\b/g)).map(m => parseFloat(m[1]));
            const sensibleNum = allNums.find(n => Math.abs(n - beforeAvgCost) / beforeAvgCost < 0.35 && n !== price);
            if (sensibleNum) {
              console.warn(`[Stack Price Guard] #${r.seq_no} 离谱价格拦截: $${price} -> 借助栈持仓成本($${beforeAvgCost})辅助校准为 $${sensibleNum}`);
              price = sensibleNum;
            }
          }
        }
        fractionDesc = formatFractionDesc(r.fraction_desc, r.fraction_ratio, raw, action, sourceLotPrice);

        let targetFractionPct = 0.05;
        if (raw.includes('常规仓的一半') || raw.includes('一半常规仓') || raw.includes('一半做日内')) {
          targetFractionPct = 0.05;
        } else if (raw.includes('三分之一') || raw.includes('1/3')) {
          targetFractionPct = 0.0333;
        } else if (raw.includes('半仓') || /(出|卖|减|平).*一半/.test(raw) || raw.includes('减半')) {
          targetFractionPct = 0.05;
        } else if (r.fraction_ratio) {
          targetFractionPct = r.fraction_ratio * 0.1;
        }

        if (action === 'BUY') {
          // 做T买回模式：优先对等买回此前卖出的数量
          if (/买回|加回|接回|回买|回吸/.test(raw) && sourceLotPrice) {
            const prevSellRow = rows.slice().reverse().find(x => x.seq_no < r.seq_no && (x.parsed_ticker || '').toUpperCase() === ticker && (x.parsed_action || '').toUpperCase() === 'SELL' && Math.abs(x.parsed_price - sourceLotPrice) < 0.5);
            if (prevSellRow && prevSellRow.parsed_qty > 0) {
              deltaQty = prevSellRow.parsed_qty;
            } else {
              deltaQty = price > 0 ? Math.max(1, Math.round((100000 * targetFractionPct) / price)) : 100;
            }
          } else {
            deltaQty = price > 0 ? Math.max(1, Math.round((100000 * targetFractionPct) / price)) : 100;
          }
        } else {
          // SELL 推荐股数计算
          let targetLot = null;
          const isRecentLotRef = /刚才(回吸|买入|接回|回买|加的|买的|开的)|最近(一笔|买入|加的|开的)|做[tT]的那部分/i.test(raw);
          if (isRecentLotRef) {
            targetLot = lots.slice().reverse().find(l => l.qty > 0);
          }
          if (!targetLot && sourceLotPrice != null) {
            targetLot = lots.slice().reverse().find(l => Math.abs(l.price - sourceLotPrice) < 0.5 && l.qty > 0);
          }
          if (!targetLot) {
            const priceMatches = raw.match(/出.*?(\d+(?:\.\d+)?)/) || raw.match(/(\d+(?:\.\d+)?)\s*的/);
            if (priceMatches) {
              const p = parseFloat(priceMatches[1]);
              targetLot = lots.slice().reverse().find(l => Math.abs(l.price - p) < 0.5 && l.qty > 0);
            }
          }
          if (!targetLot && (raw.includes('剩下一半') || raw.includes('出剩下一半') || /(出|卖|减|平).*一半/.test(raw) || raw.includes('半仓') || raw.includes('减半') || /做[tT]/.test(raw))) {
            targetLot = lots.slice().reverse().find(l => l.qty > 0);
          }

          if (targetLot) {
            if (raw.includes('出剩下一半') || raw.includes('剩下一半') || raw.includes('剩下') || raw.includes('清仓') || raw.includes('出完') || raw.includes('全出') || raw.includes('平仓') || raw.includes('平本出')) {
              deltaQty = targetLot.qty;
            } else if (/(出|卖|减|平).*一半/.test(raw) || raw.includes('半仓') || raw.includes('减半')) {
              deltaQty = Math.floor(targetLot.qty / 2);
            } else if (raw.includes('三分之一') || raw.includes('1/3')) {
              deltaQty = Math.round(targetLot.qty / 3);
            } else {
              deltaQty = targetLot.qty;
            }
          } else {
            if (raw.includes('清仓') || raw.includes('出完') || raw.includes('平出') || raw.includes('全出') || raw.includes('出剩下一半') || raw.includes('剩下全部')) {
              deltaQty = beforeQty;
            } else if (/(出|卖|减|平).*一半/.test(raw) || raw.includes('半仓') || raw.includes('减半')) {
              if (beforeQty === 0 && (raw.includes('长线') || raw.includes('底仓'))) {
                const baseShares = price > 0 ? Math.max(1, Math.round(3333 / price)) : 160;
                deltaQty = Math.floor(baseShares / 2);
              } else {
                deltaQty = Math.ceil(beforeQty / 2);
              }
            } else {
              const latestLot = lots.slice().reverse().find(l => l.qty > 0);
              if (latestLot) {
                deltaQty = latestLot.qty;
              } else {
                if (beforeQty === 0 && (raw.includes('长线') || raw.includes('底仓'))) {
                  // 回放起点前的历史长线底仓减持 (按标准 1/3 常规仓 $3,333 资金推导基准股数)
                  const baseShares = price > 0 ? Math.max(1, Math.round(3333 / price)) : 100;
                  if (/(出|卖|减|平).*一半/.test(raw) || raw.includes('半仓') || raw.includes('减半')) {
                    deltaQty = Math.floor(baseShares / 2);
                  } else {
                    deltaQty = baseShares;
                  }
                } else {
                  deltaQty = beforeQty > 0 ? Math.min(beforeQty, Math.max(1, Math.round((100000 * targetFractionPct) / price))) : 0;
                }
              }
            }
          }
        }
      }

      // 将本单执行应用到批次账本中 (无论是已审还是待审)
      if (action === 'BUY') {
        lots.push({ seqNo: r.seq_no, qty: deltaQty, price });
      } else {
        // SELL
        let targetLot = null;
        const isRecentLotRef = /刚才(回吸|买入|接回|回买|加的|买的|开的)|最近(一笔|买入|加的|开的)|做[tT]的那部分/i.test(raw);
        if (isRecentLotRef) {
          targetLot = lots.slice().reverse().find(l => l.qty > 0);
        }
        if (!targetLot && sourceLotPrice != null) {
          targetLot = lots.slice().reverse().find(l => Math.abs(l.price - sourceLotPrice) < 0.5 && l.qty > 0);
        }
        if (!targetLot) {
          const priceMatches = raw.match(/出.*?(\d+(?:\.\d+)?)/) || raw.match(/(\d+(?:\.\d+)?)\s*的/);
          if (priceMatches) {
            const p = parseFloat(priceMatches[1]);
            targetLot = lots.slice().reverse().find(l => Math.abs(l.price - p) < 0.5 && l.qty > 0);
          }
        }
        if (!targetLot && (raw.includes('剩下一半') || raw.includes('出剩下一半') || /(出|卖|减|平).*一半/.test(raw) || raw.includes('半仓') || raw.includes('减半') || /做[tT]/.test(raw))) {
          targetLot = lots.slice().reverse().find(l => l.qty > 0);
        }

        if (targetLot) {
          if (deltaQty >= targetLot.qty || raw.includes('出剩下一半') || raw.includes('剩下一半') || raw.includes('出完') || raw.includes('清仓') || raw.includes('全出') || raw.includes('平本出')) {
            targetLot.qty = 0;
          } else {
            targetLot.qty -= deltaQty;
            if (targetLot.qty < 0) targetLot.qty = 0;
          }
        } else {
          // LIFO 栈式扣减
          let rem = deltaQty;
          for (let i = lots.length - 1; i >= 0; i--) {
            const l = lots[i];
            if (l.qty > 0) {
              const d = Math.min(l.qty, rem);
              l.qty -= d;
              rem -= d;
              if (rem <= 0) break;
            }
          }
        }
      }

      const afterQty = lots.reduce((sum, l) => sum + l.qty, 0);
      const afterTotalCost = lots.reduce((sum, l) => sum + l.qty * l.price, 0);
      const afterAvgCost = afterQty > 0 ? Number((afterTotalCost / afterQty).toFixed(2)) : 0;

      const zhaoBeforePct = Number(((beforeQty * price / 100000) * 100).toFixed(1));
      const zhaoAfterPct = Number(((afterQty * price / 100000) * 100).toFixed(1));

      let totalZhaoVal = 0;
      for (const s in zhaoSimLots) {
        totalZhaoVal += zhaoSimLots[s].reduce((sum, l) => sum + l.qty * l.price, 0);
      }
      const zhaoTotalExpPct = Number(((totalZhaoVal / 100000) * 100).toFixed(1));

      if (!isReviewed) {
        updatePendingStmt.run(
          action,
          price,
          deltaQty,
          sourceLotPrice ?? null,
          fractionDesc,
          beforeQty,
          beforeAvgCost,
          afterQty,
          afterAvgCost,
          zhaoBeforePct,
          zhaoAfterPct,
          zhaoTotalExpPct,
          r.id
        );
        recomputedCount++;
      } else {
        updateReviewedStmt.run(
          sourceLotPrice ?? null,
          beforeQty,
          beforeAvgCost,
          afterQty,
          afterAvgCost,
          zhaoBeforePct,
          zhaoAfterPct,
          zhaoTotalExpPct,
          r.id
        );
      }
    }
  });

  runTx(allRows);
  console.log(`[Cascade Re-simulation] 全局批次流水校验完成，级联更新了 ${recomputedCount} 条待审单据。`);
  return recomputedCount;
}

/**
 * 获取当前队头待审记录与全局统计
 */
export function getNextPendingReplayItem(db = getDb()) {
  initReplayTable(db);

  const current = db.prepare(`
    SELECT * FROM follow_replay_queue
    WHERE status = 'pending'
    ORDER BY seq_no ASC
    LIMIT 1
  `).get();

  const total = db.prepare("SELECT count(*) as c FROM follow_replay_queue").get().c;
  const processed = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status != 'pending'").get().c;
  const confirmed = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status = 'confirmed_skip'").get().c;
  const corrected = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status = 'corrected'").get().c;
  const strategy = db.prepare("SELECT count(*) as c FROM follow_replay_queue WHERE status IN ('rejected_non_trade', 'classified_strategy')").get().c;

  return {
    item: current || null,
    stats: {
      total,
      processed,
      pending: total - processed,
      confirmed,
      corrected,
      strategy,
      progressPct: total > 0 ? ((processed / total) * 100).toFixed(1) : '100.0'
    }
  };
}

/**
 * 提取指定标的的历史成交明细与在持批次 (REQ-033: 分批成本对账)
 */
export function getTickerLotsAndHistory(targetSeqNo, ticker, db = getDb()) {
  const cleanTicker = (ticker || '').toUpperCase();
  const rows = db.prepare(`
    SELECT seq_no, parsed_ticker, parsed_action, parsed_price, parsed_qty, raw_content, fraction_desc, created_at, status
    FROM follow_replay_queue
    WHERE seq_no < ? AND parsed_ticker = ? AND status NOT IN ('rejected_non_trade', 'classified_strategy')
    ORDER BY seq_no ASC
  `).all(targetSeqNo, cleanTicker);

  const lots = [];

  for (const r of rows) {
    if (r.parsed_action === 'BUY') {
      lots.push({
        seqNo: r.seq_no,
        qty: r.parsed_qty,
        origQty: r.parsed_qty,
        price: r.parsed_price
      });
    } else if (r.parsed_action === 'SELL') {
      let rem = r.parsed_qty;
      // 提取针对特定价格的卖出 (如 "出98.7的", "47.8 的iren在47.8 平本出")
      let targetPrice = null;
      const semantic = extractSemanticPrice(r.raw_content, cleanTicker, r.parsed_action);
      if (semantic.sourceLotPrice != null) {
        targetPrice = semantic.sourceLotPrice;
      } else {
        const priceMatches = r.raw_content.match(/出.*?(\d+(?:\.\d+)?)/) || r.raw_content.match(/(\d+(?:\.\d+)?)\s*的/);
        if (priceMatches) {
          targetPrice = parseFloat(priceMatches[1]);
        }
      }

      // 如果有指明价格，优先扣减栈顶 (最近买入做T) 的相近价格 lot
      const isCleanUp = (r.raw_content || '').includes('出剩下一半') || (r.raw_content || '').includes('剩下一半') || (r.raw_content || '').includes('出完') || (r.raw_content || '').includes('清仓') || (r.raw_content || '').includes('全出') || (r.raw_content || '').includes('平本出');
      if (targetPrice) {
        for (let i = lots.length - 1; i >= 0; i--) {
          const lot = lots[i];
          if (Math.abs(lot.price - targetPrice) < 0.5 && lot.qty > 0) {
            if (rem >= lot.qty || isCleanUp) {
              rem = Math.max(0, rem - lot.qty);
              lot.qty = 0;
              break;
            } else {
              const deduct = Math.min(lot.qty, rem);
              lot.qty -= deduct;
              rem -= deduct;
              if (rem <= 0) break;
            }
          }
        }
      }

      // 剩余未核销部分按实战栈结构 (LIFO / 后进先出) 优先扣减最新做T买入批次
      if (rem > 0) {
        for (let i = lots.length - 1; i >= 0; i--) {
          const lot = lots[i];
          if (lot.qty > 0) {
            if (rem >= lot.qty || isCleanUp) {
              rem = Math.max(0, rem - lot.qty);
              lot.qty = 0;
              break;
            }
            const deduct = Math.min(lot.qty, rem);
            lot.qty -= deduct;
            rem -= deduct;
            if (rem <= 0) break;
          }
        }
      }
    }
  }

  const activeLots = lots.filter(l => l.qty > 0);
  
  // 近期历史明细 (展示最近至多 6 笔，若更早有记录则标明结清提示)
  const maxShow = 6;
  let recentTrades = [];
  if (rows.length > maxShow) {
    const omitted = rows.length - maxShow;
    recentTrades.push(`    • *(更早有 ${omitted} 笔历史操作已结清平仓)*`);
    recentTrades.push(...rows.slice(-maxShow).map(r => {
      const actIcon = r.parsed_action === 'BUY' ? '🟢买' : '🔴卖';
      const cleanRaw = (r.raw_content || '').replace(/\n+/g, ' ').trim();
      const shortRaw = cleanRaw.length > 25 ? cleanRaw.substring(0, 25) + '...' : cleanRaw;
      return `    • #${r.seq_no} ${actIcon} ${r.parsed_qty}股 @ $${r.parsed_price.toFixed(2)} 「${shortRaw}」`;
    }));
  } else {
    recentTrades = rows.map(r => {
      const actIcon = r.parsed_action === 'BUY' ? '🟢买' : '🔴卖';
      const cleanRaw = (r.raw_content || '').replace(/\n+/g, ' ').trim();
      const shortRaw = cleanRaw.length > 25 ? cleanRaw.substring(0, 25) + '...' : cleanRaw;
      return `    • #${r.seq_no} ${actIcon} ${r.parsed_qty}股 @ $${r.parsed_price.toFixed(2)} 「${shortRaw}」`;
    });
  }

  return {
    activeLots,
    recentTrades
  };
}

/**
 * 计算双账本的持股占比与全盘总仓位状态 (跟单参考核心依据)
 */
export function calculateExposureStats(item, db = getDb()) {
  const isBuy = item.parsed_action === 'BUY';
  const beforeQ = item.before_qty || 0;
  const afterQ = item.after_qty || (isBuy ? beforeQ + item.parsed_qty : Math.max(0, beforeQ - item.parsed_qty));

  const zhaoBeforePct = item.zhao_before_pct != null ? Number(item.zhao_before_pct).toFixed(1) : '0.0';
  const zhaoAfterPct = item.zhao_after_pct != null ? Number(item.zhao_after_pct).toFixed(1) : '0.0';
  const zhaoTotalExposurePct = item.zhao_total_exp_pct != null ? Number(item.zhao_total_exp_pct).toFixed(1) : '0.0';

  const lotInfo = getTickerLotsAndHistory(item.seq_no, item.parsed_ticker, db);

  let userCash = 100000;
  try {
    const cashRow = db.prepare("SELECT value FROM portfolio WHERE key = 'cash'").get();
    if (cashRow) userCash = parseFloat(cashRow.value) || 100000;
  } catch (_) {}

  let userTotalPosValue = 0;
  let userTargetPosValue = 0;
  let userTargetQty = item.user_qty || 0;
  let userTargetCost = item.user_avg_cost || 0;

  try {
    const userPositions = db.prepare("SELECT * FROM positions").all();
    for (const p of userPositions) {
      const val = (p.quantity || 0) * (p.current_price || p.average_entry_price || item.parsed_price || 0);
      userTotalPosValue += val;
      if (p.ticker === item.parsed_ticker) {
        userTargetQty = p.quantity;
        userTargetCost = p.average_entry_price;
        userTargetPosValue = val;
      }
    }
  } catch (_) {}

  const userTotalEquity = userCash + userTotalPosValue;
  const userTotalExposurePct = userTotalEquity > 0 ? ((userTotalPosValue / userTotalEquity) * 100).toFixed(1) : '0.0';
  const userTargetExposurePct = userTotalEquity > 0 ? ((userTargetPosValue / userTotalEquity) * 100).toFixed(1) : '0.0';

  const lotsStr = lotInfo.activeLots.length > 0
    ? lotInfo.activeLots.map((l, idx) => `批次#${idx + 1} (#${l.seqNo}): ${l.qty}股 @ $${l.price.toFixed(2)}`).join(' ｜ ')
    : '无历史在持 (从 0 开仓)';

  return {
    zhao: {
      beforeQ,
      afterQ,
      beforeCostStr: item.before_avg_cost > 0 ? `$${item.before_avg_cost.toFixed(2)}` : '$0.00',
      afterCostStr: item.after_avg_cost > 0 ? `$${item.after_avg_cost.toFixed(2)}` : `$${item.parsed_price.toFixed(2)}`,
      beforePct: zhaoBeforePct,
      afterPct: zhaoAfterPct,
      totalExposurePct: zhaoTotalExposurePct,
      activeLots: lotInfo.activeLots,
      recentTrades: lotInfo.recentTrades,
      lotsStr
    },
    user: {
      qty: userTargetQty,
      costStr: userTargetCost > 0 ? `$${userTargetCost.toFixed(2)}` : '$0.00',
      posVal: userTargetPosValue.toFixed(0),
      targetPct: userTargetExposurePct,
      totalExposurePct: userTotalExposurePct,
      totalEquity: userTotalEquity.toFixed(0),
      cash: userCash.toFixed(0)
    }
  };
}

/**
 * 构建企业微信推送 Markdown 卡片文本与操作 URL
 */
export function buildReplayWeComMessage(item, stats, db = getDb()) {
  const token = generateReplayToken(item.id, item.parsed_ticker, item.parsed_action);
  const totalAmount = (item.parsed_price * item.parsed_qty).toFixed(2);
  const timeStr = new Date(item.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const baseUrl = getBaseUrl();
  const confirmSkipUrl = `${baseUrl}/api/follow/replay-callback?action=CONFIRM_SKIP&id=${item.id}&token=${token}`;
  const correctFormUrl = `${baseUrl}/follow/correct?id=${item.id}&token=${token}`;
  const rejectUrl = `${baseUrl}/api/follow/replay-callback?action=REJECT_NON_TRADE&id=${item.id}&token=${token}`;

  const isBuy = item.parsed_action === 'BUY';
  const actionZh = isBuy ? '🟢 买入 (BUY)' : '🔴 卖出 (SELL)';
  const actionColor = isBuy ? '#10b981' : '#ef4444';
  const fractionDesc = item.fraction_desc || '常规操作 (未明确比例)';
  
  const exp = calculateExposureStats(item, db);

  const userStockDesc = exp.user.qty > 0 
    ? `${exp.user.qty} 股 (成本 ${exp.user.costStr})` 
    : '0 股 *(当前未持仓)*';

  const strategyCount = stats.strategy || 0;

  // 格式化批次行与历史操作行
  let lotsLines = '    - *暂无历史在持批次*';
  if (exp.zhao.activeLots && exp.zhao.activeLots.length > 0) {
    lotsLines = exp.zhao.activeLots.map((l, i) => `    - 批次#${i + 1} (#${l.seqNo}): \`${l.qty} 股\` @ \`$${l.price.toFixed(2)}\``).join('\n');
  }

  let historyLines = '';
  if (exp.zhao.recentTrades && exp.zhao.recentTrades.length > 0) {
    historyLines = `\n  - **近期操作明细 (历史对账)**:\n${exp.zhao.recentTrades.join('\n')}`;
  }

  const text = `### 📋 历史大V交易单回放校验【第 #${item.seq_no} 笔 / 共 ${stats.total} 笔】
> **进度**: 已审 **${stats.processed}/${stats.total}** (${stats.progressPct}%) ｜ 正确: ${stats.confirmed} ｜ 修正: ${stats.corrected} ｜ 策略资产: ${strategyCount}

**原始大V发言**:
> 「*${item.raw_content}*」

---
- **发言时间**: \`${timeStr}\`
- **解析标的**: **${item.parsed_ticker}**
- **交易方向**: <font color="${actionColor}">${actionZh}</font>
- **委托价格**: \`$${item.parsed_price.toFixed(2)}\`
- **仓位维度 (大V表述)**: **${fractionDesc}**
- **参考委托股数**: \`${item.parsed_qty} 股\` *(参考金额: $${totalAmount})*
---
📊 **双账本持仓与总仓位状态 (基于【总资产】基准)**：
> 💡 *注：单票权重与全盘总仓位均以【总资产 (现金+股票市值)】为分母，非仅基于股票。*
- **赵哥推演账本**:
  - **个股持仓**: \`${exp.zhao.beforeQ} 股\` (${exp.zhao.beforeCostStr}) ➔ \`${exp.zhao.afterQ} 股\` (${exp.zhao.afterCostStr})
  - **单票权重**: **${exp.zhao.beforePct}%** ➔ **${exp.zhao.afterPct}%** *(占总资产)*
  - **当前持有批次明细**:
${lotsLines}
${historyLines}
  - **全盘总仓位**: 约 **${exp.zhao.totalExposurePct}%** *(持股占总资产)*
- **个人模拟账户**:
  - **个股持仓**: \`${userStockDesc}\`
  - **单票权重**: **${exp.user.targetPct}%** *(占总资产 / 市值 $${exp.user.posVal})*
  - **全盘总仓位**: **${exp.user.totalExposurePct}%** *(持股占总资产 / 总资产 $${exp.user.totalEquity} / 现金 $${exp.user.cash})*
---
👉 **请对照原始发言对本单 (#${item.seq_no}) 进行确认**：
1. **[✅ 确认 #${item.seq_no} ${item.parsed_ticker} 正确 (跳过交易)](${confirmSkipUrl})**  
*(判定为真实交易且要素正确，计入账本并推下一条)*
2. **[✏️ 修正 #${item.seq_no} ${item.parsed_ticker} 错误 (在表单中修改)](${correctFormUrl})**  
*(打开表单修改买卖方向、单价、股数或仓位后提交)*
3. **[💡 判定 #${item.seq_no} 为策略预判 (转存为大V策略资产)](${rejectUrl})**  
*(若发言仅为走势预判、条件单说明或观点讨论，点击转存为策略资产并不计入交易持仓)*`;

  return { text, confirmSkipUrl, correctFormUrl, rejectUrl };
}

/**
 * 发送当前队头卡片至企业微信
 */
export async function pushCurrentReplayCard(db = getDb()) {
  const { item, stats } = getNextPendingReplayItem(db);
  if (!item) {
    console.log('[Follow Replay] 🎉 队列已全部审核完毕！没有更多待审单据。');
    return { finished: true, stats };
  }

  const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('WECHAT_WORK_WEBHOOK_URL is not configured in .env');
  }

  const { text } = buildReplayWeComMessage(item, stats);

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: text }
    })
  });

  const json = await res.json().catch(() => ({}));
  if (json.errcode !== 0) {
    console.error(`[Follow Replay] 推送企微失败: errcode=${json.errcode}, errmsg=${json.errmsg}`);
    return { success: false, error: json.errmsg, item, stats };
  }

  console.log(`[Follow Replay] ✅ 已成功推送第 #${item.seq_no} 条待审单 (${item.parsed_ticker})`);
  return { success: true, item, stats };
}

/**
 * 处理用户点击「确认解析正确 (跳过交易)」
 */
export async function handleReplayConfirmSkip(id, token, userid = 'human', db = getDb()) {
  initReplayTable(db);

  const row = db.prepare("SELECT * FROM follow_replay_queue WHERE id = ?").get(id);
  if (!row) {
    return { success: false, code: 404, error: '单据不存在' };
  }
  if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
    return { success: false, code: 400, error: 'Token 验签失败或已失效' };
  }
  if (row.status !== 'pending') {
    return { success: false, code: 409, error: `该单据已处理 (状态: ${row.status})` };
  }

  const now = Date.now();
  db.prepare(`
    UPDATE follow_replay_queue
    SET status = 'confirmed_skip', reviewed_at = ?
    WHERE id = ?
  `).run(now, id);

  // 标记 trade_review_pool 为 confirmed
  if (row.pool_id) {
    try {
      db.prepare(`
        UPDATE trade_review_pool 
        SET status = 'confirmed', updated_at = ? 
        WHERE id = ?
      `).run(now, row.pool_id);
    } catch (_) {}
  }

  // 自动触发级联推演更新后续所有待审单据
  try {
    resimulateReplayQueue(db, row.seq_no + 1);
  } catch (err) {
    console.error('[Follow Replay] 级联推演异常:', err.message);
  }

  // 异步触发推送下一条 (若非测试模式)
  if (process.env.NODE_ENV !== 'test') {
    setImmediate(() => {
      pushCurrentReplayCard(db).catch(err => console.error('[Follow Replay] 推进下一条异常:', err.message));
    });
  }

  return {
    success: true,
    message: `已确认单据 #${row.seq_no} (${row.parsed_ticker}) 解析正确，正在推送下一条...`
  };
}

/**
 * 处理用户判定单据为「非即时交易 / 纯策略分析 / 条件单预判」 (REQ-033: 转存为大V策略资产)
 */
export async function handleReplayRejectNonTrade(id, token, reason = 'strategy_plan', userid = 'human', db = getDb()) {
  initReplayTable(db);

  const row = db.prepare("SELECT * FROM follow_replay_queue WHERE id = ?").get(id);
  if (!row) {
    return { success: false, code: 404, error: '单据不存在' };
  }
  if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
    return { success: false, code: 400, error: 'Token 验签失败或已失效' };
  }
  if (row.status !== 'pending') {
    return { success: false, code: 409, error: `该单据已处理 (状态: ${row.status})` };
  }

  const now = Date.now();

  // 1. 转存为大V策略与条件单资产库 (永久保留，不浪费策略知识)
  try {
    db.prepare(`
      INSERT OR REPLACE INTO strategy_assets 
      (id, replay_id, message_id, ticker, raw_content, plan_type, trigger_condition, created_at, saved_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      `strat_${row.id}`,
      row.id,
      row.message_id || '',
      row.parsed_ticker || 'UNKNOWN',
      row.raw_content,
      'condition_strategy',
      row.raw_content,
      row.created_at,
      now
    );
  } catch (err) {
    console.error('[Strategy Assets] 转存策略资产异常:', err.message);
  }

  // 2. 沉淀一条到 trade_signals 底册 (标记为 strategy_plan，用于复盘和模型挖掘)
  try {
    db.prepare(`
      INSERT OR REPLACE INTO trade_signals 
      (signal_id, message_id, ticker, action, price, quantity, stop_loss, reason, parse_status, source, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'strategy_plan', 'zhao_strategy', ?)
    `).run(
      `sig_strat_${row.id}`,
      row.message_id || '',
      row.parsed_ticker || 'UNKNOWN',
      row.parsed_action || 'OBSERVE',
      row.parsed_price || 0,
      row.parsed_price || 0,
      row.raw_content,
      row.created_at
    );
  } catch (err) {
    console.error('[Trade Signals] 写入策略流水异常:', err.message);
  }

  // 3. 更新回放队列状态为 classified_strategy
  db.prepare(`
    UPDATE follow_replay_queue
    SET status = 'classified_strategy', reviewed_at = ?, corrected_json = ?
    WHERE id = ?
  `).run(now, JSON.stringify({ reject_reason: reason, asset_id: `strat_${row.id}`, operator: userid }), id);

  // 4. 关联的候选池标记为 strategy
  if (row.pool_id) {
    try {
      db.prepare(`
        UPDATE trade_review_pool 
        SET status = 'strategy', updated_at = ? 
        WHERE id = ?
      `).run(now, row.pool_id);
    } catch (_) {}
  }

  // 自动触发级联推演更新后续所有待审单据
  try {
    resimulateReplayQueue(db, row.seq_no + 1);
  } catch (err) {
    console.error('[Follow Replay] 级联推演异常:', err.message);
  }

  // 5. 异步触发推送下一条 (若非测试模式)
  if (process.env.NODE_ENV !== 'test') {
    setImmediate(() => {
      pushCurrentReplayCard(db).catch(err => console.error('[Follow Replay] 推进下一条异常:', err.message));
    });
  }

  return {
    success: true,
    message: `已成功将单据 #${row.seq_no} (${row.parsed_ticker}) 转存为【大V策略计划资产】！不计入即时交易持仓，正在推送下一条...`
  };
}

/**
 * 处理用户在表单中提交纠错信息
 */
export async function handleReplayCorrectionSubmit(data, userid = 'human', db = getDb()) {
  const { id, token, ticker, action, price, quantity, fraction_desc, trade_time, note } = data;
  initReplayTable(db);

  const row = db.prepare("SELECT * FROM follow_replay_queue WHERE id = ?").get(id);
  if (!row) {
    return { success: false, code: 404, error: '单据不存在' };
  }
  if (!verifyReplayToken(row.id, row.parsed_ticker, row.parsed_action, token)) {
    return { success: false, code: 400, error: 'Token 验签失败或已失效' };
  }

  const cleanTicker = String(ticker || '').trim().toUpperCase();
  const cleanAction = String(action || '').trim().toUpperCase();
  const cleanPrice = parseFloat(price);
  const cleanQty = parseInt(quantity, 10);
  const cleanTime = trade_time ? new Date(trade_time).getTime() : row.created_at;
  const cleanFraction = String(fraction_desc || row.fraction_desc || '').trim();

  if (!cleanTicker || !['BUY', 'SELL'].includes(cleanAction) || isNaN(cleanPrice) || cleanPrice <= 0 || isNaN(cleanQty) || cleanQty <= 0) {
    return { success: false, code: 400, error: '提交的要素格式不合法 (标的、方向、价格、数量不能为空且必须大于0)' };
  }

  const correctionPayload = {
    original: {
      ticker: row.parsed_ticker,
      action: row.parsed_action,
      price: row.parsed_price,
      quantity: row.parsed_qty,
      fraction_desc: row.fraction_desc,
      time: row.created_at
    },
    corrected: {
      ticker: cleanTicker,
      action: cleanAction,
      price: cleanPrice,
      quantity: cleanQty,
      fraction_desc: cleanFraction,
      time: cleanTime,
      totalAmount: (cleanPrice * cleanQty).toFixed(2),
      note: note || '',
      corrected_by: userid
    }
  };

  const now = Date.now();
  db.prepare(`
    UPDATE follow_replay_queue
    SET status = 'corrected', 
        parsed_ticker = ?, 
        parsed_action = ?, 
        parsed_price = ?, 
        parsed_qty = ?, 
        fraction_desc = ?,
        corrected_json = ?, 
        reviewed_at = ?
    WHERE id = ?
  `).run(cleanTicker, cleanAction, cleanPrice, cleanQty, cleanFraction, JSON.stringify(correctionPayload), now, id);

  // 纠正回写 trade_review_pool 表
  if (row.pool_id) {
    try {
      db.prepare(`
        UPDATE trade_review_pool 
        SET ticker = ?, action = ?, price = ?, fraction_name = ?, is_manual = 1, status = 'confirmed', updated_at = ?
        WHERE id = ?
      `).run(cleanTicker, cleanAction, cleanPrice, cleanFraction, now, row.pool_id);
    } catch (_) {}
  }

  // REQ-035: 同步纠错流水至 trade_signals 底册 (打上 source: manual_correct)
  try {
    const { saveTradeSignal } = await import('./database.js');
    saveTradeSignal({
      signal_id: `sig_corr_${row.id}_${now}`,
      message_id: row.message_id || null,
      channel_id: null,
      speaker_name: '赵哥(人工修正)',
      ticker: cleanTicker,
      action: cleanAction,
      price: cleanPrice,
      quantity: cleanQty,
      reason: `回放纠错 #${row.seq_no}: ${cleanFraction}`,
      parse_status: 'ok',
      source: 'manual_correct',
      created_at: cleanTime
    }, db);
  } catch (_) {}

  // 自动触发级联推演更新后续所有待审单据
  try {
    resimulateReplayQueue(db, row.seq_no + 1);
  } catch (err) {
    console.error('[Follow Replay] 级联推演异常:', err.message);
  }

  // 异步触发推送下一条 (若非测试环境)
  if (process.env.NODE_ENV !== 'test') {
    setImmediate(() => {
      pushCurrentReplayCard(db).catch(err => console.error('[Follow Replay] 推进下一条异常:', err.message));
    });
  }

  return {
    success: true,
    message: `已成功保存对 #${row.seq_no} 单的纠错修正，正在推送下一条...`,
    correction: correctionPayload
  };
}
