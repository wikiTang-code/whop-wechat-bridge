import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { saveMessages, saveReport, getLatestMessageId, getReports, isMessageArchived, getDb, markMessageTraded, markMessagePushed, extractTradingDimensions, getLatestPersonaPlaybook, updateMessageAttachments } from './database.js';
import { executeOrder, getUnifiedPortfolio } from './trading.js';
import { getMarketContextForTickers } from './kline.js';
import { runWithRateLimit } from './rate-limiter.js';
import { processMessageForCampaigns, checkAndCloseStaleCampaigns } from './campaign-engine.js';
import { downloadAndPersistAttachments, downloadBuffer } from './scripts/media_downloader.js';
import { dispatchIngestTopHalf } from './scripts/ingest_dispatcher.js';
import { runMediaWorker } from './scripts/media_worker.js';
import { generateQueueStatus } from './scripts/generate_queue_status.js';
import {
  isGeminiKeyProtectError,
  isLmContextExceeded,
  isLmModelUnloaded,
  shouldRotateGeminiKeyOnError,
  truncatePromptForLocal,
  shouldSkipGeminiFallback,
  shouldBlockGeminiForLocalDown,
  LOCAL_LM_DEFAULT_MODEL,
  LOCAL_LM_DEFAULT_BASE
} from './ai-router-policy.js';
import { isAiTunnelSuspended, notifyAiTunnelFailure } from './monitoring/ai-tunnel-circuit.js';
import { shouldPauseSecondaryWorkers } from './monitoring/backpressure-controller.js';

dotenv.config();

let lastProcessedMessageId = null;
let lmStudioOfflineUntil = 0; // 本地大模型熔断冷却截止时间戳

// GraphQL query string for Whop Chat Fetch Messages
const MESSAGES_FETCH_FEED_POSTS_QUERY = `
query MessagesFetchFeedPosts($feedType: FeedTypes!, $after: BigInt, $before: BigInt, $aroundId: ID, $feedId: ID!, $includeDeleted: Boolean, $includeReactions: Boolean, $limit: Int, $direction: Direction) {
  feedPosts(
    feedType: $feedType
    after: $after
    before: $before
    aroundId: $aroundId
    feedId: $feedId
    includeDeleted: $includeDeleted
    includeReactions: $includeReactions
    limit: $limit
    direction: $direction
  ) {
    posts {
      __typename
      ...DmsPostFragment
      ...ForumPostFragment
    }
    users {
      ...BasicUserProfileDetails
    }
    reactions {
      ...ReactionFragment
    }
  }
}

fragment DmsPostFragment on DmsPost {
  id
  createdAt
  updatedAt
  isDeleted
  sortKey
  isPosterAdmin
  mentionedUserIds
  content
  feedId
  feedType
  attachments {
    ...Attachment
  }
  gifs {
    height
    provider
    originalUrl
    previewUrl
    slug
    title
    width
  }
  isEdited
  isEveryoneMentioned
  isPinned
  linkEmbeds {
    description
    favicon
    image
    processing
    title
    url
    footer {
      title
      description
      icon
    }
  }
  richContent
  userId
  viewCount
  reactionCounts {
    reactionType
    userCount
    value
  }
  messageType
  embed
  replyingToPostId
  replyingToPost {
    id
    richContent
    content
    gifs {
      __typename
    }
    isDeleted
    linkEmbeds {
      __typename
    }
    mentionedUserIds
    isEveryoneMentioned
    messageType
    attachments {
      contentType
    }
    user {
      id
      name
      username
      roles
      profilePicSm: profilePicture {
        sourceUrl
      }
    }
  }
  poll {
    options {
      id
      text
    }
  }
  customAuthor {
    displayName
    profilePicture {
      sourceUrl
    }
  }
}

fragment Attachment on AttachmentInterface {
  __typename
  id
  signedId
  analyzed
  byteSizeV2
  filename
  contentType
  source(variant: original) {
    url
  }
  ... on ImageAttachment {
    height
    width
    blurhash
    aspectRatio
  }
  ... on VideoAttachment {
    height
    width
    duration
    aspectRatio
    preview(variant: original) {
      url
    }
  }
  ... on AudioAttachment {
    duration
    waveformUrl
  }
}

fragment BasicUserProfileDetails on PublicProfileUser {
  id
  name
  createdAt
  bannerImageLg: banner {
    source(variant: s600x200) {
      doubleUrl
    }
  }
  profilePicLg: profilePicture {
    sourceUrl
  }
  profilePicSm: profilePicture {
    sourceUrl
  }
  username
  roles
  lastSeenAt
  isPlatformPolice
}

fragment ReactionFragment on Reaction {
  id
  isDeleted
  createdAt
  updatedAt
  feedId
  feedType
  postId
  postType
  userId
  reactionType
  score
  value
}

fragment ForumPostFragment on ForumPost {
  id
  title
  createdAt
  updatedAt
  isDeleted
  sortKey
  content
  feedId
  feedType
  attachments {
    ...Attachment
  }
  userId
}`;

// Helper to check and use global fetch or node-fetch
const webFetch = typeof fetch !== 'undefined' ? fetch : global.fetch;

// Format messages into a string for the AI prompt
function formatMessagesForAI(messages) {
  return messages
    .map((msg) => {
      const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const channelStr = msg.channel_name ? `[频道: ${msg.channel_name}] ` : '';
      return `[${timeStr}] ${channelStr}${msg.sender_name} (${msg.sender_id}): ${msg.content}`;
    })
    .join('\n\n');
}

// Get context-enriched messages from database for a set of target messages
function getMessagesWithContext(messages, limitBefore = 5) {
  const db = getDb();
  const uniqueMessageMap = new Map();

  // Add the original messages
  for (const msg of messages) {
    uniqueMessageMap.set(msg.id, {
      ...msg,
      is_speaker: true
    });
  }

  // For each message, query the preceding messages in the same channel
  const stmt = db.prepare(`
    SELECT * FROM messages 
    WHERE channel_id = ? AND created_at < ? 
    ORDER BY created_at DESC LIMIT ?
  `);

  for (const msg of messages) {
    const before = stmt.all(msg.channel_id, msg.created_at, limitBefore);
    for (const contextMsg of before) {
      if (!uniqueMessageMap.has(contextMsg.id)) {
        uniqueMessageMap.set(contextMsg.id, {
          ...contextMsg,
          is_speaker: false
        });
      }
    }
  }

  // Convert to array and sort chronologically
  const sortedMessages = Array.from(uniqueMessageMap.values())
    .sort((a, b) => a.created_at - b.created_at);

  return sortedMessages;
}

// Format messages with context into a string for the AI prompt
function formatMessagesWithContextForAI(enrichedMessages) {
  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return enrichedMessages
    .map((msg) => {
      const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const channelStr = msg.channel_name ? `[频道: ${msg.channel_name}] ` : '';
      
      let roleStr = '';
      if (msg.is_speaker) {
        roleStr = '[当前分析发言]';
      } else if (targetSpeakers.includes(msg.sender_id)) {
        roleStr = '[主发言人上下文]';
      } else {
        roleStr = '[群友上下文]';
      }
      
      return `[${timeStr}] ${channelStr}${roleStr} ${msg.sender_name} (${msg.sender_id}): ${msg.content}`;
    })
    .join('\n\n');
}

// Helper function to execute a single cloud LLM engine
async function executeSingleEngine(engine, prompt, apiKey) {
  if (engine === 'gemini') {
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const keys = (apiKey || '').split(',').map(k => k.trim()).filter(Boolean);
    let lastErr = null;

    // 随机打乱 keys 数组顺序，均衡各个 API Key 的压降消耗
    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

    for (let kIdx = 0; kIdx < shuffledKeys.length; kIdx++) {
      const activeKey = shuffledKeys[kIdx];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;

      try {
        const response = await webFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          const statusErr = new Error(`Gemini API failed with status ${response.status}: ${errText}`);

          // 429/401/invalid: do NOT burn Key #2 in a tight loop. Upper layer fails over to local 14B.
          if (isGeminiKeyProtectError(statusErr) || !shouldRotateGeminiKeyOnError(statusErr)) {
            console.warn(`[Gemini API] Key #${kIdx + 1} 触发 ${response.status} (429/401/invalid) — 不轮询下一把 Key，交由上层降级本地 14B`);
            throw statusErr;
          }

          if (kIdx < shuffledKeys.length - 1) {
            console.warn(`[Gemini API] Key #${kIdx + 1} 失败 (${response.status})，尝试下一把 Key #${kIdx + 2}...`);
            lastErr = statusErr;
            continue;
          }

          throw statusErr;
        }

        const result = await response.json();
        const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
          throw new Error('Gemini API returned empty content or invalid structure.');
        }

        console.log(`[AI Router] served_by=gemini model=${model} key_slot=#${kIdx + 1} (no extra keys consumed)`);
        return content;
      } catch (err) {
        lastErr = err;
        if (isGeminiKeyProtectError(err) || !shouldRotateGeminiKeyOnError(err)) {
          throw err;
        }
        if (kIdx < shuffledKeys.length - 1) {
          continue;
        }
        break;
      }
    }
    throw lastErr || new Error('All Gemini API keys failed.');
  } else {
    // mimo
    const mimoApiKey = process.env.MIMO_API_KEY;
    const mimoBaseUrl = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com';
    const mimoModel = process.env.MIMO_MODEL || 'gemini-2.5-flash';

    const response = await webFetch(`${mimoBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mimoApiKey}`,
        'User-Agent': 'Cursor/0.45.0'
      },
      body: JSON.stringify({
        model: mimoModel,
        messages: [
          { role: 'user', content: prompt }
        ]
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MIMO API failed with status ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('MIMO API returned empty content.');
    }

    return content;
  }
}

