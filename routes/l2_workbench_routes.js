import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const BASE_CLEANED_L2A_PATH = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const INCR_POINTER_PATH = 'data/runs/l2a_incr_latest.json';
const L2B_ZHAO_HITS_PATH = 'data/runs/l2b_zhao_kid_hits.jsonl';
const L2B_MRZHOU_PATH = 'data/l2b/mrzhou/atoms.json';
const HUMAN_VERIFIED_LOG_PATH = 'data/runs/l2a_human_verified_actions.jsonl';

const TIER1_HARD_FILL_CUS = new Set(['cu_trade_00955', 'cu_trade_01174']);

let cachedL2aRecords = null;
let cachedL2bZhaoMap = null;
let cachedL2bMrzhou = null;

function loadL2aData() {
  if (cachedL2aRecords) return cachedL2aRecords;

  const records = [];
  // 1. 载入基础库 (1195)
  if (fs.existsSync(BASE_CLEANED_L2A_PATH)) {
    const lines = fs.readFileSync(BASE_CLEANED_L2A_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    for (const l of lines) records.push(JSON.parse(l));
  }

  // 2. 检查是否有增量批次文件
  if (fs.existsSync(INCR_POINTER_PATH)) {
    try {
      const pointer = JSON.parse(fs.readFileSync(INCR_POINTER_PATH, 'utf-8'));
      if (pointer.has_incremental && pointer.incremental_path && fs.existsSync(pointer.incremental_path)) {
        const incrLines = fs.readFileSync(pointer.incremental_path, 'utf-8').trim().split('\n').filter(Boolean);
        for (const l of incrLines) records.push(JSON.parse(l));
      }
    } catch (e) {
      console.error("[L2Workbench] 读取增量指针异常:", e);
    }
  }

  cachedL2aRecords = records;
  return cachedL2aRecords;
}

function loadL2bData() {
  if (!cachedL2bZhaoMap) {
    cachedL2bZhaoMap = new Map();
    // 1. 基线 1195 战法命中
    if (fs.existsSync(L2B_ZHAO_HITS_PATH)) {
      const lines = fs.readFileSync(L2B_ZHAO_HITS_PATH, 'utf-8').trim().split('\n').filter(Boolean);
      for (const l of lines) {
        const item = JSON.parse(l);
        if (!cachedL2bZhaoMap.has(item.cu_id)) cachedL2bZhaoMap.set(item.cu_id, []);
        cachedL2bZhaoMap.get(item.cu_id).push(item);
      }
    }
    // 2. W8: 增量批次战法命中合并 (例如 l2b_hits_20260828_incr01.jsonl 或指针指定文件)
    if (fs.existsSync(INCR_POINTER_PATH)) {
      try {
        const pointer = JSON.parse(fs.readFileSync(INCR_POINTER_PATH, 'utf-8'));
        const runId = pointer.latest_run_id || '20260828_incr01';
        const incrHitsPath = `data/runs/l2b_hits_${runId}.jsonl`;
        if (fs.existsSync(incrHitsPath)) {
          const incrLines = fs.readFileSync(incrHitsPath, 'utf-8').trim().split('\n').filter(Boolean);
          for (const l of incrLines) {
            const item = JSON.parse(l);
            if (!cachedL2bZhaoMap.has(item.cu_id)) cachedL2bZhaoMap.set(item.cu_id, []);
            cachedL2bZhaoMap.get(item.cu_id).push(item);
          }
        }
      } catch (e) {
        console.error("[L2Workbench] 读取增量 L2b hits 异常:", e);
      }
    }
  }
  if (!cachedL2bMrzhou) {
    cachedL2bMrzhou = [];
    if (fs.existsSync(L2B_MRZHOU_PATH)) {
      cachedL2bMrzhou = JSON.parse(fs.readFileSync(L2B_MRZHOU_PATH, 'utf-8'));
    }
  }
  return { zhaoMap: cachedL2bZhaoMap, mrzhou: cachedL2bMrzhou };
}

function getHandledReviewIds() {
  const handledSet = new Set();
  if (fs.existsSync(HUMAN_VERIFIED_LOG_PATH)) {
    const lines = fs.readFileSync(HUMAN_VERIFIED_LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const item = JSON.parse(l);
        if (item.review_id) handledSet.add(item.review_id);
      } catch (e) {}
    }
  }
  return handledSet;
}

/**
 * 获取离线增量批次状态: GET /api/l2a/incremental-status
 */
router.get('/l2a/incremental-status', (req, res) => {
  let pointer = {
    as_of: "2026-06-26",
    base_cu_count: 1195,
    has_incremental: false,
    incremental_cu_count: 0,
    latest_date: "2026-06-26"
  };

  if (fs.existsSync(INCR_POINTER_PATH)) {
    try {
      pointer = JSON.parse(fs.readFileSync(INCR_POINTER_PATH, 'utf-8'));
    } catch (e) {}
  }

  res.json({
    base_as_of: "2026-06-26",
    base_cu_count: 1195,
    latest_as_of: pointer.latest_date || pointer.as_of,
    has_incremental: pointer.has_incremental,
    incremental_cu_count: pointer.incremental_cu_count || 0,
    pointer
  });
});

