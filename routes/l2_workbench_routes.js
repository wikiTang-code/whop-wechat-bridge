import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const CLEANED_L2A_PATH = 'data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl';
const L2B_ZHAO_HITS_PATH = 'data/runs/l2b_zhao_kid_hits.jsonl';
const L2B_MRZHOU_PATH = 'data/l2b/mrzhou/atoms.json';
const HUMAN_VERIFIED_LOG_PATH = 'data/runs/l2a_human_verified_actions.jsonl';

// 内存缓存
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
 * 1. 动作流: GET /api/l2a/today?date=2025-10-06
 */
router.get('/l2a/today', (req, res) => {
  const reqDate = req.query.date || '2025-10-06';
  const allRecords = loadL2aData();
  
  // 筛选该日期的 CU
  const dateRecords = allRecords.filter(r => r.et_date === reqDate || (!r.et_date && reqDate === '2025-10-06'));
  
  const stream = [];
  for (const r of dateRecords) {
    const isParseOk = r.parse_ok === true;
    const actions = r.parsed?.actions || [];
    
    if (!isParseOk) {
      stream.push({
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        parse_ok: false,
        raw_error: "模型解析失败或格式异常",
        actions: []
      });
      continue;
    }
    
    for (const a of actions) {
      stream.push({
        cu_id: r.cu_id,
        et_session: r.et_session || 'regular',
        ticker: a.ticker,
        action: a.action,
        price: a.price,
        fraction: a.fraction,
        status: a.status === 'filled' ? 'filled_speech' : 'planned', // 严格标记为口述已成交
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
 * 2. 待审池: GET /api/review/queue
 */
router.get('/review/queue', (req, res) => {
  const allRecords = loadL2aData();
  const queue = [];
  
  for (const r of allRecords) {
    if (!r.parse_ok) continue;
    const actions = r.parsed?.actions || [];
    for (const a of actions) {
      // 仅 planned 与 口述 filled 进待审池
      queue.push({
        review_id: `${r.cu_id}_${a.ticker}_${a.action}`,
        cu_id: r.cu_id,
        et_date: r.et_date,
        et_session: r.et_session,
        ticker: a.ticker,
        action: a.action,
        price: a.price,
        fraction: a.fraction,
        status: a.status === 'filled' ? 'filled_speech' : 'planned',
        instrument: a.instrument,
        condition: a.condition,
        review_status: 'pending_human_ack' // 待人工核准
      });
    }
  }
  
  // 仅取前 50 条作为工作台待审演示
  res.json({
    total_pending: queue.length,
    queue: queue.slice(0, 50)
  });
});

/**
 * 2.1 待审动作: POST /api/review/action
 */
router.post('/review/action', (req, res) => {
  const { review_id, cu_id, decision } = req.body; // decision: 'ack' | 'dismiss'
  
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
  
  const zhaoHits = cu_id ? (zhaoMap.get(cu_id) || []) : Array.from(zhaoMap.values()).flat().slice(0, 25);
  
  // 周哥只读 4 体制 + 叠仓<=3 规则 (默认折叠)
  const mrzhouRegimes = mrzhou.filter(a => a.type === 'regime' || a.kid === 'rule_max_overlapping_3');
  
  res.json({
    cu_id: cu_id || 'ALL',
    zhao_kid_badges: zhaoHits.map(h => ({
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
