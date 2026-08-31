import fs from 'fs';
import path from 'path';

console.log('========================================================================================');
console.log('🧪 执行 L2b 20 窗战法口诀「带完整 raw_text、去加词、禁止 BUY/SELL」小样产出');
console.log('========================================================================================\n');

const inputLines = fs.readFileSync('data/samples/l2b_dry_cut_20.jsonl', 'utf-8').trim().split('\n').filter(Boolean);

const extractionResults = [];

inputLines.forEach((line, idx) => {
  const w = JSON.parse(line);

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
    chart_notes: chartNotes,
    context_stale: w.context_stale || false,
    is_same_feed: w.is_same_feed,
    raw_text: w.raw_text, // 挂载完整切窗原文
    dialogue_messages: w.dialogue_messages, // 挂载结构化对话
    not: w.not || [],
    status: "proposed",
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
const outPath = 'data/samples/l2b_knowledge_extracted_20.jsonl';
const outContent = extractionResults.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(outPath, outContent, 'utf-8');

console.log(`✅ 成功落盘 20 窗带 raw_text 知识小样: ${path.resolve(outPath)} (共 ${extractionResults.length} 条)`);
console.log('========================================================================================');
console.log('📋 20 窗带 raw_text「无加词、只抽 statement、禁止 BUY/SELL」清单全景核验:');
console.log('========================================================================================');

console.log('序号 | CU ID | 规范 kid | 状态 | 严禁下单锁 | 抽取的战法口诀 statement');
console.log('-----|-------|----------|------|------------|----------------------------------------------------');
extractionResults.forEach((r, i) => {
  const num = String(i + 1).padStart(2, '0');
  console.log(`${num} | ${r.cu_id} | ${r.kid.padEnd(25)} | ${r.status} | ${r.do_not_use_as_order ? '🔒 锁死' : '❌ 未锁'} | ${r.statement}`);
});
console.log('========================================================================================\n');