// Call Google Gemini API (Heavy refactored for Gemini & MIMO parallel and dynamic routing)
export async function analyzeWithGemini(apiKey, prompt, priority = 10) {
  const hasMimo = !!process.env.MIMO_API_KEY;
  // 50%/50% 随机分流 Gemini 和 MIMO 实现并行吞吐
  const useMimoFirst = hasMimo && (Math.random() < 0.5);
  
  const firstEngine = useMimoFirst ? 'mimo' : 'gemini';
  const secondEngine = useMimoFirst ? 'gemini' : 'mimo';

  try {
    const callFn = () => executeSingleEngine(firstEngine, prompt, apiKey);
    return await runWithRateLimit(callFn, { priority, provider: firstEngine });
  } catch (firstErr) {
    if (hasMimo) {
      console.warn(`[Smart Route] ${firstEngine} 调用异常，正在秒级自动飘移至备用引擎 ${secondEngine}... 错误: ${firstErr.message}`);
      try {
        const fallbackCallFn = () => executeSingleEngine(secondEngine, prompt, apiKey);
        return await runWithRateLimit(fallbackCallFn, { priority, provider: secondEngine });
      } catch (secondErr) {
        throw new Error(`Both engines failed. 1st (${firstEngine}): ${firstErr.message} | 2nd (${secondEngine}): ${secondErr.message}`);
      }
    } else {
      throw firstErr;
    }
  }
}

// Extract image URLs from message content [IMAGE:url] tags
export function extractImageUrls(content) {
  const regex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
  const urls = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// Download an image from URL and convert to base64 for Gemini multimodal
async function downloadImageAsBase64(imageUrl, timeoutMs = 10000) {
  const client = imageUrl.startsWith('https') ? https : http;
  
  return new Promise((resolve, reject) => {
    const req = client.get(imageUrl, { timeout: timeoutMs }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImageAsBase64(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Image download failed: HTTP ${res.statusCode}`));
        return;
      }

      const contentType = res.headers['content-type'] || 'image/jpeg';
      const chunks = [];
      let totalBytes = 0;
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB limit

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_SIZE) {
          req.destroy();
          reject(new Error(`Image exceeds ${MAX_SIZE / 1024 / 1024}MB limit`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Determine MIME type
        let mimeType = contentType.split(';')[0].trim();
        if (!mimeType.startsWith('image/')) {
          // Infer from URL extension
          const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase();
          const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
          mimeType = mimeMap[ext] || 'image/jpeg';
        }
        resolve({ base64: buffer.toString('base64'), mimeType });
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Image download timeout'));
    });
  });
}

// Helper function to execute a single multimodal LLM engine
async function executeSingleMultimodalEngine(engine, prompt, imageUrls, apiKey) {
  const urlsToProcess = imageUrls.slice(0, 5);

  if (engine === 'gemini') {
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const parts = [{ text: prompt }];
    let loadedCount = 0;
    let failedCount = 0;
    
    for (const imgUrl of urlsToProcess) {
      try {
        const imageData = await downloadImageAsBase64(imgUrl);
        parts.push({
          inlineData: {
            mimeType: imageData.mimeType,
            data: imageData.base64
          }
        });
        loadedCount++;
      } catch (err) {
        console.warn(`[Multimodal Gemini] Failed to load image: ${imgUrl} - ${err.message}`);
        parts.push({ text: `[图片无法加载: ${imgUrl} - ${err.message}]` });
        failedCount++;
      }
    }
    
    console.log(`[Multimodal Gemini] Prepared ${loadedCount} images, ${failedCount} failed out of ${urlsToProcess.length} total`);

    const response = await webFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Multimodal API failed with status ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini Multimodal API returned empty content or invalid structure.');
    }

    return content;
  } else {
    // mimo
    const mimoApiKey = process.env.MIMO_API_KEY;
    const mimoBaseUrl = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com';
    const mimoModel = process.env.MIMO_MODEL || 'gemini-2.5-flash';

    const messagesContent = [{ type: 'text', text: prompt }];
    for (const imgUrl of urlsToProcess) {
      try {
        const imageData = await downloadImageAsBase64(imgUrl);
        messagesContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${imageData.mimeType};base64,${imageData.base64}`
          }
        });
      } catch (err) {
        console.warn(`[Fallback Multimodal MIMO] Skip image ${imgUrl} - ${err.message}`);
      }
    }

    const response = await webFetch(`${mimoBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mimoApiKey}`,
        'User-Agent': 'Cursor/0.45.0'
      },
      body: JSON.stringify({
        model: mimoModel,
        messages: [
          { role: 'user', content: messagesContent }
        ]
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MIMO Multimodal API failed with status ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('MIMO Multimodal API returned empty content.');
    }

    return content;
  }
}

/**
 * Gemini 多模态分析（仅用于含图片的消息分析，支持 Gemini / MIMO 双通道并行）
 */
export async function analyzeWithGeminiMultimodal(apiKey, prompt, imageUrls = [], priority = 10) {
  const hasMimo = !!process.env.MIMO_API_KEY;
  const useMimoFirst = hasMimo && (Math.random() < 0.5);
  
  const firstEngine = useMimoFirst ? 'mimo' : 'gemini';
  const secondEngine = useMimoFirst ? 'gemini' : 'mimo';

  try {
    const callFn = () => executeSingleMultimodalEngine(firstEngine, prompt, imageUrls, apiKey);
    return await runWithRateLimit(callFn, { priority, provider: firstEngine });
  } catch (firstErr) {
    if (hasMimo) {
      console.warn(`[Smart Route Multimodal] ${firstEngine} 异常，正在秒级自动飘移至备用引擎 ${secondEngine}... 错误: ${firstErr.message}`);
      try {
        const fallbackCallFn = () => executeSingleMultimodalEngine(secondEngine, prompt, imageUrls, apiKey);
        return await runWithRateLimit(fallbackCallFn, { priority, provider: secondEngine });
      } catch (secondErr) {
        throw new Error(`Both multimodal engines failed. 1st (${firstEngine}): ${firstErr.message} | 2nd (${secondEngine}): ${secondErr.message}`);
      }
    } else {
      throw firstErr;
    }
  }
}

function localFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const postData = options.body || '';
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: Object.assign({ 'Connection': 'close' }, options.headers || {}),
      timeout: options.timeout || 300000 // 5 minutes timeout for local LLM generation
    };

    if (postData) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(data),
          json: () => {
            try {
              return Promise.resolve(JSON.parse(data));
            } catch (err) {
              return Promise.reject(err);
            }
          }
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('LM Studio HTTP Local Timeout (>5m)'));
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (10 minutes) during local LLM generation.'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Call Ollama API for local LLM
export async function analyzeWithOllama(baseUrl, model, prompt) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/generate`;
  const response = await localFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API failed with status ${response.status}: ${errText}`);
  }

  const result = await response.json();
  let text = result.response || '';
  
  // Strip DeepSeek's <think> tags if present for cleaner presentation
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  return text;
}

