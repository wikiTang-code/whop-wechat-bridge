import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb } from '../../database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const EMBEDDING_CACHE_PATH = path.join(ROOT_DIR, 'data/runtime/taxonomy_embeddings_gemini-embedding-001.json');
const PREPARED_DATA_PATH = path.join(ROOT_DIR, 'data/runtime/taxonomy_prepared_049a.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY or GOOGLE_API_KEY is not set in environment.');
  process.exit(1);
}

// 严格遵守安全红线9：大V发言身份绝对硬锁
const ZHAO_SENDER_ID = 'user_4yeplXgbguTu4';
const ZHAO_SENDER_NAME = 'xiaozhaolucky';

// 价格点位识别正则
const PRICE_REGEX = /(?:[\$¥]\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:块|刀|点|元)|(?:支撑|阻力|买入|卖出|加仓|减仓|止损|目标|点位|看|破)\s*(?:位)?\s*(?:在|到|破|破了|稳)?\s*[\$¥]?\s*(\d+(?:\.\d+)?))/;

// 确保目录存在
const runtimeDir = path.join(ROOT_DIR, 'data/runtime');
if (!fs.existsSync(runtimeDir)) {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

// 加载现有向量缓存（增量断点续传）
let embeddingCache = {};
if (fs.existsSync(EMBEDDING_CACHE_PATH)) {
  try {
    embeddingCache = JSON.parse(fs.readFileSync(EMBEDDING_CACHE_PATH, 'utf8'));
    console.log(`[Cache] Loaded ${Object.keys(embeddingCache).length} existing embeddings from cache.`);
  } catch (err) {
    console.warn(`[Cache] Failed to parse cache file, starting fresh: ${err.message}`);
    embeddingCache = {};
  }
}

function saveCache() {
  fs.writeFileSync(EMBEDDING_CACHE_PATH, JSON.stringify(embeddingCache), 'utf8');
}

// 使用 batchEmbedContents 批量调用 Gemini Embedding API
async function fetchBatchGeminiEmbeddings(texts, retries = 5) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`;
  
  const requests = texts.map(t => ({
    model: 'models/gemini-embedding-001',
    content: {
      parts: [{ text: t.slice(0, 2048) }]
    }
  }));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let retryWaitMs = 15000;
        try {
          const errJson = JSON.parse(errorText);
          const retryInfo = errJson.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
          if (retryInfo && retryInfo.retryDelay) {
            const delaySec = parseFloat(retryInfo.retryDelay.replace('s', '')) || 15;
            retryWaitMs = Math.ceil(delaySec * 1000) + 1500;
          }
        } catch (_) {}

        if (resp.status === 429) {
          console.warn(`[429 Quota] Rate limit hit on batch attempt ${attempt}. Waiting ${Math.round(retryWaitMs/1000)}s before retry...`);
          await new Promise(r => setTimeout(r, retryWaitMs));
          continue;
        }

        throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${errorText}`);
      }

      const data = await resp.json();
      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error('Malformed batch embedding response: ' + JSON.stringify(data));
      }
      return data.embeddings.map(e => e.values);
    } catch (err) {
      if (attempt === retries) {
        throw err;
      }
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`[Retry] Attempt ${attempt} failed: ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

async function main() {
  console.log('=== REQ-049-A: 卡片准备与向量化预处理 (Batch 优化版) ===');
  const db = getDb();

  // 1. 查询所有符合红线9的赵哥卡片
  const query = `
    SELECT 
      c.id,
      c.card_type,
      c.title,
      c.trigger_text,
      c.action_text,
      c.theory_text,
      c.tickers_json,
      c.source_message_ids_json,
      c.created_at,
      m.content AS message_content,
      m.sender_id,
      m.sender_name
    FROM ontology_card c
    JOIN messages m ON m.id = json_extract(c.source_message_ids_json, '$[0]')
    WHERE (m.sender_id = ? OR m.sender_name = ?)
      AND c.card_type IN ('pattern', 'risk_rule')
    ORDER BY c.created_at ASC
  `;

  const rows = db.prepare(query).all(ZHAO_SENDER_ID, ZHAO_SENDER_NAME);
  console.log(`[Query] Fetched ${rows.length} valid Zhao cards (pattern & risk_rule).`);

  // 2. 数据结构化分桶
  const buckets = {
    pattern_with_level: [],
    pattern_no_level: [],
    risk_rule: []
  };

  const processedCards = [];

  for (const row of rows) {
    const combinedText = [
      row.title || '',
      row.trigger_text || '',
      row.action_text || '',
      row.theory_text || '',
      row.message_content || ''
    ].join(' ');

    const hasPrice = PRICE_REGEX.test(combinedText);
    
    let bucketKey = '';
    if (row.card_type === 'pattern') {
      bucketKey = hasPrice ? 'pattern_with_level' : 'pattern_no_level';
    } else if (row.card_type === 'risk_rule') {
      bucketKey = 'risk_rule';
    }

    const cleanContent = (row.message_content || '').replace(/\s+/g, ' ').trim();
    const cleanTrigger = (row.trigger_text || '').replace(/\s+/g, ' ').trim();
    const cleanAction = (row.action_text || '').replace(/\s+/g, ' ').trim();
    const cleanTitle = (row.title || '').replace(/\s+/g, ' ').trim();

    const embeddingText = `[TYPE] ${row.card_type} | [TITLE] ${cleanTitle} | [SETUP/TRIGGER] ${cleanTrigger} | [ACTION/RISK] ${cleanAction} | [EVIDENCE] ${cleanContent}`;

    let tickers = [];
    try {
      tickers = JSON.parse(row.tickers_json || '[]');
    } catch (_) {}

    const cardData = {
      id: row.id,
      card_type: row.card_type,
      bucket_key: bucketKey,
      title: row.title,
      trigger_text: row.trigger_text,
      action_text: row.action_text,
      theory_text: row.theory_text,
      tickers,
      raw_content: cleanContent,
      has_price: hasPrice,
      created_at: row.created_at,
      embedding_text: embeddingText
    };

    buckets[bucketKey].push(cardData);
    processedCards.push(cardData);
  }

  console.log(`[Buckets] Distribution:`);
  console.log(`  - pattern_no_level:   ${buckets.pattern_no_level.length}`);
  console.log(`  - pattern_with_level: ${buckets.pattern_with_level.length}`);
  console.log(`  - risk_rule:          ${buckets.risk_rule.length}`);

  // 3. 批量向量化 (batchEmbedContents, 每批 25 条)
  const toEmbed = processedCards.filter(c => !embeddingCache[c.id]);
  console.log(`[Embeddings] Need to generate vectors for ${toEmbed.length} cards (cached: ${processedCards.length - toEmbed.length}).`);

  const BATCH_SIZE = 25;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const chunk = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = chunk.map(c => c.embedding_text);

    try {
      const vectors = await fetchBatchGeminiEmbeddings(texts);
      for (let j = 0; j < chunk.length; j++) {
        embeddingCache[chunk[j].id] = vectors[j];
      }
      successCount += chunk.length;
      saveCache();
      console.log(`[Progress] ${i + chunk.length}/${toEmbed.length} (total cached: ${Object.keys(embeddingCache).length}).`);
    } catch (err) {
      console.error(`[Error] Batch starting at index ${i} failed: ${err.message}`);
      failCount += chunk.length;
    }

    // 适度防抖
    await new Promise(r => setTimeout(r, 600));
  }

  saveCache();
  console.log(`[Embeddings] Completed. Success: ${successCount}, Failed: ${failCount}, Total Cache: ${Object.keys(embeddingCache).length}`);

  // 4. 导出最终预处理数据包（供后续 Python HDBSCAN / UMAP 聚类消费）
  const preparedPayload = {
    metadata: {
      generated_at: new Date().toISOString(),
      embedding_model: 'gemini-embedding-001',
      vector_dim: 3072,
      total_cards: processedCards.length,
      bucket_counts: {
        pattern_no_level: buckets.pattern_no_level.length,
        pattern_with_level: buckets.pattern_with_level.length,
        risk_rule: buckets.risk_rule.length
      }
    },
    buckets
  };

  fs.writeFileSync(PREPARED_DATA_PATH, JSON.stringify(preparedPayload, null, 2), 'utf8');
  console.log(`[Output] Prepared data written to ${PREPARED_DATA_PATH}`);
  console.log('=== REQ-049-A Preparation Finished Successfully ===');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
