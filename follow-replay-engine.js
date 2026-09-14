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
 * 提炼仓位多维度描述（大V表述 + 比例折算）
 */
export function formatFractionDesc(fractionName, fractionRatio, rawContent) {
  const raw = rawContent || '';
  if (raw.includes('常规仓的一半') || raw.includes('一半常规仓')) {
    return '0.5 笔常规仓 (约占总资金 5.0%)';
  }
  if (raw.includes('三分之一常规仓') || raw.includes('1/3常规仓') || raw.includes('1/3 常规仓')) {
    return '1/3 笔常规仓 (约占总资金 3.3%)';
  }
  if (raw.includes('出一半') || raw.includes('半仓')) {
    return '0.5 笔仓位 (半仓 / 约 50% 标的持仓)';
  }
  if (raw.includes('清仓') || raw.includes('出完') || raw.includes('全出')) {
    return '全部清仓 (100% 标的持仓)';
  }
  if (fractionRatio) {
    const pct = (fractionRatio * 10).toFixed(1);
    return `${fractionName ? fractionName + ' ' : ''}(约占总资金 ${pct}%)`;
  }
  if (fractionName) {
    return fractionName;
  }
  return '常规操作 (未明确比例)';
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
    (id, pool_id, message_id, created_at, raw_content, parsed_ticker, parsed_action, parsed_price, parsed_qty, fraction_desc, fraction_ratio, before_qty, before_avg_cost, after_qty, after_avg_cost, zhao_before_pct, zhao_after_pct, zhao_total_exp_pct, user_qty, user_avg_cost, user_ticker_pct, user_total_exp_pct, status, seq_no)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  // 从 2026-05-15 起零基线以【批次 Lot 为整体】推演赵哥账本
  const zhaoSimLots = {}; // ticker -> [ { seqNo, qty, price } ]

  const runBatch = db.transaction((rows) => {
    let seq = 1;
    for (const r of rows) {
      const replayId = `rpl_${r.id}`;
      const tickerClean = (r.ticker || '').toUpperCase();
      const action = (r.action || 'BUY').toUpperCase();
      const price = Number(r.price || 0);

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
        const priceMatches = raw.match(/出.*?(\d+(\.\d+)?)/) || raw.match(/(\d+(\.\d+)?)的/);
        const targetPrice = priceMatches ? parseFloat(priceMatches[1]) : null;

        let targetLot = null;
        if (targetPrice) {
          targetLot = lots.find(l => Math.abs(l.price - targetPrice) < 0.5 && l.qty > 0);
        }

        if (targetLot) {
          // 命中了目标批次：以该批次当前总股数为整体基数！
          if (raw.includes('出一半') || raw.includes('半仓')) {
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
          // 未指定特定买入价批次
          if (raw.includes('清仓') || raw.includes('出完') || raw.includes('平出') || raw.includes('全出')) {
            deltaQty = beforeQty;
            lots.forEach(l => l.qty = 0);
          } else if (raw.includes('出一半') || raw.includes('半仓')) {
            deltaQty = Math.ceil(beforeQty / 2);
            let rem = deltaQty;
            for (const l of lots) {
              if (l.qty > 0) {
                const d = Math.min(l.qty, rem);
                l.qty -= d;
                rem -= d;
                if (rem <= 0) break;
              }
            }
          } else {
            // 默认扣减最早在持批次
            const firstLot = lots.find(l => l.qty > 0);
            if (firstLot) {
              deltaQty = firstLot.qty;
              firstLot.qty = 0;
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
        const sQty = zhaoSimLots[s].reduce((sum, l) => sum + l.qty, 0);
        totalZhaoVal += sQty * price;
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
        seq++
      );
    }
  });

  runBatch(candidates);
  return candidates.length;
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
      // 提取针对特定价格的卖出 (如 "出98.7的")
      const priceMatches = r.raw_content.match(/出.*?(\d+(\.\d+)?)/) || r.raw_content.match(/(\d+(\.\d+)?)的/);
      let targetPrice = null;
      if (priceMatches) {
        targetPrice = parseFloat(priceMatches[1]);
      }

      // 如果有指明价格，优先扣减该价格附近的 lot
      if (targetPrice) {
        for (const lot of lots) {
          if (Math.abs(lot.price - targetPrice) < 0.5 && lot.qty > 0) {
            // 若卖出股数与该批次股数相差 <= 2 股，说明大V本意全出该批次，直接出清归零
            if (Math.abs(lot.qty - rem) <= 2) {
              rem = Math.max(0, rem - lot.qty);
              lot.qty = 0;
              break;
            } else {
              const deduct = Math.min(lot.qty, rem);
              lot.qty -= deduct;
              rem -= deduct;
              if (lot.qty <= 2) lot.qty = 0; // 尾差碎股清零
              if (rem <= 0) break;
            }
          }
        }
      }

      // 剩余未核销部分按 FIFO 扣减
      if (rem > 0) {
        for (const lot of lots) {
          if (lot.qty > 0) {
            if (Math.abs(lot.qty - rem) <= 2) {
              rem = Math.max(0, rem - lot.qty);
              lot.qty = 0;
              break;
            }
            const deduct = Math.min(lot.qty, rem);
            lot.qty -= deduct;
            rem -= deduct;
            if (lot.qty <= 2) lot.qty = 0; // 尾差碎股清零
            if (rem <= 0) break;
          }
        }
      }
    }
  }

  const activeLots = lots.filter(l => l.qty > 0);
  
  // 近期历史明细 (取最近 4 笔)
  const recentTrades = rows.slice(-4).map(r => {
    const actIcon = r.parsed_action === 'BUY' ? '🟢买' : '🔴卖';
    const cleanRaw = (r.raw_content || '').replace(/\n+/g, ' ').trim();
    const shortRaw = cleanRaw.length > 25 ? cleanRaw.substring(0, 25) + '...' : cleanRaw;
    return `    • #${r.seq_no} ${actIcon} ${r.parsed_qty}股 @ $${r.parsed_price.toFixed(2)} 「${shortRaw}」`;
  });

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
