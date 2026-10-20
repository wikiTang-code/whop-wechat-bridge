/**
 * tools/knowledge/flywheel_window_pipeline.js
 * REQ-060 — 全量分步飞轮战法蒸馏与图文对齐流水线 (Phase 1 种子落地)
 *
 * 核心设计:
 * 1. 阶段 0: 基于长文锚点 + 时间窗口切片 ([-2h, +6h]) + 本地真实图片映射
 * 2. 阶段 1:
 *    - 文本端: 本地 WSL2 :8080 LLM (Qwen2.5-Coder) + Few-Shot + 严格 Schema
 *    - 硬校验: excerpt 必须包含于窗口原文，无自由幻觉
 *    - 视觉端: 云端 gemini-3.5-flash-lite 执行图文对齐校验 (一致/部分一致/冲突/无法对应)
 * 3. 产物落盘: data/runtime/pending_human_review.json 与审阅报告
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const DB_PATH = path.join(ROOT_DIR, 'whop_archive.db');
const MEDIA_DIR = path.join(ROOT_DIR, 'data/media/zhao');

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const hasFlag = (flag) => args.includes(flag);

const LIMIT = parseInt(getArg('--limit', '20'), 10);
const DRY_RUN = hasFlag('--dry-run');
const LOCAL_LLM_URL = getArg('--local-llm', 'http://127.0.0.1:8080/v1/chat/completions');
const VISION_MODEL = getArg('--vision-model', 'gemini-3.5-flash-lite');
const OUTPUT_FILE = getArg('--output', path.join(ROOT_DIR, 'data/runtime/pending_human_review.json'));
const REPORT_FILE = path.join(ROOT_DIR, 'data/runtime/phase1_review_manifest.md');

// 核心已知标的
const KNOWN_TICKERS = [
  'TSLA', 'TSLL', 'NVDA', 'NVDL', 'SOXL', 'SOXS', 'IREN', 'CRWV', 'MU', 
  'COHR', 'LITE', 'COIN', 'CONL', 'NBIS', 'CIFR', 'QQQ', 'SPY', 'AAPL', 
  'AMZN', 'GOOGL', 'META', 'RKLB', 'AVGO', 'BTC', 'MSTR', 'MSTX'
];

function cleanText(raw) {
  if (!raw) return '';
  return raw.replace(/\[IMAGE:[^\]]+\]/g, '').replace(/https?:\/\/\S+/g, '').trim();
}

function extractTickers(text) {
  if (!text) return [];
  const found = new Set();
  for (const tk of KNOWN_TICKERS) {
    const reg = new RegExp(`\\b${tk}\\b`, 'i');
    if (reg.test(text)) found.add(tk.toUpperCase());
  }
  if (/(特斯拉)/.test(text)) found.add('TSLA');
  if (/(美光)/.test(text)) found.add('MU');
  if (/(英伟达)/.test(text)) found.add('NVDA');
  if (/(大饼|比特币)/.test(text)) found.add('BTC');
  if (/(以太|二饼)/.test(text)) found.add('ETH');
  return Array.from(found);
}

function isNoise(text) {
  if (!text) return true;
  if (/^[0-9+\-=\s\.\*\/]+$/.test(text)) return true; // 纯算式草稿
  if (/(伊朗海军|快速攻击艇|巴以冲突|哈马斯)/.test(text) && text.length < 200) return true; // 外部地缘新闻
  return false;
}

// 加载图片映射清单
function loadMediaMap() {
  const manifestPath = path.join(MEDIA_DIR, 'media_manifest.json');
  const map = new Map();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const item of manifest) {
        if (item.message_id && item.local_path && item.bytes > 15360) {
          const fullPath = path.join(ROOT_DIR, item.local_path);
          if (fs.existsSync(fullPath)) {
            if (!map.has(item.message_id)) map.set(item.message_id, []);
            map.get(item.message_id).push(item.local_path);
          }
        }
      }
    } catch (e) {
      console.warn('[Phase 0] 警告: 加载 media_manifest.json 失败:', e.message);
    }
  }
  return map;
}

// 阶段 0: 切片生成与索引
function generateCandidateWindows() {
  console.log(`[Phase 0] 读取数据库: ${DB_PATH}`);
  const mediaMap = loadMediaMap();
  console.log(`[Phase 0] 加载真实图片映射数: ${mediaMap.size} 条消息`);

  const db = new Database(DB_PATH, { readonly: true });
  
  // 严格大V身份硬锁
  const rows = db.prepare(`
    SELECT id, created_at, content, attachments
    FROM messages
    WHERE sender_id='user_4yeplXgbguTu4'
    ORDER BY created_at ASC
  `).all();
  db.close();

  console.log(`[Phase 0] 赵哥有效发言总数: ${rows.length}`);

  const indexed = [];
  for (const r of rows) {
    const pure = cleanText(r.content);
    let hasImage = false;
    let localImagePaths = [];

    // 优先从 media_manifest 获取
    if (mediaMap.has(r.id)) {
      hasImage = true;
      localImagePaths = mediaMap.get(r.id);
    } else {
      // 兼容 attachments 字段
      try {
        const atts = JSON.parse(r.attachments || '[]');
        for (const a of atts) {
          if (a.local_path) {
            const fullPath = path.join(ROOT_DIR, a.local_path);
            if (fs.existsSync(fullPath) && (a.bytes || fs.statSync(fullPath).size) > 15360) {
              hasImage = true;
              localImagePaths.push(a.local_path);
            }
          }
        }
      } catch {}
    }

    indexed.push({
      id: r.id,
      ts: r.created_at,
      content: pure,
      raw: r.content,
      len: pure.length,
      hasImage,
      localImagePaths,
      tickers: extractTickers(pure),
      noise: isNoise(pure)
    });
  }

  // 纯文本 >= 100 且非噪声作为锚点
  const anchors = indexed.filter(m => m.len >= 100 && !m.noise);
  console.log(`[Phase 0] 识别高价值长文锚点数: ${anchors.length}`);

  const windows = [];
  const usedAnchorIds = new Set();

  for (const a of anchors) {
    if (usedAnchorIds.has(a.id)) continue;

    const windowStart = a.ts - 2 * 3600 * 1000; // 前 2 小时
    const windowEnd = a.ts + 6 * 3600 * 1000;   // 后 6 小时

    const windowMsgs = indexed.filter(m => m.ts >= windowStart && m.ts <= windowEnd && !m.noise);
    if (windowMsgs.length === 0) continue;

    const allTickers = new Set();
    const allImages = [];
    let textDensity = 0;
    const textPieces = [];

    for (const wm of windowMsgs) {
      wm.tickers.forEach(t => allTickers.add(t));
      if (wm.hasImage) allImages.push(...wm.localImagePaths);
      if (wm.len >= 50) textDensity++;
      if (wm.len > 0) textPieces.push(wm.content);
    }

    const tickerArr = Array.from(allTickers);
    // 标的数量在 1~5 之间，避免宽泛水群
    if (tickerArr.length >= 1 && tickerArr.length <= 5) {
      windowMsgs.forEach(m => { if (m.len >= 100) usedAnchorIds.add(m.id); });

      // 组装窗口综合文本：去重连续相同内容，截取最多 2500 字
      const uniqueTexts = [];
      const seenTexts = new Set();
      for (const t of textPieces) {
        const trimmed = t.trim();
        if (!seenTexts.has(trimmed)) {
          seenTexts.add(trimmed);
          uniqueTexts.push(trimmed);
        }
      }
      const combinedText = uniqueTexts.join('\n---\n').slice(0, 2500);

      windows.push({
        window_id: `win_${a.id}`,
        anchor_msg_id: a.id,
        anchor_date: new Date(a.ts).toISOString().slice(0, 10),
        time_start: windowStart,
        time_end: windowEnd,
        has_image: allImages.length > 0,
        image_count: allImages.length,
        image_paths: Array.from(new Set(allImages)).slice(0, 2), // 最多前 2 张代表图
        tickers: tickerArr,
        text_density: textDensity,
        msg_count: windowMsgs.length,
        anchor_content: a.content,
        combined_text: combinedText
      });
    }
  }

  // 排序：优先有图 > 文本密度高 > 时间倒序 (近优先)
  windows.sort((a, b) => {
    if (a.has_image !== b.has_image) return a.has_image ? -1 : 1;
    if (a.text_density !== b.text_density) return b.text_density - a.text_density;
    return b.time_start - a.time_start;
  });

  return windows;
}

// 阶段 1: 本地 LLM 战法提取
async function extractStrategyLocalLLM(window) {
  const prompt = `你是一个资深美股量化与交易策略分析师。请对以下交易员的一组发言切片进行战法结构化提取。
【重要约束】
1. excerpt 必须且只能是直接从【发言原文】中原样复制出来的一句连续原话（禁止任何改写、拼凑或概括总结！必须一字不差！）。
2. tickers 必须提取原文中提及的所有美股/期权/指数代码（包括 SOXL, SOXS, TSLA, NVDA 等杠杆ETF和正股）。
3. 如果这组发言主要是闲聊、无明确交易时机或没有战术指导意义，valid 输出 false。

【Few-Shot 范例】
发言原文：
周五盘前低点价格可以分2次加的点 一次盘前低点附近 一次盘中结算put的时候 tsll 15.6 rklb 38 仓位不要超过3成
输出：
{
  "valid": true,
  "tickers": ["TSLL", "RKLB"],
  "trigger_env": "周五盘前低点及盘中结算put时段",
  "action_rhythm": "分2次加仓：一次盘前低点附近，一次盘中结算时",
  "risk_invalid": "仓位不要超过3成",
  "excerpt": "周五盘前低点价格可以分2次加的点 一次盘前低点附近 一次盘中结算put的时候 tsll 15.6 rklb 38"
}

请对以下发言切片进行提取：
${window.combined_text}
`;

  try {
    const res = await fetch(LOCAL_LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });
    if (!res.ok) {
      return { valid: false, error: `Local LLM HTTP ${res.status}` };
    }
    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawContent);
    return parsed;
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// 阶段 1: 多模态视觉图文对齐校验 (Gemini 3.5 Flash-Lite)
async function verifyVisionAlignment(imageRelPath, textDistill) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { alignment_check: '未执行', reason: '缺少 GEMINI_API_KEY' };
  }

  const fullImgPath = path.join(ROOT_DIR, imageRelPath);
  if (!fs.existsSync(fullImgPath)) {
    return { alignment_check: '无法对应', reason: `图片文件未找到: ${imageRelPath}` };
  }

  const imgBase64 = fs.readFileSync(fullImgPath).toString('base64');
  const mimeType = imageRelPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `你是一个资深美股技术分析与交易图表专家。请审核该交易截图与交易员随附的战法语录是否一致对齐。

【交易员文本提取】
- 标的: ${JSON.stringify(textDistill.tickers)}
- 动作节奏: ${textDistill.action_rhythm}
- 核心原句: "${textDistill.excerpt}"

请仔细分析图表并严格输出以下 JSON：
{
  "chart_type": "candlestick|trendline|order_flow|other",
  "detected_ticker": "图上标的代码，如无法识别填 UNKNOWN",
  "key_prices": [图上标注的支撑/阻力/现价值],
  "alignment_check": "一致" | "部分一致" | "冲突" | "无法对应",
  "alignment_reason": "简明解释图表与文本中提及的标的/点位/方向是否匹配"
}
`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imgBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json'
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      return { alignment_check: '未执行', reason: `Vision API HTTP ${res.status}: ${errText.slice(0, 100)}` };
    }
    const data = await res.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(rawContent);
  } catch (err) {
    return { alignment_check: '未执行', reason: err.message };
  }
}

// 主流程
async function run() {
  console.log(`=== REQ-060 全量分步飞轮蒸馏与图文对齐流水线 (Phase 1) ===`);
  console.log(`- 目标窗口上限: ${LIMIT}`);
  console.log(`- 本地 LLM 地址: ${LOCAL_LLM_URL}`);
  console.log(`- 视觉模型: ${VISION_MODEL}`);
  console.log(`- Dry-Run 模式: ${DRY_RUN}`);

  const allWindows = generateCandidateWindows();
  console.log(`[Phase 0] 候选种子窗口生成总数: ${allWindows.length}`);
  const seedWindows = allWindows.slice(0, LIMIT);

  if (DRY_RUN) {
    console.log(`[Dry-Run] 预览前 3 个种子窗口:`);
    console.dir(seedWindows.slice(0, 3), { depth: 2 });
    return;
  }

  const reviewResults = [];
  let successCount = 0;
  let textValidCount = 0;
  let multimodalPassCount = 0;

  for (let i = 0; i < seedWindows.length; i++) {
    const win = seedWindows[i];
    console.log(`\n------------------------------------------------------------`);
    console.log(`[${i + 1}/${seedWindows.length}] 处理窗口 ${win.window_id} (${win.anchor_date}) | 标的: ${win.tickers.join(',')} | 图片数: ${win.image_count}`);

    // Step 1: 本地 LLM 战法提取
    process.stdout.write(`  [1/3] 本地 LLM 结构化提取... `);
    const textRes = await extractStrategyLocalLLM(win);

    if (!textRes.valid) {
      console.log(`❌ 过滤 (valid=false 或 报错: ${textRes.error || '无指导意义'})`);
      reviewResults.push({
        window_id: win.window_id,
        anchor_date: win.anchor_date,
        tickers: win.tickers,
        status: 'filtered_invalid',
        reason: textRes.error || '文本无明确战法',
        raw_anchor: win.anchor_content
      });
      continue;
    }
    textValidCount++;
    console.log(`✅ 有效战法! 标的: ${JSON.stringify(textRes.tickers)}`);

    // Step 2: 代码硬校验 excerpt 存在性
    let excerptValid = win.combined_text.includes(textRes.excerpt);
    let excerptNote = '原文匹配一致';
    if (!excerptValid) {
      // 容错：去除空格后比较
      const normAll = win.combined_text.replace(/\s+/g, '');
      const normExcerpt = (textRes.excerpt || '').replace(/\s+/g, '');
      if (normAll.includes(normExcerpt)) {
        excerptValid = true;
        excerptNote = '去空格后匹配一致';
      } else {
        excerptNote = '⚠️ 模型存在轻度概括改写';
      }
    }
    console.log(`  [2/3] 原文摘录硬校验: ${excerptValid ? '✅ ' + excerptNote : '⚠️ ' + excerptNote}`);

    // Step 3: 多模态图文对齐校验
    let visionRes = null;
    let gateStatus = 'text_only_pass';

    if (win.has_image && win.image_paths.length > 0) {
      const targetImg = win.image_paths[0];
      process.stdout.write(`  [3/3] 视觉多模态对齐 (${targetImg})... `);
      visionRes = await verifyVisionAlignment(targetImg, textRes);
      console.log(`对齐结果: [${visionRes.alignment_check || '未知'}] - ${visionRes.alignment_reason || ''}`);

      if (visionRes.alignment_check === '一致' || visionRes.alignment_check === '部分一致') {
        gateStatus = 'multimodal_pass';
        multimodalPassCount++;
      } else if (visionRes.alignment_check === '冲突') {
        gateStatus = 'downgraded_conflict';
      } else {
        gateStatus = 'text_pass_vision_unmatched';
      }
    } else {
      console.log(`  [3/3] 无图窗口，文本通过`);
    }

    successCount++;
    reviewResults.push({
      window_id: win.window_id,
      anchor_date: win.anchor_date,
      tickers: textRes.tickers || win.tickers,
      status: gateStatus,
      trigger_env: textRes.trigger_env,
      action_rhythm: textRes.action_rhythm,
      risk_invalid: textRes.risk_invalid,
      excerpt: textRes.excerpt,
      excerpt_valid: excerptValid,
      image_path: win.image_paths[0] || null,
      vision_alignment: visionRes,
      raw_anchor: win.anchor_content
    });

    // 适度冷却 1 秒，保持网络和 API 稳定
    await new Promise(r => setTimeout(r, 1000));
  }

  // 写入 JSON 待审清单
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reviewResults, null, 2), 'utf8');
  console.log(`\n============================================================`);
  console.log(`[完成] 审阅数据已落盘: ${OUTPUT_FILE}`);
  console.log(`- 候选窗口数: ${seedWindows.length}`);
  console.log(`- 文本提取通过数: ${textValidCount}`);
  console.log(`- 多模态图文一致数: ${multimodalPassCount}`);

  // 生成 Markdown 审阅报告
  generateMarkdownReport(reviewResults, REPORT_FILE);
  console.log(`[完成] 可视化审阅报告已生成: ${REPORT_FILE}`);
}

function generateMarkdownReport(results, reportPath) {
  let md = `# REQ-060 阶段 1 种子窗口结构化蒸馏与图文对齐待审清单\n\n`;
  md += `> **生成时间**: ${new Date().toISOString()}  \n`;
  md += `> **总处理窗口**: ${results.length} 篇 | **待人类判定**: accept / revise / reject\n\n`;
  md += `| 编号 | 窗口ID | 日期 | 核心标的 | 状态 | 图文对齐 | 动作节奏简述 |\n`;
  md += `|---|---|:---:|:---:|:---:|:---:|---|\n`;

  results.forEach((r, idx) => {
    const align = r.vision_alignment ? r.vision_alignment.alignment_check : '无图';
    const rhythm = (r.action_rhythm || r.reason || '').slice(0, 30);
    md += `| ${idx + 1} | \`${r.window_id}\` | ${r.anchor_date} | ${Array.isArray(r.tickers) ? r.tickers.join(', ') : r.tickers} | \`${r.status}\` | ${align} | ${rhythm} |\n`;
  });

  md += `\n---\n\n## 详细抽取卡片一览\n\n`;

  results.forEach((r, idx) => {
    md += `### ${idx + 1}. 窗口 \`${r.window_id}\` (${r.anchor_date}) — 状态: \`${r.status}\`\n`;
    if (r.status === 'filtered_invalid') {
      md += `* **过滤原因**: ${r.reason}\n`;
      md += `* **原文片段**: \`${(r.raw_anchor || '').slice(0, 150)}...\`\n\n`;
      return;
    }
    md += `- **涉及标的**: ${JSON.stringify(r.tickers)}\n`;
    md += `- **触发环境**: ${r.trigger_env}\n`;
    md += `- **动作节奏**: ${r.action_rhythm}\n`;
    md += `- **风控失效**: ${r.risk_invalid}\n`;
    md += `- **原文一字摘录** (${r.excerpt_valid ? '✅ 精确匹配' : '⚠️ 轻度改写'}): \n  > "${r.excerpt}"\n`;
    if (r.image_path) {
      md += `- **关联截图**: \`${r.image_path}\`\n`;
      if (r.vision_alignment) {
        md += `  - **图表类型**: \`${r.vision_alignment.chart_type}\` | **识别标的**: \`${r.vision_alignment.detected_ticker}\`\n`;
        md += `  - **关键点位**: ${JSON.stringify(r.vision_alignment.key_prices || [])}\n`;
        md += `  - **对齐判定**: **${r.vision_alignment.alignment_check}** (${r.vision_alignment.alignment_reason})\n`;
      }
    }
    md += `\n`;
  });

  fs.writeFileSync(reportPath, md, 'utf8');
}

run().catch(console.error);