// Call LM Studio (OpenAI-compatible) API for local LLM (内置 socket hang up 自动避让重试)
export async function analyzeWithLMStudio(baseUrl, model, prompt) {
  global.isAiGenerating = true;
  let attempts = 0;
  const maxAttempts = 3;
  let workingPrompt = String(prompt || '');
  let truncatedOnce = false;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      const response = await localFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model || process.env.LM_STUDIO_MODEL || LOCAL_LM_DEFAULT_MODEL,
          messages: [
            {
              role: 'user',
              content: workingPrompt
            }
          ],
          temperature: 0.2
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        if (isLmContextExceeded(errText) && !truncatedOnce && workingPrompt.length > 2000) {
          truncatedOnce = true;
          const before = workingPrompt.length;
          workingPrompt = truncatePromptForLocal(workingPrompt);
          console.warn(`[LM Studio Local] context-exceeded (${before} chars) — truncating to ${workingPrompt.length} and retrying locally (not Gemini)`);
          attempts = Math.max(0, attempts - 1);
          continue;
        }
        if (isLmContextExceeded(errText)) {
          throw new Error(`LM_CONTEXT_EXCEEDED: ${errText}`);
        }
        throw new Error(`LM Studio API failed with status ${response.status}: ${errText}`);
      }

      const result = await response.json();
      let text = result.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('LM Studio API returned empty content or invalid structure.');
      }

      // 成功响应，更新最近成功连线时间戳 (防止看板频繁闪烁未连接)
      global.lastSuccessfulLocalAiTime = Date.now();

      // Strip DeepSeek/Qwen thinking tags if present
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      global.isAiGenerating = false;
      console.log(`[AI Router] served_by=lm-studio model=${model || process.env.LM_STUDIO_MODEL || LOCAL_LM_DEFAULT_MODEL}`);
      return text;
    } catch (err) {
      if (isLmContextExceeded(err) && !truncatedOnce && workingPrompt.length > 2000) {
        truncatedOnce = true;
        const before = workingPrompt.length;
        workingPrompt = truncatePromptForLocal(workingPrompt);
        console.warn(`[LM Studio Local] context-exceeded (${before} chars) — truncating to ${workingPrompt.length} and retrying locally (not Gemini)`);
        attempts = Math.max(0, attempts - 1);
        continue;
      }
      if (isLmContextExceeded(err)) {
        global.isAiGenerating = false;
        throw err.message.startsWith('LM_CONTEXT_EXCEEDED') ? err : new Error(`LM_CONTEXT_EXCEEDED: ${err.message}`);
      }

      const isSocketOrConnError = 
        err.message.includes('socket hang up') || 
        err.message.includes('ECONNRESET') || 
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT');

      if (isSocketOrConnError && attempts < maxAttempts) {
        console.warn(`[LM Studio Local] 遇到连接挂起/网络抖动 (${err.message})。正在自动进行第 ${attempts}/${maxAttempts - 1} 次重试 (避让 1.5s)...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      global.isAiGenerating = false;
      throw err;
    }
  }
  global.isAiGenerating = false;
}


// 辅助函数：判断是否是网络无法访问的异常
function isNetworkConnectionError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('econnrefused') || 
         msg.includes('etimedout') || 
         msg.includes('enotfound') || 
         msg.includes('fetch failed') ||
         msg.includes('connection refused') ||
         msg.includes('network error') ||
         msg.includes('socket hang up') ||
         msg.includes('request timeout');
}

// Unified LLM call: local 14B first for bulk text; Gemini only for cloudOnly / sparse fallback.
export async function analyzeWithFallback(prompt, options = {}) {
  const requestedProvider = options.provider || process.env.AI_PROVIDER || 'lm-studio';
  const priority = options.priority !== undefined ? options.priority : 1;
  const cloudOnly = options.cloudOnly === true;
  const tag = options.tag || 'text';
  const apiKey = process.env.GEMINI_API_KEY;
  const baseUrl = options.baseUrl || process.env.LM_STUDIO_BASE_URL || LOCAL_LM_DEFAULT_BASE;
  const model = options.model || process.env.LM_STUDIO_MODEL || LOCAL_LM_DEFAULT_MODEL;

  const tryGemini = async (reason) => {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    console.log(`[AI Router] [${tag}] served_by=gemini (reason=${reason})`);
    return await analyzeWithGemini(apiKey, prompt, priority);
  };

  const tryLocal = async () => {
    if (requestedProvider === 'ollama') {
      const ollamaBase = options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const ollamaModel = options.model || process.env.OLLAMA_MODEL || 'deepseek-r1';
      console.log(`[AI Router] [${tag}] served_by=ollama model=${ollamaModel}`);
      return await analyzeWithOllama(ollamaBase, ollamaModel, prompt);
    }
    console.log(`[AI Router] [${tag}] trying local 14B first (${baseUrl} / ${model})`);
    return await analyzeWithLMStudio(baseUrl, model, prompt);
  };

  // Explicit cloud-only (vision callers should use analyzeWithGeminiMultimodal instead).
  if (cloudOnly) {
    try {
      return await tryGemini('cloudOnly');
    } catch (err) {
      if (isGeminiKeyProtectError(err)) {
        console.warn(`[AI Router] [${tag}] Gemini 429/401/invalid — fail over to local 14B, not next key`);
        return await tryLocal();
      }
      throw err;
    }
  }

  const isLocalOffline = Date.now() < lmStudioOfflineUntil || isAiTunnelSuspended();
  const allowSparseGemini = options.allowSparseGeminiWhenLocalDown === true;
  if (isLocalOffline) {
    if (shouldBlockGeminiForLocalDown({ circuitOpen: true, allowSparseGemini })) {
      const err = new Error('AI_TUNNEL_SUSPENDED: local 14B tunnel circuit open — queue/bulk suspended, not dumping onto Gemini');
      console.warn(`[AI Router] [${tag}] ${err.message}`);
      throw err;
    }
    if (apiKey) {
      console.log(`[AI Router] [${tag}] local 14B circuit open — sparse Gemini fallback (explicit allow)`);
      try {
        return await tryGemini('local-circuit-open-sparse');
      } catch (err) {
        if (isGeminiKeyProtectError(err)) {
          console.warn(`[AI Router] [${tag}] Gemini 429/401/invalid during sparse fallback — not burning next key`);
        }
        throw err;
      }
    }
    throw new Error('AI_TUNNEL_SUSPENDED: local 14B down and no sparse Gemini allowed');
  }

  let acquiredLockLocally = false;
  let localErr = null;
  try {
    while (global.gpuLock && global.gpuLock.isLocked && global.gpuLock.owner !== 'wechat-bridge') {
      console.log(`[GPU Scheduler] GPU 当前被 ${global.gpuLock.owner} 占用，微信大模型分析任务排队等待中...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (global.gpuLock && !global.gpuLock.isLocked) {
      global.gpuLock = {
        isLocked: true,
        owner: 'wechat-bridge',
        acquiredAt: Date.now()
      };
      acquiredLockLocally = true;
    }

    return await tryLocal();
  } catch (e) {
    localErr = e;
  } finally {
    if (acquiredLockLocally && global.gpuLock && global.gpuLock.owner === 'wechat-bridge') {
      global.gpuLock = {
        isLocked: false,
        owner: null,
        acquiredAt: null
      };
      console.log('[GPU Scheduler] 微信大模型任务分析完成，释放 GPU 锁');
    }
  }

  if (!localErr) return;

  if (shouldSkipGeminiFallback(localErr)) {
    console.warn(`[AI Router] [${tag}] 14B context-exceeded after truncate — skip job, do not dump onto Gemini`);
    throw localErr;
  }

  const localDown = isNetworkConnectionError(localErr) || isLmModelUnloaded(localErr);
  if (localDown) {
    lmStudioOfflineUntil = Date.now() + 5 * 60 * 1000;
    notifyAiTunnelFailure(localErr).catch(() => {});
    console.warn(`[AI Router] [${tag}] local 14B unreachable (${localErr.message}). Circuit + suspend bulk (Q1).`);
  } else {
    console.warn(`[AI Router] [${tag}] local 14B failed: ${localErr.message}`);
  }

  if (localDown && shouldBlockGeminiForLocalDown({ circuitOpen: true, allowSparseGemini })) {
    throw new Error(`AI_TUNNEL_SUSPENDED: ${localErr.message}`);
  }

  if (apiKey && localDown && allowSparseGemini) {
    try {
      return await tryGemini('local-down-sparse');
    } catch (gErr) {
      if (isGeminiKeyProtectError(gErr)) {
        console.warn(`[AI Router] [${tag}] Gemini 429/401/invalid — not rotating Key #2`);
      }
      throw gErr;
    }
  }
  throw localErr;
}

// Push report to Enterprise WeChat group robot
export async function pushToWeChat(webhookUrl, markdownContent) {
  if (!webhookUrl) {
    console.log('Skipping WeChat push: WECHAT_WORK_WEBHOOK_URL is not set.');
    return;
  }

  // 企业微信 markdown 消息限制 4096 字符
  const WECHAT_MAX_LENGTH = 4000; // 留 96 字符余量给转义
  let content = markdownContent;
  if (content.length > WECHAT_MAX_LENGTH) {
    content = content.substring(0, WECHAT_MAX_LENGTH) + '\n\n---\n⚠️ *内容过长已截断，完整报告请查看 Web Dashboard*';
    console.log(`[WeChat Push] Content truncated from ${markdownContent.length} to ${WECHAT_MAX_LENGTH} chars.`);
  }

  const response = await webFetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: content,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Failed to push to Enterprise WeChat: HTTP ${response.status} - ${errText}`);
    return;
  }

  const result = await response.json().catch(() => ({}));
  if (result.errcode !== 0) {
    console.error(`Enterprise WeChat API error: errcode=${result.errcode}, errmsg=${result.errmsg}`);
  } else {
    console.log('Successfully pushed AI report to Enterprise WeChat.');
  }
}

// Strip markdown code fences and parse JSON robustly
function parseJSONResponse(text) {
  try {
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\s*/i, '');
      cleanText = cleanText.replace(/\s*```$/, '');
    }
    return JSON.parse(cleanText.trim());
  } catch (e) {
    console.error('Failed to parse JSON response from AI:', e, 'Raw text:', text);
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerError) {
        console.error('Failed to parse regex-extracted JSON:', innerError);
      }
    }
    throw new Error('AI 返回的格式无法解析为有效的交易信号 JSON 数组: ' + e.message);
  }
}
async function extractAndExecuteTrades(newSpeakerMessages, provider, primarySpeakerName) {
  const tradingLevel = process.env.AUTO_TRADING_LEVEL || 'strict';
  console.log(`[自动跟单] 当前跟单限制级别: ${tradingLevel}`);

  if (tradingLevel === 'none') {
    console.log('[自动跟单] 自动跟单功能已关闭（仅分析提示模式）。');
    return { success: true, executedCount: 0, signals: [], reason: '自动跟单已关闭' };
  }

  // Filter messages by channel if in strict mode
  const OFFICIAL_SIGNAL_CHANNELS = (process.env.WHOP_SIGNAL_CHANNEL_IDS || 'chat_feed_1CTrCEx44dP13jW3RVkYiS,chat_feed_1CWLuNUVYVVYttro8gAvJ5')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const filteredMessages = [];
  for (const msg of newSpeakerMessages) {
    if (tradingLevel === 'strict' && !OFFICIAL_SIGNAL_CHANNELS.includes(msg.channel_id)) {
      console.log(`[自动跟单] 消息来自非官方跟单频道 [${msg.channel_name}] (ID: ${msg.channel_id})，在 strict 级别下跳过交易信号提取。`);
      continue;
    }
    filteredMessages.push(msg);
  }

  if (filteredMessages.length === 0) {
    console.log('[自动跟单] 经过频道过滤后无有效交易消息。');
    return { success: true, executedCount: 0, signals: [], reason: '没有来自官方喊单频道的交易消息' };
  }

  // Get context messages (preceding 3 messages) to resolve implicit references and tickers
  const enrichedMessages = getMessagesWithContext(filteredMessages, 3);
  const messagesText = formatMessagesWithContextForAI(enrichedMessages);

  // Retrieve current total equity for position sizing
  let totalEquity = 100000.00;
  try {
    const portfolio = await getUnifiedPortfolio();
    if (portfolio && portfolio.total_equity) {
      totalEquity = portfolio.total_equity;
    }
  } catch (err) {
    console.warn('[自动跟单] 无法获取账户资产，将默认按 $100,000.00 进行比例折算:', err.message);
  }

  const useDynamicSizing = process.env.USE_DYNAMIC_SIZING !== 'false';
  const autoSubstituteEtfs = process.env.AUTO_SUBSTITUTE_LEVERAGED_ETFS === 'true';
  const mappingStr = process.env.LEVERAGED_ETF_MAPPING || 'NVDA:NVDL,TSLA:TSLL,LITE:LITX';

  const signalPrompt = `你是一个交易信号提取器。请分析以下美股社区群主/大V [${primarySpeakerName}] 的发言记录，提取其中明确指示的买入(BUY)或卖出(SELL)信号。
你必须严格输出一个符合以下 JSON 格式 of 数组，不要包含任何额外的解释、Markdown 标记或代码块包裹，仅输出 JSON 本身。如果没有检测到任何明确的交易信号，请输出空数组 []。

当前虚拟账户总资产（Total Equity）为：$${totalEquity.toFixed(2)} 美元。
启用仓位动态折算股数（USE_DYNAMIC_SIZING）：${useDynamicSizing ? '已开启' : '已关闭'}。
启用短线两倍做多 ETF 自动代用（AUTO_SUBSTITUTE_LEVERAGED_ETFS）：${autoSubstituteEtfs ? '已开启' : '已关闭'}。
2倍做多 ETF 映射代用关系为：${mappingStr}。

关于计算股数 (quantity) 的规则：
1. 如果大V发言中未明确指定买入股数，但在系统启用了动态仓位计算时，请参考股票当前价格和账户总资产来折算股数：
   - 一个完整仓位（如“常规仓”、“一成仓”、“全仓买入目标”）默认对应账户总资产的 10% 资金（例如：$${(totalEquity * 0.1).toFixed(2)}美元）。
   - 三分之一仓（如“底仓”、“常规三分之一仓”、“加三分之一”）对应账户总资产的 3.3% 资金（例如：$${(totalEquity * 0.033).toFixed(2)}美元）。
   - 股数计算公式：股数 = (账户总资产 * 对应仓位比例) / 股票单价（向下取整且必须大于0）。
   - 如果大V明确说“买2”，表示买入 2 个三分之一仓位（即 6.6% 的资金比例）；“卖1”表示卖出 1 个三分之一仓位（即 3.3% 的资金比例）。
2. 如果未启用动态仓位计算，或发言极其模糊且公式不适用，请默认填 100。

关于 ETF 自动代用规则（仅在开启时生效）：
- 如果开启了“短线两倍做多 ETF 自动代用”，且该发言是针对日内短线、做T等策略对上述映射关系左侧的正股进行操作，请在提取的 JSON 中将正股代码替换为对应的 ETF 代码（例如 NVDA 替换为 NVDL，TSLA 替换为 TSLL，LITE 替换为 LITX）。
- 替换后，请尽量估算折算后的 ETF 价格并填入 price。如果无法估算，可填正股价格，并在 reason 中说明。

发言记录如下（按时间先后顺序排列，其中标有 [主发言人] 的是群主/大V的发言，标有 [群友上下文] 的是群友的背景提问，你必须结合群友上下文的内容来确定大V在说哪只股票，如果大V的消息里没提到代码，但群友上文提到了，例如群友问“谷歌能买吗”，大V回答“355买2”，则提取的 ticker 为 GOOG 或 GOOGL，价格为 355）：

${messagesText}`;

  let jsonText = '';
  console.log(`[自动跟单] 正在调用 AI (${provider}) 提取交易信号...`);
  const startTimeTradeAI = Date.now();
  
  try {
    jsonText = await analyzeWithFallback(signalPrompt, { provider, priority: 1 });

    const durationTradeAI = ((Date.now() - startTimeTradeAI) / 1000).toFixed(1);
    console.log(`[自动跟单] AI 提取信号完成！耗时: ${durationTradeAI}秒。AI 原始响应 JSON:\n${jsonText.trim()}`);

    const signals = parseJSONResponse(jsonText);
    if (!Array.isArray(signals)) {
      throw new Error('AI 返回的数据不是一个数组');
    }

    if (signals.length === 0) {
      console.log('[自动跟单] 未检测到任何交易信号。');
      return { success: true, executedCount: 0, signals: [] };
    }

    console.log(`[自动跟单] AI 提取出 ${signals.length} 个交易信号，准备执行...`);
    const executionResults = [];
    
    for (const signal of signals) {
      if (!signal.ticker || !signal.action || !signal.price) {
        console.warn('[自动跟单] 忽略无效的信号对象:', signal);
        continue;
      }

      const ticker = String(signal.ticker).toUpperCase();
      const action = String(signal.action).toUpperCase();
      const price = parseFloat(signal.price);
      const quantity = parseInt(signal.quantity || '100', 10);
      const stopLoss = signal.stopLoss ? parseFloat(signal.stopLoss) : null;
      const reason = signal.reason || 'AI 自动跟单信号';

      if (action !== 'BUY' && action !== 'SELL') {
        console.warn(`[自动跟单] 忽略无效的动作 ${action} (仅支持 BUY/SELL)`);
        continue;
      }

      let finalQuantity = quantity;

      // 针对买入(BUY)指令，进行资金与仓位大小自适应修正，防止高价股因额度问题被券商拒单，以及低价股下单过小
      if (action === 'BUY') {
        try {
          const portfolio = await getUnifiedPortfolio();
          const availableCash = portfolio.cash || 0;
          const totalEquity = portfolio.total_equity || 100000.00;

          const estTotalCost = quantity * price;
          const isDefaultQty = quantity === 100;

          // 1. 若开启了动态仓位计算，且 AI 返回了默认股数 100，或者该订单所需总金额超过了总资产的 15%（单笔占用过多）
          if (useDynamicSizing && (isDefaultQty || estTotalCost > totalEquity * 0.15)) {
            // 单笔标准最大买入比例设定为总资产的 10%
            const maxSizingAmount = totalEquity * 0.1;
            const newQty = Math.floor(maxSizingAmount / price);
            if (newQty > 0) {
              console.log(`[自动跟单自适应] 检测到 BUY ${ticker} 信号。原定下单数: ${quantity} 股（预估需 $${estTotalCost.toFixed(2)}），当前已开启动态仓位。已重新折算为总资产10%的对应股数: ${newQty} 股（预估需 $${(newQty * price).toFixed(2)}）。`);
              finalQuantity = newQty;
            }
          }

          // 2. 资金安全线限制：不能超过当前账户可用现金（预留 5% 缓冲应对手续费/滑点）
          const finalCost = finalQuantity * price;
          if (finalCost > availableCash) {
            const safeCash = availableCash * 0.95;
            const maxBuyableQty = Math.floor(safeCash / price);
            if (maxBuyableQty > 0) {
              console.log(`[自动跟单自适应] 检测到 BUY ${ticker} 信号所需金额 $${finalCost.toFixed(2)} 超过当前可用现金 $${availableCash.toFixed(2)}。已自动向下修正购买股数为安全值: ${maxBuyableQty} 股。`);
              finalQuantity = maxBuyableQty;
            } else {
              console.warn(`[自动跟单自适应] 当前可用现金 $${availableCash.toFixed(2)} 不足以买入 1 股 ${ticker} (@$${price})。该 BUY 信号已被强行拦截。`);
              continue;
            }
          }
        } catch (err) {
          console.error('[自动跟单自适应] 处理 BUY 资金自适应修正时发生异常:', err.message);
        }
      }

      // 针对卖出(SELL)指令，进行持仓自适应修正，解决因AI缺少持仓数据而硬编码100股导致的拦截失败问题
      if (action === 'SELL') {
        try {
          const positions = await getUnifiedPositions();
          const existingPosition = positions.find(pos => pos.ticker === ticker);
          const existingQty = existingPosition ? existingPosition.quantity : 0;

          if (existingQty > 0) {
            // 如果AI默认输出100股，但我们持仓较少，或者大V意图是平仓/清仓，自动将股数修正为实际持仓数
            if (quantity >= existingQty || reason.includes('平仓') || reason.includes('全卖') || reason.includes('清仓') || reason.includes('卖出全部')) {
              console.log(`[自动跟单自适应] 检测到 SELL ${ticker} 信号。持仓数: ${existingQty} 股，原定下单数: ${quantity} 股。已自适应修正为最大持仓股数 ${existingQty} 股以正确平仓。`);
              finalQuantity = existingQty;
            }
          } else {
            console.warn(`[自动跟单自适应] 检测到 SELL ${ticker} 信号，但当前账户没有任何持仓，将继续由交易引擎拦截。`);
          }
        } catch (err) {
          console.error('[自动跟单自适应] 获取持仓进行SELL股数修正时发生异常:', err.message);
        }
      }

      console.log(`[自动跟单执行] 触发交易: ${action} ${ticker} ${finalQuantity}股 @ $${price}`);
      
      const result = await executeOrder({
        ticker,
        action,
        price,
        quantity: finalQuantity,
        stopLoss,
        reason: `[AI 自动跟单] ${reason}`
      });

      executionResults.push({
        ticker,
        action,
        success: result.success,
        reason: result.reason || '执行成功'
      });
    }

    return { success: true, executedCount: executionResults.length, results: executionResults };
  } catch (error) {
    console.error('[自动跟单] 提取/执行交易信号失败:', error);
    return { success: false, error: error.message };
  }
}