/**
 * 一键刷新已落盘的离线增量批次: POST /api/l2a/reload-offline
 * 纯内存缓存清理与磁盘指针读取，绝不触发模型推理
 */
router.post('/l2a/reload-offline', (req, res) => {
  // 1. 清空内存缓存
  cachedL2aRecords = null;
  cachedL2bZhaoMap = null;
  cachedL2bMrzhou = null;

  // 2. 重新加载
  const allRecords = loadL2aData();
  
  let pointer = { has_incremental: false, latest_date: "2026-06-26", incremental_cu_count: 0 };
  if (fs.existsSync(INCR_POINTER_PATH)) {
    try {
      pointer = JSON.parse(fs.readFileSync(INCR_POINTER_PATH, 'utf-8'));
    } catch (e) {}
  }

  res.json({
    success: true,
    message: pointer.has_incremental ? `成功同步至最新离线批次 (${pointer.latest_date})` : "当前已是最新基础离线批次 (2026-06-26)",
    total_cus: allRecords.length,
    latest_date: pointer.latest_date || "2026-06-26",
    has_incremental: pointer.has_incremental,
    incremental_cu_count: pointer.incremental_cu_count || 0
  });
});

/**
 * 0. 获取可用日期列表与每日统计: GET /api/l2a/dates
 */
router.get('/l2a/dates', (req, res) => {
  const allRecords = loadL2aData();
  const dateMap = new Map();
  let unknownDateCount = 0;

  for (const r of allRecords) {
    const d = r.et_date;
    if (d) {
      if (!dateMap.has(d)) {
        dateMap.set(d, { date: d, cu_count: 0, action_cu_count: 0, empty_cu_count: 0 });
      }
      const stat = dateMap.get(d);
      stat.cu_count++;
      const acts = r.parsed?.actions || [];
      if (acts.length > 0) stat.action_cu_count++;
      else stat.empty_cu_count++;
    } else {
      unknownDateCount++;
    }
  }

  const sortedDates = Array.from(dateMap.keys()).sort();
  const latestDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : '2026-06-26';
  
  const statsObj = {};
  for (const [d, s] of dateMap.entries()) {
    statsObj[d] = s;
  }

  res.json({
    dates: sortedDates,
    default_date: latestDate,
    date_stats: statsObj,
    unknown_date_cu_count: unknownDateCount
  });
});

/**
 * 1. 动作流: GET /api/l2a/today?date=
 * 规则实现 (W7):
 *  - 动作窗: 拆分为单笔动作卡片
 *  - 空窗 (纯观点): 独立为灰卡输出，确保用户在左列可见、可点、可展开原文与联动右列
 */
router.get('/l2a/today', (req, res) => {
  const reqDate = req.query.date || '2026-06-26';
  const allRecords = loadL2aData();
  
  const dateRecords = reqDate === 'unknown'
    ? allRecords.filter(r => !r.et_date)
    : allRecords.filter(r => r.et_date === reqDate);
  
  const stream = [];
  let actionCuCount = 0;
  let emptyCuCount = 0;

  for (const r of dateRecords) {
    const isParseOk = r.parse_ok === true;
    const actions = r.parsed?.actions || [];
    
    if (!isParseOk) {
      stream.push({
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        parse_ok: false,
        is_empty_view: false,
        raw_text: r.raw_text || '',
        raw_error: "模型解析失败或格式异常 (严禁用散文掩盖)",
        actions: []
      });
      continue;
    }

    if (actions.length === 0) {
      emptyCuCount++;
      // W7: 纯观点空窗独立为灰卡
      stream.push({
        action_id: `${r.cu_id}_view_empty`,
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        is_empty_view: true,
        speech_act: r.parsed?.speech_act || 'market_view',
        claims: r.parsed?.claims || [],
        strategy_tags: r.parsed?.strategy_tags || [],
        raw_text: r.raw_text || '',
        parse_ok: true
      });
    } else {
      actionCuCount++;
      for (let idx = 0; idx < actions.length; idx++) {
        const a = actions[idx];
        stream.push({
          action_id: `${r.cu_id}_act_${idx}`,
          cu_id: r.cu_id,
          et_session: r.et_session || 'regular',
          is_empty_view: false,
          ticker: a.ticker,
          action: a.action,
          price: a.price,
          fraction: a.fraction,
          status: a.status === 'filled' ? 'filled_speech' : 'planned',
          instrument: a.instrument,
          condition: a.condition,
          raw_text: r.raw_text || '',
          parse_ok: true
        });
      }
    }
  }
  
  res.json({
    date: reqDate,
    cu_count: dateRecords.length,
    action_cu_count: actionCuCount,
    empty_cu_count: emptyCuCount,
    total_actions: stream.length,
    stream
  });
});

/**
 * 2. 待审池: GET /api/review/queue?date=
 * 规则实现:
 *  - W1: 扣除 l2a_human_verified_actions.jsonl 中已有的 review_id
 *  - W2: 同日同标的若已有 filled 口述成交，planned 解释句不进池 (或被同日成交覆盖)
 *  - 附带完整 raw_text 方便人工溯源
 */
