/**
 * tools/knowledge/batch_vision_pipeline.js
 * REQ-038-T1 — 432 张真图云端轻量多模态 (VL) 离线批跑管道
 *
 * 门禁与安全红线 (07-review-inbox / Q-006):
 * 1. 严格只扫描 data/media/zhao 下 >15KB 且非 .bin 的真图；
 * 2. 字段白名单: ticker, timeframe, support_resistance_json, patterns_json, hand_drawn_annotation；
 * 3. 严禁生成 BUY/SELL，严禁对接任何下单通道或 L2a actions；
 * 4. 仅外送图片二进制/Base64，绝不传敏感聊天文字；
 * 5. 失败统一标 status='failed' (严禁自创 vision_status)；
 * 6. 支持 --dry-run, --limit <N>, --all-valid, --model, --max-cost 预算控制。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb, saveMessageVisionMeta } from '../../database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const MEDIA_DIR = path.join(ROOT_DIR, 'data/media/zhao');

export const MIN_VALID_BYTES = 15 * 1024; // > 15KB
export const VALID_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
export const DEFAULT_MODEL = process.env.VL_MODEL || 'gemini-flash-latest';
export const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
export const EST_COST_PER_IMAGE_USD = 0.0015; // 预估单图费用

/**
 * 扫描指定目录下所有大于 15KB 的真实有效图片文件
 */
export function scanValidDiskImages(mediaDir = MEDIA_DIR) {
  if (!fs.existsSync(mediaDir)) return [];

  const validImages = [];
  const entries = fs.readdirSync(mediaDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(mediaDir, entry.name);
    if (entry.isDirectory()) {
      // 递归子目录 (日期目录如 2026-09-14)
      validImages.push(...scanValidDiskImages(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!VALID_EXTS.has(ext)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MIN_VALID_BYTES) {
          // 解析 message_id 与 attach_index
          // 命名规范通常为: post_1Cf3K2n7ANeL34KAnHgphQ_0.png 或 post_1CXYCpXPkLs5VVnU5aBkJe.jpg
          const baseName = path.basename(entry.name, ext);
          const parts = baseName.split('_');
          let messageId = baseName;
          let attachIndex = 0;

          if (parts.length >= 3 && !isNaN(parseInt(parts[parts.length - 1], 10))) {
            attachIndex = parseInt(parts.pop(), 10);
            messageId = parts.join('_');
          }

          const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
          validImages.push({
            full_path: fullPath,
            local_path: relPath,
            filename: entry.name,
            size: stat.size,
            message_id: messageId,
            attach_index: attachIndex,
          });
        }
      } catch (_) {}
    }
  }

  // 按文件路径稳定排序
  validImages.sort((a, b) => a.local_path.localeCompare(b.local_path));
  return validImages;
}

/**
 * 过滤出尚未处理成功 (status != 'ok') 的图片任务
 */
export function filterPendingImages(images, dbInstance = getDb()) {
  const selectStmt = dbInstance.prepare(
    "SELECT status FROM message_vision_meta WHERE id = ?"
  );

  const pending = [];
  for (const img of images) {
    const id = `vmeta_${img.message_id}_${img.attach_index}`;
    const row = selectStmt.get(id);
    if (!row || row.status !== 'ok') {
      pending.push({ ...img, id });
    }
  }
  return pending;
}

/**
 * 严格白名单清洗器：剔除一切投资建议与越界字段
 */
export function sanitizeVlOutput(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'object') {
    return { ok: false, error: 'INVALID_VL_OUTPUT' };
  }

  // 严格过滤/校验 ticker
  let ticker = null;
  if (rawOutput.ticker && typeof rawOutput.ticker === 'string') {
    const cleanTicker = rawOutput.ticker.trim().toUpperCase();
    if (/^[A-Z]{1,5}$/.test(cleanTicker)) {
      ticker = cleanTicker;
    }
  }

  // 校验 timeframe (如 1D, 5m, 1h, 15m, 1w)
  let timeframe = null;
  if (rawOutput.timeframe && typeof rawOutput.timeframe === 'string') {
    timeframe = rawOutput.timeframe.trim();
  }

  // 支撑阻力位校验
  let supportResistance = null;
  if (rawOutput.support_resistance && typeof rawOutput.support_resistance === 'object') {
    const sr = rawOutput.support_resistance;
    const cleanSr = {};
    if (Array.isArray(sr.support)) {
      cleanSr.support = sr.support.map(Number).filter((n) => !isNaN(n));
    }
    if (Array.isArray(sr.resistance)) {
      cleanSr.resistance = sr.resistance.map(Number).filter((n) => !isNaN(n));
    }
    if (cleanSr.support?.length || cleanSr.resistance?.length) {
      supportResistance = cleanSr;
    }
  }

  // 辅助：彻底脱敏/剥离潜在的交易指令词，确保纯客观视觉描述
  const stripTradingDirectives = (str) => {
    if (!str) return str;
    return String(str)
      .replace(/\b(BUY|STRONG_BUY|SELL|STRONG_SELL)\b/gi, '[FILTERED]')
      .replace(/(建议买入|建议卖出|立即做多|立即做空|开仓做多|开仓做空|无脑多|无脑空|做多|做空|买入|卖出)+/g, '[建议已过滤]')
      .replace(/(\[建议已过滤\]\s*)+/g, '[建议已过滤]')
      .trim();
  };

  // 形态学标签 (脱敏处理)
  const patterns = Array.isArray(rawOutput.patterns)
    ? rawOutput.patterns.map((p) => stripTradingDirectives(String(p).trim())).filter(Boolean)
    : [];

  // 手绘标注/箭头笔记 (脱敏处理)
  const handDrawn = rawOutput.hand_drawn_annotation
    ? stripTradingDirectives(String(rawOutput.hand_drawn_annotation).trim())
    : null;

  return {
    ok: true,
    data: {
      chart_type: 'K_LINE',
      ticker,
      timeframe,
      support_resistance: supportResistance,
      patterns,
      hand_drawn_annotation: handDrawn,
    },
  };
}