// Core sync and analysis function
export async function syncAndAnalyze({ backfill = false, skipTrades = false, skipWeChat = false, skipReport = false } = {}) {
  const userToken = process.env.WHOP_USER_TOKEN;
  const cookie = process.env.WHOP_COOKIE;

  // Support multiple channels configuration
  const channelIdsStr = process.env.WHOP_CHAT_CHANNEL_IDS || process.env.WHOP_CHAT_CHANNEL_ID || '';
  const channelIds = channelIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let channelRegistry = {};
  try {
    const regPath = path.join(process.cwd(), 'config', 'channel_registry.json');
    if (fs.existsSync(regPath)) {
      channelRegistry = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load channel_registry.json in monitor.js:', err.message);
  }

  let channelMappings = {};
  // 权威登记册是唯一主干
  for (const [fId, info] of Object.entries(channelRegistry)) {
    channelMappings[fId] = info.name;
  }

  // 覆盖兜底（以防有未登记的 feedId）
  channelIds.forEach(id => {
    if (!channelMappings[id]) {
      channelMappings[id] = channelRegistry[id]?.name || `频道:${id}`;
    }
  });

  if (!cookie && (!userToken || channelIds.length === 0 || targetSpeakers.length === 0)) {
    console.warn('Sync skipped: Missing WHOP_COOKIE, WHOP_USER_TOKEN, WHOP_CHAT_CHANNEL_IDS, or TARGET_SPEAKER_USER_IDS in environment.');
    return { success: false, reason: 'Missing configuration' };
  }

  let allNormalizedMessages = [];
  let allNewMessages = [];
  let newSpeakerMessages = [];
  let totalNewMessagesCount = 0;

  try {
    for (const channelId of channelIds) {
      const channelName = channelMappings[channelId] || channelId;
      console.log(`Starting sync for channel: ${channelName} (${channelId})...`);

      let rawMessages = [];

      if (cookie) {
        console.log(`Fetching messages from Whop GraphQL for channel: ${channelName}...`);
        let beforeCursor = null;
        const pagesToFetch = 200; // Let's support up to 200 pages (20,000 messages) for deep backfill
        
        for (let page = 1; page <= pagesToFetch; page++) {
          console.log(`Fetching page ${page} of messages from Whop GraphQL for ${channelName} (before: ${beforeCursor})...`);
          try {
            const response = await webFetch('https://whop.com/api/graphql/MessagesFetchFeedPosts/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
              body: JSON.stringify({
                query: MESSAGES_FETCH_FEED_POSTS_QUERY,
                variables: {
                  feedId: channelId,
                  feedType: channelId.startsWith('forum_feed_') ? 'forum_feed' : 'chat_feed',
                  limit: 100,
                  before: beforeCursor,
                  direction: 'desc',
                  includeDeleted: false
                },
                operationName: 'MessagesFetchFeedPosts'
              })
            });

            if (!response.ok) {
              const errText = await response.text();
              console.error(`Failed to fetch Whop messages page ${page} for ${channelName}: ${response.status} - ${errText}`);
              break;
            }

            const resJson = await response.json();
            if (resJson.errors) {
              console.error(`GraphQL errors for ${channelName}:`, JSON.stringify(resJson.errors));
            }
            const posts = resJson.data?.feedPosts?.posts || [];
            const users = resJson.data?.feedPosts?.users || [];

            if (posts.length === 0) {
              console.log(`No more posts found on page ${page} for ${channelName}.`);
              break;
            }

            // Check if the oldest message on this page is already in the database
            const oldestPost = posts[posts.length - 1];
            let shouldStopAfterPage = false;
            if (!backfill && oldestPost && oldestPost.id && isMessageArchived(oldestPost.id)) {
              console.log(`Oldest post on page ${page} (${oldestPost.id}) is already archived in DB. Stopping historical fetch after this page.`);
              shouldStopAfterPage = true;
            }

            // Create user dictionary for mapping
            const userMap = new Map();
            if (Array.isArray(users)) {
              for (const u of users) {
                userMap.set(u.id, u.name || u.username || 'Unknown User');
              }
            }

            // Convert GraphQL posts to normalized format with image attachments
            const pageMessages = posts.map(post => {
              const timeNum = Number(post.createdAt || Date.now());
              const timeMs = timeNum < 9999999999 ? timeNum * 1000 : timeNum;
              
              let content = post.content || '';
              if (post.title) {
                content = `【${post.title}】\n${content}`;
              }
              if (Array.isArray(post.attachments)) {
                const imageUrls = post.attachments
                  .filter(a => a.contentType?.startsWith('image/') || a.__typename === 'ImageAttachment')
                  .map(a => a.source?.url)
                  .filter(Boolean);
                
                if (imageUrls.length > 0) {
                  content += '\n' + imageUrls.map(url => `[IMAGE:${url}]`).join('\n');
                }
              }

              return {
                id: post.id,
                message_id: post.id,
                content: content,
                user: {
                  id: post.userId,
                  username: userMap.get(post.userId) || post.customAuthor?.displayName || 'Unknown User'
                },
                created_at: new Date(timeMs).toISOString(),
                attachments: Array.isArray(post.attachments) ? post.attachments : null,
                rawAttachments: Array.isArray(post.attachments) ? post.attachments : null
              };
            });

            rawMessages.push(...pageMessages);

            if (shouldStopAfterPage) {
              break;
            }

            // Get cursor for next page
            const oldestOfPage = posts[posts.length - 1];
            if (oldestOfPage && oldestOfPage.createdAt) {
              beforeCursor = oldestOfPage.createdAt.toString();
            } else {
              break;
            }
          } catch (fetchErr) {
            console.error(`Network error fetching Whop page ${page} for ${channelName}:`, fetchErr.message);
            break;
          }
        }
      } else {
        console.log(`Fetching messages from Whop REST API for channel: ${channelName}...`);
        const url = `https://api.whop.com/api/v1/messages?channel_id=${channelId}&limit=100`;
        try {
          const response = await webFetch(url, {
            headers: {
              'Authorization': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errText = await response.text();
            console.error(`Failed to fetch Whop messages for ${channelName}: ${response.status} - ${errText}`);
            continue;
          }

          const resJson = await response.json();
          let normalizedRest = [];
          if (Array.isArray(resJson)) {
            normalizedRest = resJson;
          } else if (resJson && Array.isArray(resJson.data)) {
            normalizedRest = resJson.data;
          } else if (resJson && Array.isArray(resJson.messages)) {
            normalizedRest = resJson.messages;
          }

          const restMessages = normalizedRest.map(msg => {
            let content = msg.content || msg.text || msg.body || '';
            if (Array.isArray(msg.attachments)) {
              const imageUrls = msg.attachments
                .filter(a => a.content_type?.startsWith('image/') || a.contentType?.startsWith('image/') || a.url)
                .map(a => a.url || a.source?.url)
                .filter(Boolean);
              
              if (imageUrls.length > 0) {
                content += '\n' + imageUrls.map(url => `[IMAGE:${url}]`).join('\n');
              }
            }
            return {
              ...msg,
              content,
              attachments: Array.isArray(msg.attachments) ? msg.attachments : null,
              rawAttachments: Array.isArray(msg.attachments) ? msg.attachments : null
            };
          });
          rawMessages.push(...restMessages);
        } catch (err) {
          console.error(`REST API error fetching ${channelName}:`, err.message);
          continue;
        }
      }

      if (rawMessages.length === 0) {
        console.log(`No messages found in channel: ${channelName}`);
        continue;
      }

      // Parse and normalize messages
      const normalizedMessages = rawMessages.map((msg) => {
        const id = msg.id || msg.message_id || `temp_${Math.random().toString(36).substr(2, 9)}`;
        const content = msg.content || msg.text || msg.body || '';
        
        let senderId = '';
        let senderName = 'Unknown User';
        if (msg.user) {
          senderId = msg.user.id || '';
          senderName = msg.user.username || msg.user.name || 'Unknown User';
        } else if (msg.author) {
          senderId = msg.author.id || '';
          senderName = msg.author.username || msg.author.name || 'Unknown User';
        } else {
          senderId = msg.sender_id || '';
        }

        return {
          id,
          channel_id: msg.channel_id || channelId,
          channel_name: msg.channel_name || channelName,
          sender_id: senderId,
          sender_name: senderName,
          content,
          created_at: typeof msg.created_at === 'number' ? msg.created_at : new Date(msg.created_at || Date.now()).getTime(),
          attachments: msg.attachments || null,
          rawAttachments: msg.rawAttachments || msg.attachments || null
        };
      });

      // Filter out messages that are already in the DB to count actual new ones
      const actuallyNewMessages = normalizedMessages.filter(msg => !isMessageArchived(msg.id));
      
      // 行业标准正方案：在消息写入 SQLite 的同一秒，同步抓取活签下载附件并落盘！
      for (const msg of actuallyNewMessages) {
        try {
          const persistedAttachments = await downloadAndPersistAttachments(msg);
          if (persistedAttachments) {
            msg.attachments = persistedAttachments;
            try {
              updateMessageAttachments(msg.id, persistedAttachments);
            } catch (uErr) {}
          }
        } catch (e) {
          console.error(`[MediaDownloader] 同步下载附件异常 (${msg.id}):`, e.message);
        }
      }

      actuallyNewMessages.forEach(msg => {
        if (targetSpeakers.includes(msg.sender_id)) {
          newSpeakerMessages.push(msg);
        }
      });

      allNormalizedMessages.push(...normalizedMessages);
      allNewMessages.push(...actuallyNewMessages);
      totalNewMessagesCount += actuallyNewMessages.length;
    }

    if (allNormalizedMessages.length === 0) {
      return { success: true, newMessagesCount: 0, newSpeakerMessagesCount: 0 };
    }

    // 仅当本轮抓取到真正未入库的新消息时，才排序并写入数据库。
    // 严禁对已归档历史消息 (allNormalizedMessages) 重复 upsert，否则将反复触发 FTS5 全文索引维护
    // 导致 Node 事件循环卡死数十秒，引发看门狗与外部 HTTP 探测超时。
    if (allNewMessages.length > 0) {
      allNewMessages.sort((a, b) => a.created_at - b.created_at);
      await saveMessages(allNewMessages);
    }

    // 🏛️ 中断上半部 (Top Half / ISR): 全频道一视同仁快速打标分发 + 丢入下半部队列 (耗时 < 10ms，绝不调模型)
    // 仅分发本轮真正的新消息 (allNewMessages)，而非全部抓取到的消息 (allNormalizedMessages)。
    // 否则每轮会对已归档的历史消息重复 upsert，触发 messages 的 FTS5 同步触发器，
    // 在近十万行的表上把事件循环占满数十秒~数分钟，导致 HTTP (8085) 无响应。
    try {
      const ISR_YIELD_BATCH = 200;
      for (let i = 0; i < allNewMessages.length; i++) {
        dispatchIngestTopHalf(allNewMessages[i], { skipMessageUpsert: true });
        // 大批量新消息时定期让出事件循环，避免同步循环阻塞 HTTP 请求
        if ((i + 1) % ISR_YIELD_BATCH === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      if (allNewMessages.length > 0) {
        console.log(`[ISR Top Half] 已分发 ${allNewMessages.length} 条新消息 (本轮抓取 ${allNormalizedMessages.length} 条)`);
      }
      generateQueueStatus();
    } catch (isrErr) {
      console.error('[ISR Top Half] 分发写入异常:', isrErr.message);
    }

    // 🏛️ 中断下半部 (Bottom Half / DPC): 异步非阻塞执行（受背压控制器保护）
    if (!shouldPauseSecondaryWorkers()) {
      setImmediate(() => {
        runMediaWorker(10)
          .then(() => generateQueueStatus())
          .catch(err => console.error('[DPC Media Worker] 异步下半部异常:', err.message));
      });
    } else {
      console.log('[DPC Media Worker] ⚠️ 系统处于背压降级状态，本轮跳过媒体下载以保全主线程');
    }

    // Process campaigns for new speaker messages
    for (const msg of newSpeakerMessages) {
      try {
        await processMessageForCampaigns(msg);
      } catch (err) {
        console.error(`[Campaign Engine] Failed to process campaign for message ${msg.id}:`, err.message);
      }
    }
    
    // Check and close stale campaigns periodically
    try {
      checkAndCloseStaleCampaigns();
    } catch (err) {
      console.error('[Campaign Engine] Failed to clean up stale campaigns:', err.message);
    }

    const conn = getDb();
    const placeholders = targetSpeakers.map(() => '?').join(',');
    // 根本解决：为防止数万条历史积压喊单发言一次性打包给 AI 导致超时卡死或内存溢出，单次轮询提取限制为 20 条
    const pendingMessages = conn.prepare(`
      SELECT * FROM messages 
      WHERE sender_id IN (${placeholders}) AND (is_traded = 0 OR is_pushed = 0)
      ORDER BY created_at ASC
      LIMIT 20
    `).all(...targetSpeakers);

    if (pendingMessages.length === 0) {
      return { success: true, newMessagesCount: totalNewMessagesCount, newSpeakerMessagesCount: 0 };
    }

    const now = Date.now();
    const REALTIME_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes threshold for real-time messages

    const realTimePushMsgs = [];
    const realTimeTradeMsgs = [];
    const oldMsgsToMark = [];

    for (const msg of pendingMessages) {
      const isRealtime = (now - msg.created_at) < REALTIME_THRESHOLD_MS;
      
      // a. 微信推送分流：只有真正实时且未推送的，才加入推送队列
      if (isRealtime && msg.is_pushed === 0) {
        realTimePushMsgs.push(msg);
      } else if (!isRealtime && msg.is_pushed === 0) {
        // 历史积压消息直接登记为已推送状态，免除微信骚扰
        oldMsgsToMark.push(msg);
      }
      
      // b. 交易提取分流：只要是未提炼过跟单交易的消息，无视时效限制，100% 递交提取
      if (msg.is_traded === 0) {
        realTimeTradeMsgs.push(msg);
      }
    }

    // 1. 将老旧发言仅在数据库中标记为已推送，防刷群屏，但绝不跳过跟单信号提取
    if (oldMsgsToMark.length > 0) {
      console.log(`[同步防回溯] 发现 ${oldMsgsToMark.length} 条超时积压发言。将其登记为已推送避噪，但保留其跟单提炼资格。`);
      const updatePushed = conn.prepare('UPDATE messages SET is_pushed = 1 WHERE id = ?');
      conn.transaction((msgs) => {
        for (const m of msgs) {
          updatePushed.run(m.id);
        }
      })(oldMsgsToMark);
    }

    // 2. Push real-time messages to WeChat Work
    if (realTimePushMsgs.length > 0) {
      if (!skipWeChat) {
        console.log(`[实时通知] 发现 ${realTimePushMsgs.length} 条大V实时新发言，触发即时推送...`);
        for (const msg of realTimePushMsgs) {
          await pushRawMessageToWeChat(msg).catch(err => console.error('[即时微信推送错误]:', err.message));
          markMessagePushed(msg.id, 1);
        }
      } else {
        console.log(`[实时通知] 发现 ${realTimePushMsgs.length} 条大V新发言。已忽略推送 (skipWeChat = true)。`);
        for (const msg of realTimePushMsgs) {
          markMessagePushed(msg.id, 1);
        }
      }
    }

    // 3. Extract and execute trades on real-time messages
    let tradeResults = null;
    if (realTimeTradeMsgs.length > 0) {
      if (!skipTrades) {
        console.log(`[自动跟单] 发现 ${realTimeTradeMsgs.length} 条大V实时新发言，触发交易信号提取与执行...`);
        const provider = process.env.AI_PROVIDER || 'lm-studio';
        const primarySpeakerName = realTimeTradeMsgs[0].sender_name;
        try {
          tradeResults = await extractAndExecuteTrades(realTimeTradeMsgs, provider, primarySpeakerName);
        } catch (tradeErr) {
          console.error('Failed in extractAndExecuteTrades:', tradeErr);
        }
      } else {
        console.log(`[自动跟单] 发现 ${realTimeTradeMsgs.length} 条新发言。已忽略自动跟单 (skipTrades = true)。`);
      }
      
      const updateTraded = conn.prepare('UPDATE messages SET is_traded = 1 WHERE id = ?');
      conn.transaction((msgs) => {
        for (const m of msgs) {
          updateTraded.run(m.id);
        }
      })(realTimeTradeMsgs);
    }

    // 4. Trigger heavy AI report generation asynchronously in the background (Disabled in favor of Daily News Summary Integration)
    console.log('[Background AI] 实时策略简报生成已关闭（按大合并规划已归口合并到每日时段总结中）。');

    return {
      success: true,
      newMessagesCount: totalNewMessagesCount,
      newSpeakerMessagesCount: realTimePushMsgs.length,
      tradeResults
    };
  } catch (error) {
    console.error('Error in syncAndAnalyze:', error);
    const detail = error.cause ? ` (原因: ${error.cause.message || error.cause})` : '';
    return { success: false, reason: error.message + detail };
  }
}

// --------------------------------------------------------------------------
// Helper Functions for Instant WeChat Push & Background AI Report
// --------------------------------------------------------------------------

// Helper: Send native image message to WeChat Work robot (base64 + md5)
export async function pushImageToWeChat(webhookUrl, buffer) {
  if (!webhookUrl || !buffer || buffer.length === 0) return false;
  try {
    if (buffer.length > 2 * 1024 * 1024) {
      console.warn(`[WeChat Push] 图片大于 2MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB)，跳过原生图片直接推送`);
      return false;
    }
    const base64 = buffer.toString('base64');
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
    const response = await webFetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'image',
        image: {
          base64,
          md5
        }
      })
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      console.error(`[WeChat Image Push] HTTP ${response.status}: ${err}`);
      return false;
    }
    const resJson = await response.json().catch(() => ({}));
    if (resJson.errcode !== 0) {
      console.error(`[WeChat Image Push] API errcode=${resJson.errcode}, errmsg=${resJson.errmsg}`);
      return false;
    }
    console.log('[WeChat Image Push] ✅ 原生图片消息成功推送至企业微信');
    return true;
  } catch (err) {
    console.error(`[WeChat Image Push] 发送图片异常:`, err.message);
    return false;
  }
}

// Push raw message from target speaker instantly to WeChat Work
export async function pushRawMessageToWeChat(msg) {
  const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const channelStr = msg.channel_name ? `[${msg.channel_name}]` : '';

  // 1. 提取所有关联的图片 (支持已落盘 local_path 或 URL)
  const imageUrls = [];
  const imageBuffers = [];

  let attachments = msg.attachments;
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); } catch (e) { attachments = []; }
  }
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att.local_path && fs.existsSync(att.local_path)) {
        try {
          imageBuffers.push(fs.readFileSync(att.local_path));
        } catch (e) {}
      } else if (att.raw_url || att.url) {
        const u = att.raw_url || att.url;
        if (!imageUrls.includes(u)) imageUrls.push(u);
      }
    }
  }

  // 从 content 中的 [IMAGE:...] 提取
  const regex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
  let match;
  while ((match = regex.exec(msg.content || '')) !== null) {
    const u = match[1];
    if (!imageUrls.includes(u)) {
      imageUrls.push(u);
    }
  }

  // 若本地尚无 buffer，通过 downloadBuffer 带鉴权拉取
  for (const u of imageUrls) {
    try {
      const buf = await downloadBuffer(u);
      if (buf && buf.length > 0) {
        imageBuffers.push(buf);
      }
    } catch (e) {
      console.warn(`[即时消息推送] 获取推送图片失败 (${u.slice(0, 60)}...):`, e.message);
    }
  }

  // 2. 原生推送所有图片 (优先于文字或与文字配对)
  for (const buf of imageBuffers) {
    await pushImageToWeChat(webhookUrl, buf);
  }

  // 3. 清理正文中冗长丑陋的 [IMAGE:...] 原始链接，保留纯净分析文字
  let cleanContent = (msg.content || '').replace(/\[IMAGE:(https?:\/\/[^\]]+)\]/g, '').trim();
  if (!cleanContent && imageBuffers.length > 0) {
    cleanContent = '📷 [大V盘面图片分享]';
  } else if (!cleanContent) {
    cleanContent = '（无文字内容）';
  }

  const text = `${cleanContent}

💬 ${msg.sender_name}${channelStr} · ${timeStr}
已同步处理量化跟单`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content: text }
      })
    });
    console.log(`[即时消息推送] 成功推送大V发言到微信: ${msg.id}`);
  } catch (err) {
    console.error(`[即时消息推送失败] 无法推送大V发言到微信:`, err.message);
  }
}

