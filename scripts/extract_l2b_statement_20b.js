import fs from 'fs';
import path from 'path';

console.log('========================================================================================');
console.log('🧪 执行 L2b 20b 精准定级抽取 (11条 proposed 抽 statement，6条弱项标 skip，3条重叠标 context_supplement)');
console.log('========================================================================================\n');

// 20b 详细定级映射表 (严格对应 l2b_20b_grade.md)
const L2B_20B_GRADE_MAP = {
  1: { grade: 'proposed', reason: '公式区 NBIS 反弹一半测算实例' },
  2: { grade: 'skip', reason: 'OKLO 单票突破，留样本不当卡' },
  3: { grade: 'proposed', reason: '公式区 HOOD (109+70)/2=89 反弹一半实例' },
  4: { grade: 'proposed', reason: '公式区 TSLL 减派息 17.55 一半位置出一半实例' },
  5: { grade: 'proposed', reason: '公式区 亚马逊 (244+196)/2=220 反弹一半实例' },
  6: { grade: 'context_supplement', reason: '今天先多后空，作为日内节奏观察补充，不挂周五标签' },
  7: { grade: 'skip', reason: '7640 极限点与当日波动值，留样本不当卡' },
  8: { grade: 'proposed', reason: '每天维持有异动涨幅止盈，急跌收集低位筹码吸' },
  9: { grade: 'context_supplement', reason: 'G4 邻帖财报资讯看增长小幅分批出，属 20a-001 上下文补充' },
  10: { grade: 'proposed', reason: '减持回流高低切 (带 8 月真图)' },
  11: { grade: 'proposed', reason: '强势股看 QQQ 转弯低吸 (带 8 月真图)' },
  12: { grade: 'proposed', reason: '都普跌时急跌买占仓位，指数普涨看顶点抛' },
  13: { grade: 'skip', reason: '7700/7650 当日点位报数，留样本不当卡' },
  14: { grade: 'skip', reason: 'CONL 3.9 单票特定仓位流水，留样本不当卡' },
  15: { grade: 'context_supplement', reason: '横盘吃磨损与急跌吸个股，属磨损补充' },
  16: { grade: 'proposed', reason: '开盘多轮次与尾盘空轮次低吸' },
  17: { grade: 'skip', reason: '西数 422 缺口与 QQQ 700 关口，留样本不当卡' },
  18: { grade: 'proposed', reason: '急跌买一份，异动多出一半（6%出一半再涨6%出一半），横盘不操作' },
  19: { grade: 'skip', reason: '中选政策急跌转弯当日评论，留样本不当卡' },
  20: { grade: 'proposed', reason: '杠杆去化与减持回流期间，每天拉开价差分批次低吸' }
};

const inputLines = fs.readFileSync('data/samples/l2b_dry_cut_20b.jsonl', 'utf-8').trim().split('\n').filter(Boolean);

const extractionResults = [];

inputLines.forEach((line, idx) => {
  const w = JSON.parse(line);
  const gradeMeta = L2B_20B_GRADE_MAP[idx + 1] || { grade: 'proposed', reason: '待审' };

  // 1. 严格提取证据连续子串
  const rawText = w.raw_text;
  const evidenceSpan = w.evidence_span;
  if (!rawText.includes(evidenceSpan)) {
    throw new Error(`❌ CU ${w.cu_id} 证据子串不在 raw_text 中: "${evidenceSpan}"`);
  }

  // 2. 战法知识口诀 statement (忠实原文，无加戏，无 BUY/SELL)
  const statement = w.statement;

  // 3. 构建 chart_notes
  let chartNotes = {
    has_image: false,
    aligns_with_text: "no_image",
    local_path: "no_image",
    sha: "no_image"
  };

  if (w.has_real_image && w.images && w.images.length > 0) {
    const primaryImg = w.images[0];
    chartNotes = {
      has_image: true,
      aligns_with_text: `配图命中 post [${primaryImg.post_id}]，共关联 ${w.images.length} 张真图，主图对应 ${w.seed_label || primaryImg.post_caption || '战法走势图'}`,
      local_path: primaryImg.local_path,
      sha: primaryImg.image_sha,
      image_count: w.images.length
    };
  }

  // 4. 组装 L2b 知识原子产物 (包含完整 raw_text，绝对禁止 BUY / SELL / ORDER 动作)
  const knowledgeRecord = {
    cu_id: w.cu_id,
    post_id: w.post_id,
    feed_id: w.feed_id,
    channel_name: w.channel_name,
    et_date: w.et_date,
    kid: w.kid,
    type: "playbook",
    statement: statement,
    evidence_span: evidenceSpan,
    matched_phrase: w.kid.startsWith('k_') ? w.kid : '战法口诀',
    grade: gradeMeta.grade, // proposed / skip / context_supplement
    grade_reason: gradeMeta.reason,
    chart_notes: chartNotes,
    context_stale: w.context_stale || false,
    is_same_feed: w.is_same_feed,
    raw_text: w.raw_text,
    dialogue_messages: w.dialogue_messages,
    not: w.not || [],
    status: gradeMeta.grade === 'proposed' ? 'proposed' : (gradeMeta.grade === 'skip' ? 'skip' : 'context_supplement'),
    do_not_use_as_order: true, // 绝对硬锁：禁止作为订单执行
    created_at: Date.now()
  };

  // 校验禁止项
  const jsonStr = JSON.stringify(knowledgeRecord);
  if (jsonStr.includes('"action":"BUY"') || jsonStr.includes('"action":"SELL"') || jsonStr.includes('"actions":[')) {
    throw new Error(`❌ 严重违背纪律: 包含交易动作`);
  }

  extractionResults.push(knowledgeRecord);
});

// 5. 落盘独立产物文件
const outPath = 'data/samples/l2b_knowledge_extracted_20b.jsonl';
const outContent = extractionResults.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(outPath, outContent, 'utf-8');

console.log(`✅ 成功落盘 20b 知识小样: ${path.resolve(outPath)} (共 ${extractionResults.length} 条)`);
console.log('========================================================================================');
console.log('📋 20b 带定级「11条 proposed、6条 skip、3条 context_supplement」全景核验表:');
console.log('========================================================================================');

console.log('序号 | CU ID | 规范 kid | 定级状态 | 下单锁 | 抽取的战法口诀 statement');
console.log('-----|-------|----------|----------|--------|----------------------------------------------------');
extractionResults.forEach((r, i) => {
  const num = String(i + 1).padStart(2, '0');
  const gradeLabel = r.grade === 'proposed' ? '🥈 proposed' : (r.grade === 'skip' ? '⚪ skip' : '🟡 supplement');
  console.log(`${num} | ${r.cu_id} | ${r.kid.padEnd(22)} | ${gradeLabel.padEnd(13)} | ${r.do_not_use_as_order ? '🔒 锁死' : '❌ 未锁'} | ${r.statement}`);
});
console.log('========================================================================================\n');
