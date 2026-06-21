/**
 * persona-engine.js — 大V行为画像引擎
 * 
 * 核心设计原则：
 * 1. 本地优先：所有纯文本 AI 分析任务默认走本地 LM Studio
 * 2. 图片才上云：仅大V图片和群友量化工具截图使用 Gemini 多模态
 * 3. 增量更新：首次全量生成后，后续只分析新消息并合并进现有白皮书
 */

import dotenv from 'dotenv';
import {
  getAllSpeakerMessagesChronological,
  getMessagesExcludingSpeakers,
  getLatestPersonaPlaybook,
  saveReport,
  getDb,
  getLuckyUserIds,
  getSpecificCommunityMessages,
  getFilteredCommunityMessages
} from './database.js';
import {
  analyzeWithGeminiMultimodal,
  extractImageUrls,
  analyzeWithGemini,
  analyzeWithLMStudio,
  analyzeWithOllama
} from './monitor.js';
import { addTask } from './task-queue.js';

dotenv.config();

// ============================================================
// 全局画像生成状态（用于前端轮询）
// ============================================================
const personaStatus = {
  status: 'idle',   // 'idle' | 'running' | 'done' | 'error'
  progress: '',
  percent: 0,
  error: null
};

export function getPersonaStatus() {
  const db = getDb();
  
  // Find the latest persona_reduce task
  const latestTask = db.prepare(`
    SELECT id, payload, status, error_message FROM task_queue 
    WHERE task_type = 'persona_reduce'
    ORDER BY id DESC LIMIT 1
  `).get();
  
  if (!latestTask) {
    return { ...personaStatus };
  }
  
  let batchId;
  try {
    batchId = JSON.parse(latestTask.payload).batchId;
  } catch (err) {
    return { ...personaStatus };
  }
  
  // Query all tasks of this batch
  const allTasks = db.prepare(`
    SELECT id, task_type, status, error_message FROM task_queue
    WHERE json_extract(payload, '$.batchId') = ?
  `).all(batchId);
  
  if (allTasks.length === 0) {
    return { ...personaStatus };
  }
  
  const total = allTasks.length;
  const done = allTasks.filter(t => t.status === 'done').length;
  const running = allTasks.filter(t => t.status === 'running').length;
  const retry = allTasks.filter(t => t.status === 'retry').length;
  const failedTask = allTasks.find(t => t.status === 'failed');
  const reduceTask = allTasks.find(t => t.task_type === 'persona_reduce');
  
  let status = 'running';
  let progress = `正在后台计算大V画像: ${done}/${total} 子任务已完成 (运行中: ${running}, 准备重试: ${retry})`;
  let percent = Math.round((done / total) * 100);
  let error = null;
  
  if (failedTask) {
    status = 'error';
    progress = `画像合成失败: ${failedTask.error_message}`;
    error = failedTask.error_message;
  } else if (reduceTask && reduceTask.status === 'done') {
    status = 'done';
    progress = '✅ 大V交易行为画像白皮书生成成功！';
    percent = 100;
  }
  
  return { status, progress, percent, error };
}

function updateStatus(status, progress, percent) {
  personaStatus.status = status;
  personaStatus.progress = progress;
  personaStatus.percent = percent;
  personaStatus.error = null;
  console.log(`[Persona Status Update] ${progress} (${percent}%)`);
}

function setError(error) {
  personaStatus.status = 'error';
  personaStatus.error = error;
  personaStatus.progress = '生成失败: ' + error;
  console.error(`[Persona Error Update] Error: ${error}`);
}