// Generate AI Report asynchronously in the background
async function generateAIReportBackground(newSpeakerMessages, provider, primarySpeakerName, channelIds, channelMappings) {
  console.log(`[Background AI] Starting async AI report generation for ${newSpeakerMessages.length} messages...`);
  const startTimeAI = Date.now();
  
  // Get context messages (preceding 3 messages for brevity and speed)
  const enrichedMessages = getMessagesWithContext(newSpeakerMessages, 3);
  const messagesText = formatMessagesWithContextForAI(enrichedMessages);
  const mappingStr = process.env.LEVERAGED_ETF_MAPPING || 'NVDA:NVDL,TSLA:TSLL,LITE:LITX';

  const aiPrompt = `你是一位资深的美股金融投资分析师。以下是美股社区群主/大V [${primarySpeakerName}] 在近期的一段发言记录，其中包含群友提问的前后上下文背景。
请根据这些发言内容，进行专业的整理、提炼和深度分析，为订阅者提供交易参考。

你必须生成一份结构化的 Markdown 简报，格式如下：

### 📌 宏观与大盘分析
- [宏观态度与大盘走势判断，看多/看空/防守等]

### 🎯 策略战法分类识别
对以下战法/策略概念进行识别并分类总结（如果发言中提及或隐含了该策略，请写出具体操作和标的；如未提及则写“无”）：
- **财报战法**（利用财报事件/预期进行博弈）：
- **节日被动减仓**（因节假日放假避险或资金周转进行的被动减仓）：
- **单调减仓**（仓位持续递减、只出不进）：
- **尾盘强平/买入**（尾盘阶段进行的强行平仓或尾盘交易）：
- **做T/波段套利**（底仓基础上的日内/波段T+0操作）：
- **弹性股防御**（市场防守期选择弹性好的个股或特定防御标的）：

### 📈 关注个股及板块梳理
按板块列出涉及的个股，并说明其投资逻辑：
- **[板块名称，如科技/AI芯片、新能源汽车、加密货币等]**：
  - **[股票代码]**（请用粗体高亮，如 **TSLA**）：[具体仓位、操作价格区间、止盈止损线及核心逻辑支撑]

### 🛡️ 跟单建议与风控提示
- [对普通投资者的具体跟单操作指引与防守风控要点]
- [战略性提示：对于做日内短线、做T等操作，如果被分析的正股价格较贵或其股性波动较小，提示订阅者可以考虑使用对应的 2 倍做多 ETF 代替（代用映射参考：${mappingStr}），但强调这仅是备选策略，而非最终下单决策。]

注意要求：
- 如果发言仅是日常闲聊、没有具体的投资交易信号，请做简要总结，并在报告顶部声明“本次同步未检测到具体交易信号”，不要胡乱编造。
- 必须严格遵循上述指定的 Markdown 结构和标题输出。排版要精美、段落清晰、重点突出。

发言记录如下（按时间先后顺序排列，其中标有 [主发言人] 的是群主/大V的发言，标有 [群友上下文] 的是群友的提问，你必须结合群友上下文的问题背景来准确理解大V的简短回答）：
${messagesText}`;

  let summaryContent = '';
  summaryContent = await analyzeWithFallback(aiPrompt, { provider });
  
  let modelNameUsed = 'Gemini';
  if (provider === 'ollama') {
    modelNameUsed = 'Ollama (' + (process.env.OLLAMA_MODEL || 'deepseek-r1') + ')';
  } else if (provider === 'lm-studio') {
    modelNameUsed = 'LM Studio (' + (process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct') + ')';
  }

  const durationAI = ((Date.now() - startTimeAI) / 1000).toFixed(1);
  console.log(`[Background AI] AI Strategy report generated successfully! Elapsed: ${durationAI}s. Length: ${summaryContent.length} chars.`);

  // Save report to DB
  const startTime = newSpeakerMessages[0].created_at;
  const endTime = newSpeakerMessages[newSpeakerMessages.length - 1].created_at;
  

  saveReport({
    startTime,
    endTime,
    summaryContent,
    aiModel: modelNameUsed,
    rawMessagesCount: newSpeakerMessages.length,
  });
  console.log(`[Background AI] Report saved to local SQLite.`);

  // Push to WeChat Work
  const activeChannelsStr = channelIds.map(id => channelMappings[id] || id).join(', ');
  const title = `### 🤖 Whop AI 投资策略简报\n**发言人**: ${primarySpeakerName}\n**监控频道**: ${activeChannelsStr}\n**时间区间**: ${new Date(startTime).toLocaleString('zh-CN')} - ${new Date(endTime).toLocaleString('zh-CN')}\n**分析模型**: ${modelNameUsed}\n\n---\n\n`;
  
  await pushToWeChat(process.env.WECHAT_WORK_WEBHOOK_URL, title + summaryContent);
  console.log(`[Background AI] Strategy report pushed to WeChat.`);
}