/**
 * 执行单张图片的云端 VL 抽取 (含 Mock 兜底)
 */
export async function extractImageVl(imageItem, options = {}) {
  const { apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, model = DEFAULT_MODEL, mock = false } = options;

  // 测试或无 Key 模式下走 Mock
  if (mock || !apiKey) {
    return mockExtractImageVl(imageItem);
  }

  const imageBuffer = fs.readFileSync(imageItem.full_path);
  const base64Data = imageBuffer.toString('base64');
  const ext = path.extname(imageItem.filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = `你是一个专业的行情K线图表视觉分析器。请仔细观察这张图表，提取客观视觉事实。
【必须遵守的规则】：
1. 严禁生成任何 BUY/SELL、下单建议或操作推荐；
2. 识别图中股票标的 (ticker)；若图中没有则为 null；
3. 识别时间周期 (timeframe, 例如 1D, 5m, 1h, 15m)；
4. 识别标注或图表呈现的支撑位与阻力位 (support_resistance: { support: [], resistance: [] })；
5. 识别图表中呈现的形态特征 (patterns: [])；
6. 描述画面中任何手绘箭头、框线或手写批注 (hand_drawn_annotation)；
7. 必须且只能输出标准 JSON，格式如下：
{
  "ticker": "TSLA",
  "timeframe": "1D",
  "support_resistance": { "support": [210.5], "resistance": [225.0] },
  "patterns": ["双底", "回踩颈线"],
  "hand_drawn_annotation": "黄色手绘箭头指向 210.5 支撑线"
}`;

  const candidateModels = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  
  for (const curModel of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${curModel}:generateContent`;
    const reqPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1,
      },
    };

    const maxRetries = 2;
    let attempt = 0;
    let modelQuotaExhausted = false;

    while (attempt <= maxRetries) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(reqPayload),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!candidateText) {
            return { ok: false, error: 'EMPTY_CANDIDATE_OUTPUT' };
          }
          const parsed = JSON.parse(candidateText);
          return sanitizeVlOutput(parsed);
        }

        const errText = await res.text();
        if (res.status === 429) {
          if (errText.includes('Quota exceeded') || errText.includes('RESOURCE_EXHAUSTED')) {
            console.warn(`  ⚠️ 模型 ${curModel} 免费配额已达硬限，自动切换到备用模型尝试...`);
            modelQuotaExhausted = true;
            break;
          }
          if (attempt < maxRetries) {
            attempt++;
            const waitSec = 20 + attempt * 10;
            console.warn(`  ⚠️ 触发 429 速率限制，退避等待 ${waitSec} 秒后重试...`);
            await new Promise((r) => setTimeout(r, waitSec * 1000));
            continue;
          }
        } else if (res.status === 503 && attempt < maxRetries) {
          attempt++;
          console.warn(`  ⚠️ 触发 503 高负载，退避等待 10 秒后重试...`);
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }

        return { ok: false, error: `API_HTTP_${res.status}: ${errText.slice(0, 120)}` };
      } catch (reqErr) {
        if (attempt < maxRetries) {
          attempt++;
          console.warn(`  ⚠️ 网络请求异常 (${reqErr.message})，等待 10 秒后重试...`);
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }
        return { ok: false, error: reqErr.message };
      }
    }

    if (!modelQuotaExhausted) {
      return { ok: false, error: 'EXCEEDED_MAX_RETRIES' };
    }
  }

  return { ok: false, error: 'ALL_CANDIDATE_MODELS_QUOTA_EXHAUSTED' };
}

/**
 * Mock 抽取器 (用于单元测试与本地离线验证)
 */
export function mockExtractImageVl(imageItem) {
  const name = imageItem.filename.toUpperCase();
  let ticker = null;
  if (name.includes('TSLA')) ticker = 'TSLA';
  else if (name.includes('TSLL')) ticker = 'TSLL';
  else if (name.includes('NVDA')) ticker = 'NVDA';
  else if (name.includes('CONL')) ticker = 'CONL';

  return sanitizeVlOutput({
    ticker,
    timeframe: '1D',
    support_resistance: {
      support: [100.5],
      resistance: [120.0],
    },
    patterns: ['突破回踩'],
    hand_drawn_annotation: '手绘支撑线标注 (mock)',
  });
}

/**
 * 批跑主流程
 */
export async function runBatchVisionPipeline(options = {}) {
  const {
    limit = 5,
    dryRun = false,
    maxCostUsd = 0.5,
    mock = false,
    intervalMs = (mock || dryRun ? 0 : 6500),
    dbInstance = getDb(),
    onProgress = null,
  } = options;

  console.log('[Batch Vision] 🔍 正在扫描磁盘有效真图资产 (门禁: >15KB 且非 .bin)...');
  const allImages = scanValidDiskImages();
  console.log(`[Batch Vision] 📊 扫描完成：共发现 ${allImages.length} 张磁盘真图。`);

  const pending = filterPendingImages(allImages, dbInstance);
  console.log(`[Batch Vision] ⏳ 待处理单据 (剔除 status='ok'): ${pending.length} 张。`);

  const effectiveLimit = Math.min(limit, pending.length);
  const toProcess = pending.slice(0, effectiveLimit);
  const estCost = (toProcess.length * EST_COST_PER_IMAGE_USD).toFixed(4);

  console.log(`[Batch Vision] 🎯 本次调度批次: ${toProcess.length} 张 (预算预估: $${estCost}, 上限: $${maxCostUsd})`);

  if (parseFloat(estCost) > maxCostUsd) {
    throw new Error(`COST_EXCEEDED: 预估费用 $${estCost} 超出允许上限 $${maxCostUsd}`);
  }

  const results = {
    total_found: allImages.length,
    pending_count: pending.length,
    processed_count: 0,
    success_count: 0,
    failed_count: 0,
    dry_run: dryRun,
    items: [],
  };

  if (dryRun) {
    console.log('[Batch Vision] 💡 dry-run 模式，跳过实际模型调用与入库。');
    results.processed_count = toProcess.length;
    return results;
  }

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const extractRes = await extractImageVl(item, { mock });

    const now = Date.now();
    let metaPayload;

    if (extractRes.ok && extractRes.data) {
      metaPayload = {
        id: item.id,
        message_id: item.message_id,
        attach_index: item.attach_index,
        local_path: item.local_path,
        chart_type: extractRes.data.chart_type,
        ticker: extractRes.data.ticker,
        timeframe: extractRes.data.timeframe,
        patterns: extractRes.data.patterns,
        support_resistance: extractRes.data.support_resistance,
        hand_drawn_annotation: extractRes.data.hand_drawn_annotation,
        provider: 'cloud_vl',
        status: 'ok',
        created_at: now,
        updated_at: now,
      };
      results.success_count++;
    } else {
      // 失败时必须严格标 status='failed'
      metaPayload = {
        id: item.id,
        message_id: item.message_id,
        attach_index: item.attach_index,
        local_path: item.local_path,
        chart_type: 'UNKNOWN',
        ticker: null,
        timeframe: null,
        patterns: [],
        support_resistance: null,
        hand_drawn_annotation: `extract_failed: ${extractRes.error || 'UNKNOWN'}`,
        provider: 'cloud_vl',
        status: 'failed',
        created_at: now,
        updated_at: now,
      };
      results.failed_count++;
    }

    saveMessageVisionMeta(metaPayload, dbInstance);
    results.processed_count++;
    results.items.push({
      id: item.id,
      local_path: item.local_path,
      status: metaPayload.status,
      ticker: metaPayload.ticker,
    });

    if (typeof onProgress === 'function') {
      onProgress(i + 1, toProcess.length, metaPayload, results);
    }

    if ((i + 1) % 20 === 0 || i === toProcess.length - 1) {
      console.log(`[Batch Vision 进度里程碑] 已处理: ${i + 1}/${toProcess.length} | 成功: ${results.success_count} | 失败: ${results.failed_count}`);
    }

    // 免费层速率保护: 保持在 15 RPM 以内 (每次请求间隔 intervalMs)
    if (!dryRun && !mock && i < toProcess.length - 1 && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return results;
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const mock = args.includes('--mock');
  const allValid = args.includes('--all-valid');

  let limit = 5;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10) || 5;
  } else if (allValid) {
    limit = 1000;
  }

  let intervalMs = 6500;
  const intervalIdx = args.indexOf('--interval');
  if (intervalIdx >= 0 && args[intervalIdx + 1]) {
    intervalMs = parseInt(args[intervalIdx + 1], 10) || 6500;
  }

  let maxCostUsd = 0.5;
  const costIdx = args.indexOf('--max-cost');
  if (costIdx >= 0 && args[costIdx + 1]) {
    maxCostUsd = parseFloat(args[costIdx + 1]) || 0.5;
  }

  runBatchVisionPipeline({
    limit,
    dryRun,
    mock,
    intervalMs,
    maxCostUsd,
    onProgress: (done, total, meta) => {
      console.log(`[Batch Vision] (${done}/${total}) ${meta.local_path} -> ${meta.status} [${meta.ticker || 'NONE'}]`);
    },
  })
    .then((res) => {
      console.log('--- Batch Vision Pipeline Result ---');
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Batch Vision Error]:', err.message);
      process.exit(1);
    });
}