// ============================================================
// AI 调用路由 — 默认走本地 LM Studio
// ============================================================
async function callLocalAI(provider, prompt) {
  if (provider === 'lm-studio') {
    const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
    const model = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';
    return await analyzeWithLMStudio(baseUrl, model, prompt);
  } else if (provider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'deepseek-r1';
    return await analyzeWithOllama(baseUrl, model, prompt);
  } else if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    return await analyzeWithGemini(apiKey, prompt);
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// ============================================================
// 1. 时间线事件分段器
// ============================================================

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * 判断消息所处的交易时段（美东时间）
 */
function getTradingSession(timestampMs) {
  const date = new Date(timestampMs);
  // 使用 Intl.DateTimeFormat 精确提取美东时间的组件，避免 localeString 字符串被二次解析为本地时区的漂移
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const min = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const totalMin = hour * 60 + min;

  if (totalMin >= 240 && totalMin < 570) return '盘前 Pre-market';    // 4:00-9:30
  if (totalMin >= 570 && totalMin < 960) return '盘中 Regular';       // 9:30-16:00
  if (totalMin >= 960 && totalMin < 1200) return '盘后 After-hours';  // 16:00-20:00
  return '非交易时段';
}

/**
 * 获取美东日期字符串
 */
function getETDateString(timestampMs) {
  return new Date(timestampMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * 将消息流按时间线分段为有意义的事件段
 * 分段规则：4h 间隔切割 + 跨日切割 + 交易时段标注
 */
export function segmentMessagesIntoEvents(messages) {
  if (!messages || messages.length === 0) return [];

  const events = [];
  let currentEvent = null;

  for (const msg of messages) {
    const dateStr = getETDateString(msg.created_at);
    const session = getTradingSession(msg.created_at);
    const imageUrls = extractImageUrls(msg.content);

    if (!currentEvent) {
      // Start first event
      currentEvent = {
        date: dateStr,
        session,
        messages: [msg],
        tickers: new Set(),
        imageUrls: [...imageUrls],
        startTime: msg.created_at,
        endTime: msg.created_at
      };
    } else {
      const timeDiff = msg.created_at - currentEvent.endTime;
      const newDate = dateStr !== currentEvent.date;
      const newSession = session !== currentEvent.session;

      // Cut: time gap > 4 hours OR new calendar day OR session change
      if (timeDiff > FOUR_HOURS_MS || newDate) {
        // Finalize current event
        currentEvent.tickers = Array.from(currentEvent.tickers);
        events.push(currentEvent);

        // Start new event
        currentEvent = {
          date: dateStr,
          session,
          messages: [msg],
          tickers: new Set(),
          imageUrls: [...imageUrls],
          startTime: msg.created_at,
          endTime: msg.created_at
        };
      } else {
        // Append to current event
        currentEvent.messages.push(msg);
        currentEvent.endTime = msg.created_at;
        currentEvent.imageUrls.push(...imageUrls);
        if (newSession) currentEvent.session += ` → ${session}`;
      }
    }

    // Extract tickers from message
    if (msg.tickers) {
      const tickerList = msg.tickers.split(',').filter(Boolean);
      tickerList.forEach(t => currentEvent.tickers.add(t));
    }
  }

  // Finalize last event
  if (currentEvent) {
    currentEvent.tickers = Array.from(currentEvent.tickers);
    events.push(currentEvent);
  }

  return events;
}

// ============================================================
// 2. 单事件 Map 分析器
// ============================================================

/**
 * 格式化事件段消息为 AI 可读文本
 */
function formatEventMessages(event) {
  return event.messages.map(msg => {
    const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const channel = msg.channel_name ? `[${msg.channel_name}]` : '';
    return `[${timeStr}] ${channel} ${msg.sender_name}: ${msg.content}`;
  }).join('\n');
}

const EVENT_ANALYSIS_PROMPT = `你是一位专业的美股交易行为分析师。以下是一位资深交易员在特定时间段内的完整发言记录。

请分析此事件段，提取以下结构化信息（用 JSON 格式输出）：

{
  "actions": [{"type": "买入/卖出/加仓/减仓/止损/观望/建仓", "ticker": "标的代码", "price": "价格", "quantity": "数量或描述", "reason": "决策理由"}],
  "market_view": "他对当前大盘/个股的看法",
  "mood": "自信/犹豫/焦虑/兴奋/冷静",
  "strategy_tags": ["策略标签如: 趋势跟踪, 事件驱动, 财报博弈, 技术反弹, 杠杆抄底, 日内做T"],
  "key_indicators": ["他提到或使用的技术指标/数据"],
  "image_analysis": "如果有图片描述，说明图片内容与操作的关系",
  "summary": "该事件段的一句话总结"
}

注意：
- 如果没有明确的交易操作，actions 可以为空数组
- 重点关注他的决策逻辑和判断依据
- strategy_tags 尽量从以下选取：趋势跟踪、事件驱动、财报博弈、技术反弹、杠杆抄底、日内做T、波段操作、防御减仓、VIX对冲、期权策略`;

const EVENT_ANALYSIS_WITH_IMAGE_PROMPT = `你是一位专业的美股交易行为分析师。以下是一位资深交易员在特定时间段内的完整发言记录，并附带了他分享的图片（可能是K线图、持仓截图、技术指标图等）。

请结合文字和图片内容分析此事件段，提取以下结构化信息（用 JSON 格式输出）：

{
  "actions": [{"type": "买入/卖出/加仓/减仓/止损/观望/建仓", "ticker": "标的代码", "price": "价格", "quantity": "数量或描述", "reason": "决策理由"}],
  "market_view": "他对当前大盘/个股的看法",
  "mood": "自信/犹豫/焦虑/兴奋/冷静",
  "strategy_tags": ["策略标签"],
  "key_indicators": ["他提到或使用的技术指标/数据"],
  "image_analysis": "详细描述每张图片的内容（K线形态、技术指标读数、持仓数据等），并说明图片与他的操作/判断之间的关系",
  "summary": "该事件段的一句话总结"
}

重点：
- 仔细分析图片中的K线形态、均线位置、技术指标数值
- 如果是持仓截图，提取具体持仓标的和盈亏数据
- 说明图片内容如何支撑他的交易决策`;

/**
 * 分析单个事件段
 * - 有大V图片 → Gemini 多模态
 * - 无图片 → 本地 LM Studio
 */
async function analyzeEventSegment(event, provider) {
  const messagesText = formatEventMessages(event);
  const header = `\n【日期】${event.date}\n【交易时段】${event.session}\n【涉及标的】${event.tickers.join(', ') || '无'}\n\n【发言记录】\n${messagesText}`;

  // Check if this event has images from the speaker (大V)
  const speakerImageUrls = event.imageUrls.filter(Boolean);

  if (speakerImageUrls.length > 0) {
    // Use Gemini multimodal for image analysis
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback to text-only if no API key
      console.warn('[Persona] No GEMINI_API_KEY, falling back to text-only for image event');
      const prompt = EVENT_ANALYSIS_PROMPT + header + '\n\n（注意：该事件包含图片但无法加载，请仅基于文字分析）';
      return await callLocalAI(provider, prompt);
    }
    const prompt = EVENT_ANALYSIS_WITH_IMAGE_PROMPT + header;
    return await analyzeWithGeminiMultimodal(apiKey, prompt, speakerImageUrls);
  } else {
    // Text-only → local LLM
    const prompt = EVENT_ANALYSIS_PROMPT + header;
    return await callLocalAI(provider, prompt);
  }
}

// ============================================================
// 3. 群友洞察提取器
// ============================================================

const COMMUNITY_INSIGHT_PROMPT = `你是一位产品分析师。以下是一个美股交易社区中群友（非群主/大V）的发言记录。

请从这些发言中提取以下有价值的信息（用 JSON 格式输出）：

{
  "tool_suggestions": [{"name": "工具/API名称", "description": "描述", "mentioned_by": "谁提到的"}],
  "strategy_discussions": [{"strategy": "策略描述", "context": "讨论背景"}],
  "feature_requests": [{"feature": "功能需求描述", "rationale": "需求原因"}],
  "market_insights": [{"insight": "有价值的市场分析角度", "context": "背景"}]
}

注意：
- 只提取真正有价值的内容，忽略闲聊、问好等无关信息
- tool_suggestions 重点关注：量化工具、交易API、数据源、自动化脚本、分析平台等
- feature_requests 关注群友对跟单系统/分析工具的改进期望
- 如果某段消息没有有价值的信息，对应数组为空即可`;

const COMMUNITY_FOCUS_INSIGHT_PROMPT = `你是一位专业的产品与量化策略分析师。以下是美股交易社区中一位核心开发者群友 @mrzhoulucky (包含关联账号) 的完整发言记录。

该群友正在自主设计、开发量化交易系统和数据分析工具，请仔细阅读其发言，提取以下高价值的系统设计与开发洞察（用 JSON 格式输出）：

{
  "tool_suggestions": [{"name": "工具/API名称", "description": "工具介绍、数据源获取方式（如IBKR）、系统运行模式或性能指标", "mentioned_by": "mrzhoulucky"}],
  "strategy_discussions": [{"strategy": "策略/回测经验", "context": "回测熊市数据、退出策略挂单、趋势捕捉（如1-5日短线）等细节描述"}],
  "feature_requests": [{"feature": "他所使用的或期望开发的系统功能", "rationale": "为什么需要该功能或解决了什么开发难点"}],
  "market_insights": [{"insight": "他的研究表现数据或对交易经验转化为规则的代码开发思路", "context": "详细背景"}]
}

注意：
- 仔细阅读发言内容，尤其是其开发量化系统、获取历史数据、使用Cursor开发等方面的思考
- 即使某些发言看起来像随意的技术闲聊，但如果包含开发细节（例如使用什么接口、回测什么年份、退出策略如何挂单），请务必予以提取
- 如果有图片描述，重点结合图片中展示的系统表现指标（如盈亏曲线、胜率、回撤等数据）进行补充`;

const COMMUNITY_IMAGE_FILTER_PROMPT = `以下群友消息中包含图片。请判断这些图片是否与量化工具开发、交易系统界面、代码截图等技术内容相关。

如果与量化工具相关，请分析图片中展示的工具界面、功能特性、技术细节。
如果与量化工具无关（如表情包、日常截图等），请忽略图片仅分析文字内容。`;

/**
 * 提取群友社区洞察
 */
async function extractCommunityInsights(communityMessages, provider, isFocusGroup = false) {
  if (!communityMessages || communityMessages.length === 0) {
    return { tool_suggestions: [], strategy_discussions: [], feature_requests: [], market_insights: [] };
  }

  const CHUNK_SIZE = 150;
  const chunks = [];
  for (let i = 0; i < communityMessages.length; i += CHUNK_SIZE) {
    chunks.push(communityMessages.slice(i, i + CHUNK_SIZE));
  }

  const chunkResults = [];

  for (let i = 0; i < chunks.length; i++) {
    updateStatus('running', `正在提取群友洞察${isFocusGroup ? '(重点群友)' : '(普通群友)'}... (${i + 1}/${chunks.length})`, -1);

    const chunk = chunks[i];
    const messagesText = chunk.map(msg => {
      const timeStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      return `[${timeStr}] ${msg.sender_name}: ${msg.content}`;
    }).join('\n');

    // Check if any messages have images related to quant tools
    const imageMessages = chunk.filter(msg => extractImageUrls(msg.content).length > 0);
    let result;

    const basePrompt = isFocusGroup ? COMMUNITY_FOCUS_INSIGHT_PROMPT : COMMUNITY_INSIGHT_PROMPT;

    if (imageMessages.length > 0 && process.env.GEMINI_API_KEY) {
      // Only send quant-tool related images to Gemini
      const allImageUrls = [];
      for (const msg of imageMessages) {
        allImageUrls.push(...extractImageUrls(msg.content));
      }
      // Limit to 5 images per chunk
      const limitedUrls = allImageUrls.slice(0, 5);
      const prompt = COMMUNITY_IMAGE_FILTER_PROMPT + '\n\n' + basePrompt + '\n\n【群友发言记录】\n' + messagesText;
      try {
        result = await analyzeWithGeminiMultimodal(process.env.GEMINI_API_KEY, prompt, limitedUrls);
      } catch (err) {
        console.warn(`[Persona] Multimodal failed for community chunk ${i}, falling back to text-only: ${err.message}`);
        result = await callLocalAI(provider, basePrompt + '\n\n【群友发言记录】\n' + messagesText);
      }
    } else {
      // Text-only → local LLM
      result = await callLocalAI(provider, basePrompt + '\n\n【群友发言记录】\n' + messagesText);
    }

    try {
      const parsed = parseJSONSafe(result);
      if (parsed) chunkResults.push(parsed);
    } catch (err) {
      console.warn(`[Persona] Failed to parse community chunk ${i} result:`, err.message);
    }
  }

  // Merge all chunk results
  return mergeCommunityInsights(chunkResults);
}

function mergeCommunityInsights(results) {
  const merged = {
    tool_suggestions: [],
    strategy_discussions: [],
    feature_requests: [],
    market_insights: []
  };

  for (const r of results) {
    if (r.tool_suggestions) merged.tool_suggestions.push(...r.tool_suggestions);
    if (r.strategy_discussions) merged.strategy_discussions.push(...r.strategy_discussions);
    if (r.feature_requests) merged.feature_requests.push(...r.feature_requests);
    if (r.market_insights) merged.market_insights.push(...r.market_insights);
  }

  return merged;
}

// ============================================================
// 4. Reduce 合成器 — 生成/增量更新白皮书
// ============================================================

const SYNTHESIS_PROMPT = `根据以下对一位美股交易员的交易行为分析结果，生成一份完整的行为画像白皮书。

白皮书应包含以下章节，请用 Markdown 格式输出：

# 大V交易行为画像白皮书

## 一、交易风格总览
- 偏好的交易周期（日内/波段/中长线）
- 核心持仓偏好（常交易的标的及板块）
- 仓位管理风格（集中/分散，全仓/分批）

## 二、决策模式图谱
- 入场信号模式：什么条件下他会开仓？
- 出场信号模式：什么条件下他会平仓/止损？
- 加减仓节奏：什么时候加仓/什么时候减仓？
- 大盘研判框架：他如何判断大盘方向？使用哪些指标？

## 三、核心操盘战法与经典套路库 (重点整合)
针对不同事件类型或大盘当日走势模式，总结大V的经典操盘套路与应对战法（重点提炼大V常说“要有经验/要有记忆/碰到类似的就不要慌”的经典套路）：
- **战法名称与核心逻辑**（如“CPI公布后恐慌砸盘-探底缺口低吸加仓战法”、“特朗普访华后大盘深度回调应对战法”）
- **适用走势与环境**（如日内突然宽幅回调、跳空低开补缺口、达到机构最新报价等）
- **操作规则与参数套路**：详细说明入场建仓点、后续不同回撤位置的加仓点位、仓位配置（底仓与波段）。
- **长线死拿与退出时机**：说明哪些部分属于“死拿不放的长线仓位”，何时开始分批出场/止盈，以及最终退出条件。
- **经典实战案例对齐**：必须将数据中提及的具体标的（如 TSLL, MSTR, CONL, QQQ）以及具体的操盘发言日期归并到对应的战法下，作为具体的实战例证。

## 四、技术分析习惯
- 常用技术指标及其使用方式
- K线形态偏好
- 关键价位的判断方法
- 图片分析中最常出现的分析工具和指标

## 五、风险管理体系
- 止损策略及纪律
- 仓位控制规则
- 极端行情应对方案
- VIX/恐惧指标的使用方式

## 六、情绪与心理特征
- 盈利时的行为模式
- 亏损时的行为模式
- 高波动行情下的心理状态
- 与群友互动风格

## 七、群友社区洞察
- 群友提出的有价值的量化工具和开发建议
- 群友分享的策略经验
- 群友对跟单系统的功能期望

## 八、项目功能开发建议
基于以上画像分析和群友社区洞察，为本跟单系统提出 5-8 条最有价值的功能改进建议，每条包含：
- 功能名称
- 来源依据（画像发现/群友建议）
- 用户价值
- 实现优先级（P0/P1/P2）

请确保每个章节都有具体、可操作的内容，而非泛泛而谈。引用具体的交易案例和数据来支撑结论。`;

const INCREMENTAL_UPDATE_PROMPT = `你是一位资深的美股交易行为分析师。以下是一份已有的大V交易行为画像白皮书，以及最近新增的交易行为分析数据和群友社区洞察。

请将新的分析结果合并进已有的白皮书中，生成一份更新后的完整白皮书。

合并规则：
1. 保留原有白皮书中仍然有效的结论和模式
2. 如果新数据验证了原有结论，加强该结论的置信度
3. 如果新数据与原有结论矛盾，需要修正并说明变化原因
4. 新发现的模式/策略应新增到相应章节
5. 「项目功能开发建议」章节需要根据最新画像和群友洞察重新评估优先级
6. 在白皮书末尾添加一个「更新日志」段落，简要说明本次更新的要点

请保持原有的章节结构（八个章节），用 Markdown 格式输出完整更新后的白皮书。`;

/**
 * 合成画像白皮书（全量或增量）
 */
async function synthesizePlaybook(eventAnalyses, communityInsights, provider, existingPlaybook = null) {
  // Break event analyses into batches for intermediate synthesis
  const BATCH_SIZE = 12;
  const intermediateSummaries = [];

  if (eventAnalyses.length <= BATCH_SIZE) {
    // Small enough, no intermediate step needed
    intermediateSummaries.push(eventAnalyses.join('\n\n---\n\n'));
  } else {
    // Batch intermediate synthesis
    for (let i = 0; i < eventAnalyses.length; i += BATCH_SIZE) {
      const batch = eventAnalyses.slice(i, i + BATCH_SIZE);
      const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(eventAnalyses.length / BATCH_SIZE);
      updateStatus('running', `正在合成中间摘要... (${batchIdx}/${totalBatches})`, 75 + Math.round(15 * batchIdx / totalBatches));

      const intermediatePrompt = `以下是对一位美股交易员多个时间段的行为分析结果。请合并这些分析，提炼出关键的交易模式、策略偏好和行为特征。以清晰的要点形式输出中间合成结果。\n\n` + batch.join('\n\n---\n\n');
      const summary = await callLocalAI(provider, intermediatePrompt);
      intermediateSummaries.push(summary);
    }
  }

  // Final synthesis
  updateStatus('running', '正在生成最终画像白皮书...', 90);

  const allSummaries = intermediateSummaries.join('\n\n===\n\n');
  const communitySection = JSON.stringify(communityInsights, null, 2);

  let finalPrompt;
  if (existingPlaybook) {
    // Incremental update
    finalPrompt = INCREMENTAL_UPDATE_PROMPT +
      `\n\n【已有白皮书】\n${existingPlaybook}` +
      `\n\n【新增行为分析数据】\n${allSummaries}` +
      `\n\n【新增群友社区洞察】\n${communitySection}`;
  } else {
    // Full generation
    finalPrompt = SYNTHESIS_PROMPT +
      `\n\n【交易行为分析数据】\n${allSummaries}` +
      `\n\n【群友社区洞察】\n${communitySection}`;
  }

  const playbook = await callLocalAI(provider, finalPrompt);
  return playbook;
}

// ============================================================
// 5. 主入口
// ============================================================

/**
 * 生成或增量更新大V行为画像白皮书
 * 
 * @param {Object} options
 * @param {string} options.provider - AI provider (默认 'lm-studio')
 * @param {number} options.maxMonths - 最大分析月数 (默认 6)
 * @param {boolean} options.forceRefresh - 强制全量重新生成
 */
export async function generatePersonaPlaybook(options = {}) {
  const {
    provider = process.env.AI_PROVIDER || 'lm-studio',
    maxMonths = 6,
    forceRefresh = false
  } = options;

  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (targetSpeakers.length === 0) {
    throw new Error('TARGET_SPEAKER_USER_IDS is not configured.');
  }

  // 1. 检查是否有活跃的后台任务
  const db = getDb();
  const activeTask = db.prepare(`
    SELECT id FROM task_queue 
    WHERE task_type IN ('persona_map', 'persona_community', 'persona_reduce')
      AND status IN ('pending', 'running', 'retry')
    LIMIT 1
  `).get();
  
  if (activeTask) {
    return { 
      success: true, 
      status: 'running', 
      message: '画像生成任务已经在后台队列中运行。' 
    };
  }

  try {
    updateStatus('running', '正在初始化画像任务...', 0);

    // Check for existing playbook (for incremental update)
    const existingReport = getLatestPersonaPlaybook();
    const isIncremental = existingReport && !forceRefresh;

    // Calculate date range
    const endDate = new Date();
    let startDate;
    
    if (isIncremental) {
      startDate = new Date(existingReport.end_time);
      console.log(`[Persona] Incremental update since ${startDate.toISOString()}`);
    } else {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - maxMonths);
      console.log(`[Persona] Full generation, last ${maxMonths} months`);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // ---- Step 1: Fetch messages ----
    updateStatus('running', '正在查询大V历史消息...', 5);
    const speakerMessages = getAllSpeakerMessagesChronological(targetSpeakers, {
      startDate: startDateStr,
      endDate: endDateStr,
      limit: 10000
    });

    if (speakerMessages.length === 0) {
      if (isIncremental) {
        updateStatus('done', '没有新消息，画像已是最新。', 100);
        return { success: true, reason: '没有新消息需要更新', isIncremental: true };
      }
      throw new Error('没有找到大V消息数据，无法生成画像。');
    }

    console.log(`[Persona] Found ${speakerMessages.length} speaker messages`);

    // ---- Step 2: Segment into events ----
    updateStatus('running', '正在进行时间线事件分段...', 10);
    const events = segmentMessagesIntoEvents(speakerMessages);
    console.log(`[Persona] Segmented into ${events.length} events`);

    const totalImages = events.reduce((sum, e) => sum + e.imageUrls.length, 0);
    console.log(`[Persona] Total images in events: ${totalImages}`);

    // ---- Step 3: Fetch focus and general community messages ----
    updateStatus('running', '正在准备群友消息...', 12);
    const luckyUserIds = getLuckyUserIds();
    let focusMessages = [];
    if (luckyUserIds.length > 0) {
      focusMessages = getSpecificCommunityMessages(luckyUserIds, {
        startDate: startDateStr,
        endDate: endDateStr,
        limit: 2000
      });
    }
    
    const allExclusions = [...targetSpeakers, ...luckyUserIds];
    const generalFilteredMessages = getFilteredCommunityMessages(allExclusions, {
      startDate: startDateStr,
      endDate: endDateStr,
      limit: 3000
    });

    // ---- Step 4: Batch Task Scheduling ----
    const batchId = `persona_batch_${Date.now()}`;
    console.log(`[Persona] Scheduling Map-Reduce tasks for batch ${batchId}`);

    // 4a. Add Map tasks for each event chunk
    for (let i = 0; i < events.length; i++) {
      addTask({
        taskType: 'persona_map',
        priority: 1, // P1 priority
        payload: {
          batchId,
          event: events[i],
          provider,
          chunkIndex: i,
          totalChunks: events.length
        }
      });
    }

    // 4b. Add focus group community tasks
    addTask({
      taskType: 'persona_community',
      priority: 1,
      payload: {
        batchId,
        messages: focusMessages,
        provider,
        isFocusGroup: true
      }
    });

    // 4c. Add general community tasks
    addTask({
      taskType: 'persona_community',
      priority: 1,
      payload: {
        batchId,
        messages: generalFilteredMessages,
        provider,
        isFocusGroup: false
      }
    });

    // 4d. Add Reduce task (SQL query blocks it until maps are done)
    const finalStartTime = isIncremental ? existingReport.start_time : (speakerMessages[0]?.created_at || Date.now());
    const reportEndTime = speakerMessages[speakerMessages.length - 1]?.created_at || Date.now();
    const rawMessagesCount = speakerMessages.length + focusMessages.length + generalFilteredMessages.length;

    addTask({
      taskType: 'persona_reduce',
      priority: 1,
      payload: {
        batchId,
        provider,
        isIncremental,
        existingContent: isIncremental ? existingReport.summary_content : null,
        finalStartTime,
        reportEndTime,
        rawMessagesCount,
        totalImages
      }
    });

    const totalSubtasks = events.length + 3;
    updateStatus('running', `已向队列提交 ${totalSubtasks} 个分析子任务 (Batch ID: ${batchId})。正在排队处理...`, 15);

    return {
      success: true,
      status: 'started',
      batchId,
      stats: {
        events: events.length,
        speakerMessages: speakerMessages.length,
        communityMessages: focusMessages.length + generalFilteredMessages.length,
        images: totalImages
      }
    };
  } catch (err) {
    setError(err.message);
    throw err;
  }
}

/**
 * 任务队列消费者入口 — 处理大V画像子任务
 */
export async function processPersonaTask(task) {
  const payload = JSON.parse(task.payload);
  const { batchId, provider } = payload;
  
  if (task.task_type === 'persona_map') {
    const { event, chunkIndex, totalChunks } = payload;
    console.log(`[Persona Worker] 正在执行 Map 任务 #${task.id} (批次: ${batchId}, 进度: ${chunkIndex + 1}/${totalChunks})`);
    
    // Execute event segment analysis
    const analysis = await analyzeEventSegment(event, provider);
    
    return {
      batchId,
      chunkIndex,
      analysis: `【事件 ${chunkIndex + 1}: ${event.date} ${event.session}】\n${analysis}`
    };
  }
  
  if (task.task_type === 'persona_community') {
    const { messages, isFocusGroup } = payload;
    console.log(`[Persona Worker] 正在执行 Community 任务 #${task.id} (批次: ${batchId}, 重点组: ${isFocusGroup})`);
    
    // Execute community insights extraction
    const insights = await extractCommunityInsights(messages, provider, isFocusGroup);
    
    return {
      batchId,
      isFocusGroup,
      insights
    };
  }
  
  if (task.task_type === 'persona_reduce') {
    const { isIncremental, existingContent, finalStartTime, reportEndTime, rawMessagesCount, totalImages } = payload;
    console.log(`[Persona Worker] 正在执行 Reduce 最终合成任务 #${task.id} (批次: ${batchId})...`);
    
    const db = getDb();
    
    // 1. 从任务队列中提取同批次已经完成的所有 map 与 community 子任务的结果
    // 性能优化：在 SQLite 级别利用 idx_task_queue_batch_id 索引进行 JSON 批次查询过滤，避免大对象全表加载
    const siblingTasks = db.prepare(`
      SELECT task_type, status, result FROM task_queue
      WHERE task_type IN ('persona_map', 'persona_community')
        AND status = 'done'
        AND json_extract(payload, '$.batchId') = ?
    `).all(batchId);
    
    const mapResults = [];
    const communityResults = [];
    
    for (const t of siblingTasks) {
      const res = JSON.parse(t.result);
      if (t.task_type === 'persona_map') {
        mapResults.push(res);
      } else if (t.task_type === 'persona_community') {
        communityResults.push(res);
      }
    }
    
    // 按 chunkIndex 对 map 结果进行排序，保证时间顺序
    mapResults.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const eventAnalysesText = mapResults.map(r => r.analysis);
    
    // 合并群友的洞察
    const focusInsight = communityResults.find(r => r.isFocusGroup)?.insights || { tool_suggestions: [], strategy_discussions: [], feature_requests: [], market_insights: [] };
    const generalInsight = communityResults.find(r => !r.isFocusGroup)?.insights || { tool_suggestions: [], strategy_discussions: [], feature_requests: [], market_insights: [] };
    const communityInsights = mergeCommunityInsights([focusInsight, generalInsight]);
    
    // 2. 调用 LLM 进行最终 Reduce 合成
    const playbook = await synthesizePlaybook(eventAnalysesText, communityInsights, provider, existingContent);
    
    // 3. 保存至 reports 表
    const modelName = provider === 'gemini' 
      ? `Gemini-Flash` + (totalImages > 0 ? '+Vision' : '') 
      : provider;
      
    saveReport({
      startTime: finalStartTime,
      endTime: reportEndTime,
      summaryContent: playbook,
      aiModel: modelName,
      rawMessagesCount,
      strategy: 'PERSONA_PLAYBOOK'
    });
    
    console.log(`[Persona Worker] 画像白皮书合成成功，报告已存入数据库！批次: ${batchId}`);
    return { success: true, batchId };
  }
  
  throw new Error(`Unsupported task type: ${task.task_type}`);
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 安全解析 JSON（处理 AI 输出中的 markdown 代码块包裹）
 */
function parseJSONSafe(text) {
  if (!text) return null;
  try {
    let clean = text.trim();
    // Strip markdown code fences
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '');
      clean = clean.replace(/\s*```$/, '');
    }
    // Strip thinking tags
    clean = clean.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    // Try to find JSON object in text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        // ignore
      }
    }
    return null;
  }
}