// Helper for AI calls within monitor.js — bulk text always local-14B first
async function callMonitorAI(provider, prompt) {
  return await analyzeWithFallback(prompt, { provider, tag: 'monitor' });
}

// Extract tickers as array from message content
function getTickersFromMessages(messages) {
  const tickers = new Set();
  for (const msg of messages) {
    const dims = extractTradingDimensions(msg.content);
    if (dims.tickers) {
      const list = dims.tickers.split(',').filter(Boolean);
      list.forEach(t => tickers.add(t));
    }
  }
  return Array.from(tickers);
}

// Incremental Global AI Rolling Strategy briefing
export async function generateGlobalRollingReport(provider = 'lm-studio') {
  console.log('[Global Report] Starting incremental global rolling strategy briefing generation...');
  const conn = getDb();
  
  // Find the latest rolling report
  const latestGlobalReport = conn.prepare(`
    SELECT * FROM reports 
    WHERE strategy = 'GLOBAL_ROLLING' 
    ORDER BY created_at DESC LIMIT 1
  `).get();

  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (targetSpeakers.length === 0) {
    return { success: false, reason: 'TARGET_SPEAKER_USER_IDS not set' };
  }

  const placeholders = targetSpeakers.map(() => '?').join(',');
  
  let newMessages = [];
  let previousReportContent = '';
  let startTimeMs = 0;
  let endTimeMs = 0;

  if (!latestGlobalReport) {
    console.log('[Global Report] No previous global report found. Initializing global report with the last 120 messages...');
    // Initial run: fetch the last 120 messages
    newMessages = conn.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE sender_id IN (${placeholders}) 
        ORDER BY created_at DESC LIMIT 120
      ) ORDER BY created_at ASC
    `).all(...targetSpeakers);

    if (newMessages.length === 0) {
      return { success: false, reason: 'No influencer messages found in database to summarize.' };
    }

    startTimeMs = newMessages[0].created_at;
    endTimeMs = newMessages[newMessages.length - 1].created_at;
  } else {
    console.log(`[Global Report] Found previous global report (ID: ${latestGlobalReport.id}, End Time: ${new Date(latestGlobalReport.end_time).toLocaleString()}). Fetching incremental new messages...`);
    
    newMessages = conn.prepare(`
      SELECT * FROM messages 
      WHERE sender_id IN (${placeholders}) AND created_at > ?
      ORDER BY created_at ASC
    `).all(...targetSpeakers, latestGlobalReport.end_time);

    if (newMessages.length === 0) {
      console.log('[Global Report] No new messages since last update. Skipping briefing generation.');
      return { success: true, updated: false, report: latestGlobalReport };
    }

    previousReportContent = latestGlobalReport.summary_content;
    startTimeMs = latestGlobalReport.start_time;
    endTimeMs = newMessages[newMessages.length - 1].created_at;
  }

  // Format messages
  const newMessagesText = newMessages
    .map(msg => `[${new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] ${msg.sender_name}: ${msg.content}`)
    .join('\n\n');

  // Fetch K-line market data for mentioned tickers in the new batch
  const tickers = getTickersFromMessages(newMessages);
  const klineStats = await getMarketContextForTickers(tickers);

  let prompt = '';
  if (!latestGlobalReport) {
    // Initial prompt
    prompt = `你是一位顶尖的美股宏观与量化策略投资分析师。请根据以下大V历史发言，生成一份全面的【全局AI投资策略简报】。
此报告旨在梳理大V的长期宏观观点、核心关注板块及具体操作细节。

最新个股 K 线行情数据参考：
${klineStats}

大V发言历史数据源：
${newMessagesText}

你必须生成一份极其详尽且结构化的 Markdown 报告，格式如下：

# 🌐 全局 AI 投资策略简报 (Rolling Briefing)

## 📌 一、宏观大盘走势与多空偏好分析
- 详细总结大V对美股大盘（如 SPY、QQQ、IWM）当前位置的看法，倾向于看多、看空还是防御防守？
- 梳理大V在宏观层面的核心判断逻辑。

## 🎯 二、核心战法与策略分类盘点
- 识别并列举大V目前使用的操盘战法（如：做T/波段、财报战法、假前/节日减仓防守、尾盘强平/买入、弹性股防御、单调减仓等）。
- 详细解释大V是如何在不同市场环境下实施这些战法的。

## 📊 三、标的物价格区间与执行细节清单
- 整理发言中提及的重点个股，制作一个 Markdown 表格：
| 股票代码 | 操作建议/方向 (买入/卖出/做T/观望) | 大V点位/价格区间 | 最新行情 (当前价/5日均线) | 核心风控支撑/压力位与操作逻辑 |
- 注：最新行情列的数据请结合上方提供的 K线行情数据进行对比填入。

## 🛡️ 四、全局风控指南与实战金句
- 提炼发言中最核心的投资风控原则（使用引用块 \`>\` 突出）。
- 普通跟单者在使用此策略时，应该如何做心态管理与仓位配置控制？`;
  } else {
    // Incremental prompt
    prompt = `你是一位顶尖的美股宏观与量化策略投资分析师。
我们已经有一份基于历史发言生成的【上期全局AI投资策略简报】，现在收到了一批【最新发言数据】和【最新个股K线行情数据】。
请在【上期全局AI投资策略简报】的基础上进行**增量更新调整**，融合新的发言内容，并输出一份最新的完整全局简报。

要求：
1. **不要从头重写**：保留上期简报中仍然有效的历史观点、关注板块和风控原则。
2. **增量整合**：如果最新发言中大V改变了对大盘的看法，或对个股点位做出了修正、加仓、做T或卖出，请在最新简报的相应章节进行更新。
3. **个股价格更新**：更新标的表格中的最新行情和逻辑点位。

【上期全局AI投资策略简报】：
${previousReportContent}

【最新个股 K 线行情数据】：
${klineStats}

【大V最新发言数据】：
${newMessagesText}

请输出更新后的完整最新 Markdown 全局简报，结构须与上期保持一致。`;
  }

  console.log('[Global Report] Calling LLM for incremental briefing...');
  const summaryContent = await callMonitorAI(provider, prompt);
  
  let modelNameUsed = 'Gemini';
  if (provider === 'ollama') {
    modelNameUsed = `Ollama (${process.env.OLLAMA_MODEL || 'deepseek-r1'})`;
  } else if (provider === 'lm-studio') {
    modelNameUsed = `LM Studio (${process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct'})`;
  }

  // Save to DB
  const reportId = saveReport({
    startTime: startTimeMs,
    endTime: endTimeMs,
    summaryContent: summaryContent,
    aiModel: modelNameUsed,
    rawMessagesCount: newMessages.length,
    strategy: 'GLOBAL_ROLLING'
  });

  console.log(`[Global Report] Rolling report saved to DB (ID: ${reportId}).`);

  // Push to WeChat
  const title = `### 🌐 Whop AI 全局滚动策略简报\n**更新时间**: ${new Date().toLocaleString('zh-CN')}\n**分析模型**: ${modelNameUsed}\n**新增发言**: ${newMessages.length} 条\n\n---\n\n`;
  await pushToWeChat(process.env.WECHAT_WORK_WEBHOOK_URL, title + summaryContent).catch(err => console.error('[微信推送错误]:', err.message));

  return { success: true, updated: true, reportId, summaryContent };
}