router.get('/review/queue', (req, res) => {
  const reqDate = req.query.date || '2026-06-26';
  const allRecords = loadL2aData();
  const handledReviewIds = getHandledReviewIds();
  const queue = [];

  const dateRecords = reqDate === 'unknown'
    ? allRecords.filter(r => !r.et_date)
    : allRecords.filter(r => r.et_date === reqDate);
  
  // 扫描当日已有 filled 口述成交的标的集合
  const filledTickersToday = new Set();
  for (const r of dateRecords) {
    if (!r.parse_ok) continue;
    const actions = r.parsed?.actions || [];
    for (const a of actions) {
      if (a.status === 'filled' && a.ticker) {
        filledTickersToday.add(a.ticker.toUpperCase());
      }
    }
  }

  for (const r of dateRecords) {
    if (!r.parse_ok) continue;
    const actions = r.parsed?.actions || [];
    
    for (let idx = 0; idx < actions.length; idx++) {
      const a = actions[idx];
      const isPlanned = a.status === 'planned';
      const isTier1HardFill = TIER1_HARD_FILL_CUS.has(r.cu_id);

      if (isPlanned || isTier1HardFill) {
        const reviewId = `${r.cu_id}_${a.ticker}_${a.action}_${a.price || 'null'}_${idx}`;
        
        // W1: 已审核过则排除
        if (handledReviewIds.has(reviewId)) {
          continue;
        }

        // W2: 同日同标的已有 filled 成交，planned 单视为复盘解释句，不进待审池
        if (isPlanned && a.ticker && filledTickersToday.has(a.ticker.toUpperCase())) {
          continue;
        }

        queue.push({
          review_id: reviewId,
          cu_id: r.cu_id,
          et_date: r.et_date || 'unknown',
          et_session: r.et_session || 'regular',
          ticker: a.ticker,
          action: a.action,
          price: a.price,
          fraction: a.fraction,
          status: a.status === 'filled' ? 'filled_speech' : 'planned',
          instrument: a.instrument,
          condition: a.condition,
          raw_text: r.raw_text || '',
          is_tier1_supplement: isTier1HardFill,
          review_status: 'pending_human_ack'
        });
      }
    }
  }
  
  res.json({
    date: reqDate,
    total_pending: queue.length,
    queue
  });
});

/**
 * 2.1 待审动作提交: POST /api/review/action
 */
router.post('/review/action', (req, res) => {
  const { review_id, cu_id, decision } = req.body;
  
  if (!['ack', 'dismiss'].includes(decision)) {
    return res.status(400).json({ error: "decision 必须为 ack 或 dismiss" });
  }
  
  const logEntry = {
    review_id,
    cu_id,
    decision,
    status: decision === 'ack' ? 'human_verified' : 'human_dismissed',
    timestamp_utc: new Date().toISOString(),
    is_live_order: false
  };
  
  fs.appendFileSync(HUMAN_VERIFIED_LOG_PATH, JSON.stringify(logEntry) + '\n', 'utf-8');
  
  res.json({
    success: true,
    result: logEntry
  });
});

/**
 * 3. 闸门与风控徽章: GET /api/l2b/gates?cu_id=&date=
 * 规则实现 (W4):
 *  - 若指定 cu_id，只返回该 cu_id 命中的战法
 *  - 若未指定 cu_id 但指定 date，返回该日命中的所有战法
 *  - 仅当明确 ALL 且无 date 时才返回全局列表
 */
router.get('/l2b/gates', (req, res) => {
  const { cu_id, date } = req.query;
  const { zhaoMap, mrzhou } = loadL2bData();
  
  let zhaoHits = [];
  if (cu_id && cu_id !== 'ALL') {
    zhaoHits = zhaoMap.get(cu_id) || [];
  } else if (date) {
    const allRecords = loadL2aData();
    const dateCuIds = new Set(allRecords.filter(r => r.et_date === date).map(r => r.cu_id));
    for (const [cId, hits] of zhaoMap.entries()) {
      if (dateCuIds.has(cId)) {
        zhaoHits.push(...hits);
      }
    }
  } else {
    zhaoHits = Array.from(zhaoMap.values()).flat();
  }
  
  const mrzhouRegimes = mrzhou.filter(a => a.type === 'regime' || a.kid === 'rule_max_overlapping_3');
  
  res.json({
    cu_id: cu_id || (date ? `DATE:${date}` : 'ALL'),
    zhao_kid_badges: zhaoHits.map(h => ({
      cu_id: h.cu_id,
      kid: h.kid,
      type: h.type,
      matched_phrase: h.matched_phrase,
      evidence_span: h.evidence_span,
      status: h.status,
      do_not_use_as_order: true
    })),
    mrzhou_readonly_gates: {
      is_collapsed_by_default: true,
      gates: mrzhouRegimes.map(m => ({
        kid: m.kid,
        description: m.description,
        status: m.status,
        action: m.action
      }))
    }
  });
});

export default router;
