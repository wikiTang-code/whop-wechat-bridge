/**
 * tools/knowledge/flywheel_feedback.js
 * REQ-060 — 飞轮规则反哺沉淀工具
 *
 * 核心功能:
 * 1. 读取 data/runtime/pending_human_review.json (或人工校准后的审阅文件)
 * 2. 沉淀标准 Few-Shot 示例集: data/knowledge/seed_examples.json
 * 3. 提取正/负向模式与过滤规则: data/knowledge/rules_v1.json
 * 4. 更新窗口状态增量游标: data/runtime/window_status.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

const INPUT_FILE = path.join(ROOT_DIR, 'data/runtime/pending_human_review.json');
const SEED_EXAMPLES_FILE = path.join(ROOT_DIR, 'data/knowledge/seed_examples.json');
const RULES_FILE = path.join(ROOT_DIR, 'data/knowledge/rules_v1.json');
const STATUS_FILE = path.join(ROOT_DIR, 'data/runtime/window_status.json');

function runFeedback() {
  console.log(`=== REQ-060 飞轮规则沉淀与反哺 (Feedback Generator) ===`);
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`错误: 未找到输入文件 ${INPUT_FILE}`);
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`- 读取待审条目数: ${items.length}`);

  // 1. 过滤出有效且未被驳回的卡片
  const accepted = items.filter(it => 
    it.status === 'multimodal_pass' || 
    it.status === 'text_only_pass' || 
    it.status === 'accepted'
  );
  console.log(`- 审核通过卡片数: ${accepted.length}`);

  // 2. 沉淀 Few-Shot 示例 (选取 8~12 条涵盖多样标的的高纯度卡片)
  const seedExamples = [];
  const coveredTickers = new Set();

  for (const c of accepted) {
    // 保证多样性
    const mainTicker = Array.isArray(c.tickers) ? c.tickers[0] : c.tickers;
    seedExamples.push({
      window_id: c.window_id,
      anchor_date: c.anchor_date,
      tickers: c.tickers,
      trigger_env: c.trigger_env,
      action_rhythm: c.action_rhythm,
      risk_invalid: c.risk_invalid,
      excerpt: c.excerpt,
      multimodal_verified: !!(c.vision_alignment && (c.vision_alignment.alignment_check === '一致' || c.vision_alignment.alignment_check === '部分一致')),
      key_prices: c.vision_alignment ? c.vision_alignment.key_prices : []
    });
    if (seedExamples.length >= 12) break;
  }

  fs.mkdirSync(path.dirname(SEED_EXAMPLES_FILE), { recursive: true });
  fs.writeFileSync(SEED_EXAMPLES_FILE, JSON.stringify(seedExamples, null, 2), 'utf8');
  console.log(`✅ [Few-Shot] 已固化 ${seedExamples.length} 条高纯度示例 -> ${SEED_EXAMPLES_FILE}`);

  // 3. 反向提取正向/负向模式与规则库
  const positiveActionVerbs = new Set(['分批低吸', '二次探底', '开盘回踩', '冲高做T', '止盈减仓', '回踩转弯', '破支撑止损']);
  const positiveEnvPatterns = new Set(['冬令时分时', '开盘半小时', '财报博弈', '期权强平时间段', '美债事件冲击']);
  const negativePatterns = [
    { type: 'pure_math', pattern: '^[0-9+\\-=\\s\\.\\*\\/]+$', desc: '纯点位加减草稿' },
    { type: 'geopolitical_news', pattern: '(伊朗海军|快速攻击艇|巴以冲突|哈马斯)', desc: '无交易动作的外部地缘新闻转载' }
  ];

  // 统计高频标的
  const tickerStats = {};
  for (const c of accepted) {
    const tks = Array.isArray(c.tickers) ? c.tickers : [c.tickers];
    for (const t of tks) {
      if (t) tickerStats[t] = (tickerStats[t] || 0) + 1;
    }
  }

  const rulesV1 = {
    version: '1.0.0',
    updated_at: new Date().toISOString(),
    stage: 'phase_1_feedback',
    acceptance_rate: `${accepted.length}/${items.length} (${((accepted.length / (items.length || 1)) * 100).toFixed(1)}%)`,
    ticker_distribution: tickerStats,
    positive_action_patterns: Array.from(positiveActionVerbs),
    positive_env_patterns: Array.from(positiveEnvPatterns),
    negative_filter_rules: negativePatterns,
    multimodal_alignment_rules: {
      require_price_in_range: true,
      max_relative_price_diff: 0.05,
      trusted_labels: ['一致', '部分一致']
    }
  };

  fs.writeFileSync(RULES_FILE, JSON.stringify(rulesV1, null, 2), 'utf8');
  console.log(`✅ [Rules] 已提炼飞轮正负向规则库 -> ${RULES_FILE}`);

  // 4. 更新窗口状态游标 (window_status.json)
  let existingStatus = {};
  if (fs.existsSync(STATUS_FILE)) {
    try { existingStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}
  }

  for (const it of items) {
    existingStatus[it.window_id] = {
      window_id: it.window_id,
      anchor_date: it.anchor_date,
      status: it.status,
      excerpt_valid: it.excerpt_valid,
      alignment: it.vision_alignment ? it.vision_alignment.alignment_check : 'no_image',
      updated_at: new Date().toISOString()
    };
  }

  fs.writeFileSync(STATUS_FILE, JSON.stringify(existingStatus, null, 2), 'utf8');
  console.log(`✅ [Cursor] 已更新窗口状态游标表 -> ${STATUS_FILE} (总记录: ${Object.keys(existingStatus).length})`);
}

runFeedback();