// Generate K-line combined technical analysis report
export async function generateKlineCombinedReport(provider = 'lm-studio') {
  console.log('[Kline Report] Starting K-line combined technical analysis report generation...');
  const conn = getDb();

  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (targetSpeakers.length === 0) {
    return { success: false, reason: 'TARGET_SPEAKER_USER_IDS not set' };
  }

  const placeholders = targetSpeakers.map(() => '?').join(',');

  // Fetch the last 40 messages
  const messages = conn.prepare(`
    SELECT * FROM (
      SELECT * FROM messages 
      WHERE sender_id IN (${placeholders}) 
      ORDER BY created_at DESC LIMIT 40
    ) ORDER BY created_at ASC
  `).all(...targetSpeakers);

  if (messages.length === 0) {
    return { success: false, reason: 'No messages found in database.' };
  }

  const tickers = getTickersFromMessages(messages);
  if (tickers.length === 0) {
    return { success: false, reason: 'No tickers found in recent messages to run technical analysis.' };
  }

  const klineStats = await getMarketContextForTickers(tickers);

  const messagesText = messages
    .map(msg => `[${new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] [${msg.channel_name}] ${msg.sender_name}: ${msg.content}`)
    .join('\n\n');

  const prompt = `你是一位资深的美股技术分析师与量化交易策略师。
我们将大V近期的社区发言与对应的个股 K 线走势及技术指标进行了融合。
请编写一份极其专业、基于行情数据支撑的【K线走势融合策略分析研报】。

大V近期社区发言记录：
${messagesText}

Yahoo Finance 实时个股 K 线技术行情（SMA5、收盘趋势、5日高低范围）：
${klineStats}

你必须生成一份深度的 Markdown 分析报告，格式如下：

# 📈 K线走势与大V策略融合分析报告

## 📌 一、宏观走势与喊单标的合理性校验
- 分析当前市场整体背景下，大V针对各个标的的操作方向（多/空）是否与该标的的短期趋势（如收盘趋势、5日均线）相符？
- 标明哪些操作属于**顺势交易**，哪些属于**逆势博弈**（如超跌低吸、摸顶）。

## 🔍 二、标的技术面诊断与点位校验
针对涉及的核心股票进行逐一诊断：
### 1. [股票代码，如 **TSLA**]
- **大V建议点位**：大V发言中要求的买入价/卖出价/做T区间。
- **K线形态与均线诊断**：分析当前最新价格与5日均线 (SMA5) 的相对位置，5日收盘趋势显示是在走强还是走弱？
- **点位可行性评估**：大V要求的买入点位是否在5日波动范围 (Low-High) 内？是否有明确的支撑位支撑？如果价格已经偏离，当前最新的合理介入点位应该是多少？

## 🛡️ 三、精密风控计划与下单跟单指南
- 综合个股的技术走势，为普通跟单者制定精确的入场方案。
- 给出每个股票推荐的**止损设置（根据K线低点）**以及**第一止盈区**、**第二止盈区**。
- 提供大本金与小本金投资者的仓位分级防守建议。`;

  console.log('[Kline Report] Calling LLM for technical report...');
  const summaryContent = await callMonitorAI(provider, prompt);

  let modelNameUsed = 'Gemini';
  if (provider === 'ollama') {
    modelNameUsed = `Ollama (${process.env.OLLAMA_MODEL || 'deepseek-r1'})`;
  } else if (provider === 'lm-studio') {
    modelNameUsed = `LM Studio (${process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct'})`;
  }

  // Save report to DB (strategy = 'KLINE_COMBINED')
  const startTime = messages[0].created_at;
  const endTime = messages[messages.length - 1].created_at;

  const reportId = saveReport({
    startTime,
    endTime,
    summaryContent,
    aiModel: modelNameUsed,
    rawMessagesCount: messages.length,
    strategy: 'KLINE_COMBINED'
  });

  console.log(`[Kline Report] Technical report saved to DB (ID: ${reportId}).`);

  // Push to WeChat Work
  const title = `### 📈 Whop AI K线走势融合分析研报\n**生成时间**: ${new Date().toLocaleString('zh-CN')}\n**分析模型**: ${modelNameUsed}\n**分析个股**: ${tickers.join(', ')}\n\n---\n\n`;
  await pushToWeChat(process.env.WECHAT_WORK_WEBHOOK_URL, title + summaryContent).catch(err => console.error('[微信推送错误]:', err.message));

  return { success: true, reportId, summaryContent };
}
