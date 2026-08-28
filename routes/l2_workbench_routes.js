import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const CLEANED_L2A_PATH = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const L2B_ZHAO_HITS_PATH = 'data/runs/l2b_zhao_kid_hits.jsonl';
const L2B_MRZHOU_PATH = 'data/l2b/mrzhou/atoms.json';
const HUMAN_VERIFIED_LOG_PATH = 'data/runs/l2a_human_verified_actions.jsonl';

// Tier 1 硬动词 CU 集合（允许进待审池）
const TIER1_HARD_FILL_CUS = new Set(['cu_trade_00955', 'cu_trade_01174']);

let cachedL2aRecords = null;
let cachedL2bZhaoMap = null;
let cachedL2bMrzhou = null;

function loadL2aData() {
  if (cachedL2aRecords) return cachedL2aRecords;
  if (!fs.existsSync(CLEANED_L2A_PATH)) return [];
  const lines = fs.readFileSync(CLEANED_L2A_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  cachedL2aRecords = lines.map(l => JSON.parse(l));
  return cachedL2aRecords;
}

function loadL2bData() {
  if (!cachedL2bZhaoMap) {
    cachedL2bZhaoMap = new Map();
    if (fs.existsSync(L2B_ZHAO_HITS_PATH)) {
      const lines = fs.readFileSync(L2B_ZHAO_HITS_PATH, 'utf-8').trim().split('\n').filter(Boolean);
      for (const l of lines) {
        const item = JSON.parse(l);
        if (!cachedL2bZhaoMap.has(item.cu_id)) cachedL2bZhaoMap.set(item.cu_id, []);
        cachedL2bZhaoMap.get(item.cu_id).push(item);
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

/**
 * 0. 获取可用日期列表: GET /api/l2a/dates
 */
router.get('/l2a/dates', (req, res) => {
  const allRecords = loadL2aData();
  const dateSet = new Set();
  let unknownDateCount = 0;

  for (const r of allRecords) {
    if (r.et_date) {
      dateSet.add(r.et_date);
    } else {
      unknownDateCount++;
    }
  }

  const sortedDates = Array.from(dateSet).sort();
  res.json({
    dates: sortedDates,
    default_date: sortedDates[0] || '2025-10-06',
    unknown_date_cu_count: unknownDateCount
  });
});

/**
 * 1. 动作流: GET /api/l2a/today?date=2025-10-06
 */
router.get('/l2a/today', (req, res) => {
  const reqDate = req.query.date || '2025-10-06';
  const allRecords = loadL2aData();
  
  // 严格按日期过滤，无日期单独处理，不混入
  const dateRecords = reqDate === 'unknown'
    ? allRecords.filter(r => !r.et_date)
    : allRecords.filter(r => r.et_date === reqDate);
  
  const stream = [];
  for (const r of dateRecords) {
    const isParseOk = r.parse_ok === true;
    const actions = r.parsed?.actions || [];
    
    if (!isParseOk) {
      stream.push({
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        parse_ok: false,
        raw_error: "模型解析失败或格式异常 (严禁用散文掩盖)",
        actions: []
      });
      continue;
    }
    
    for (let idx = 0; idx < actions.length; idx++) {
      const a = actions[idx];
      stream.push({
        action_id: `${r.cu_id}_act_${idx}`,
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        ticker: a.ticker,
        action: a.action,
        price: a.price,
        fraction: a.fraction,
        status: a.status === 'filled' ? 'filled_speech' : 'planned',
        instrument: a.instrument,
        condition: a.condition,
        parse_ok: true
      });
    }
  }
  
  res.json({
    date: reqDate,
    total_actions: stream.length,
    stream
  });
});

/**
 * 2. 待审池: GET /api/review/queue?date=2025-10-06
 * 严格收敛：仅收录指定日期的 planned 意图单 + Tier1 硬成交单
 * 口述 filled_speech 默认不进池，避免污染
 */
router.get('/review/queue', (req, res) => {
  const reqDate = req.query.date || '2025-10-06';
  const allRecords = loadL2aData();
  const queue = [];

  const dateRecords = reqDate === 'unknown'
    ? allRecords.filter(r => !r.et_date)
    : allRecords.filter(r => r.et_date === reqDate);
  
  for (const r of dateRecords) {
    if (!r.parse_ok) continue;
    const actions = r.parsed?.actions || [];
    
    for (let idx = 0; idx < actions.length; idx++) {
      const a = actions[idx];
      const isPlanned = a.status === 'planned';
      const isTier1HardFill = TIER1_HARD_FILL_CUS.has(r.cu_id);

      // 仅 planned 和 Tier1 硬动词进入待审池
      if (isPlanned || isTier1HardFill) {
        queue.push({
          review_id: `${r.cu_id}_${a.ticker}_${a.action}_${a.price || 'null'}_${idx}`, // 唯一防撞 ID
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
    is_live_order: false // 绝不打券商
  };
  
  fs.appendFileSync(HUMAN_VERIFIED_LOG_PATH, JSON.stringify(logEntry) + '\n', 'utf-8');
  
  res.json({
    success: true,
    result: logEntry
  });
});

/**
 * 3. 闸门与风控徽章: GET /api/l2b/gates?cu_id=
 */
router.get('/l2b/gates', (req, res) => {
  const { cu_id } = req.query;
  const { zhaoMap, mrzhou } = loadL2bData();
  
  const zhaoHits = (cu_id && cu_id !== 'ALL')
    ? (zhaoMap.get(cu_id) || [])
    : Array.from(zhaoMap.values()).flat();
  
  const mrzhouRegimes = mrzhou.filter(a => a.type === 'regime' || a.kid === 'rule_max_overlapping_3');
  
  res.json({
    cu_id: cu_id || 'ALL',
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
