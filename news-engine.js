import dotenv from 'dotenv';
import {
  getDb,
  saveNewsSummary,
  getLatestPersonaPlaybook
} from './database.js';
import {
  analyzeWithGemini,
  analyzeWithLMStudio,
  analyzeWithOllama
} from './monitor.js';
import { addTask } from './task-queue.js';

dotenv.config();

// ============================================================
// AI 调用封装 (与大V画像引擎一致)
// ============================================================
async function callLocalAI(provider, prompt) {
  const localProvider = provider === 'ollama' ? 'ollama' : 'lm-studio';
  if (localProvider === 'lm-studio') {
    const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:8080';
    const model = process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct';
    return await analyzeWithLMStudio(baseUrl, model, prompt);
  } else {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'deepseek-r1';
    return await analyzeWithOllama(baseUrl, model, prompt);
  }
}

async function callCloudAI(prompt, preferredProvider = null) {
  const provider = preferredProvider || process.env.AI_PROVIDER || 'gemini';
  const apiKey = process.env.GEMINI_API_KEY;

  const tryGemini = async () => {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    return await analyzeWithGemini(apiKey, prompt);
  };

  const tryLocal = async () => {
    const localProvider = provider === 'ollama' ? 'ollama' : 'lm-studio';
    return await callLocalAI(localProvider, prompt);
  };

  // 1. 如果首选为本地模型
  if (provider === 'lm-studio' || provider === 'ollama') {
    try {
      console.log(`[AI Router] [News] 优先使用本地模型 (${provider}) 进行推理...`);
      return await tryLocal();
    } catch (err) {
      console.warn(`[AI Router] [News] 本地模型推理失败 (${err.message})，自动容灾升级到云端 Gemini...`);
      if (apiKey) {
        try {
          return await tryGemini();
        } catch (geminiErr) {
          console.error('[AI Router] [News] 容灾升级至云端 Gemini 也宣告失败:', geminiErr.message);
        }
      }
      throw err;
    }
  }

  // 2. 首选为云端 Gemini (默认)
  try {
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    console.log(`[AI Router] [News] 优先使用云端 Gemini (${model}) 进行推理...`);
    return await tryGemini();
  } catch (err) {
    const isQuotaExceeded = err.message.includes('429') || err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED');
    if (isQuotaExceeded) {
      console.warn(`[AI Router] [News] 检测到云端 Gemini 配额限流超标 (${err.message})，自动自愈降级至本地大模型...`);
      try {
        return await tryLocal();
      } catch (localErr) {
        console.error('[AI Router] [News] 降级至本地模型也失败了:', localErr.message);
        throw err;
      }
    }
    throw err;
  }
}

// ============================================================
// 1. 初始化生成任务 (支持单次与多日跨度按交易日自动拆分)
// ============================================================
export async function generateNewsSummary(type = 'briefing', options = {}) {
  const { forceRefresh = false, customStartTime = null, customEndTime = null } = options;

  // 核心优化：若自定义时间段跨度大于 24 小时，自动按交易日拆分为每天独立的板块任务提交，确保列表全量覆盖！
  if (customStartTime && customEndTime) {
    const startMs = new Date(customStartTime).getTime();
    const endMs = new Date(customEndTime).getTime();
    const spanDays = Math.ceil((endMs - startMs) / (24 * 3600 * 1000));

    if (spanDays > 1) {
      console.log(`[News Engine] 检测到多日跨度 (${spanDays} 天: ${customStartTime} 至 ${customEndTime})，正在按交易日自动拆分派发...`);
      let generatedBatches = 0;
      let skippedNoData = 0;

      const currentDate = new Date(startMs);
      while (currentDate.getTime() <= endMs) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const day = currentDate.getDate();

        // 构造当天的 00:00:00 基准点 (北京/HKT 时间)
        const dayStart = new Date(year, month, day, 0, 0, 0).getTime();
        const dayEnd = new Date(year, month, day, 23, 59, 59).getTime();

        let dayTargetStart = dayStart;
        let dayTargetEnd = dayEnd;
        let dayTitleType = '';
        const dateTag = `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

        switch (type) {
          case 'briefing':
            // 盘前速报：北京时间 $D$ 日 18:00 至 21:30 (美股盘前交易与开盘前瞻)
            dayTargetStart = dayStart + (18 * 3600 * 1000);
            dayTargetEnd = dayStart + (21.5 * 3600 * 1000);
            dayTitleType = `盘前速报 (${dateTag})`;
            break;
          case 'intraday':
            // 盘中总结：北京时间 $D$ 日 21:30 至 次日 01:30 (美股开盘前4小时激战)
            dayTargetStart = dayStart + (21.5 * 3600 * 1000);
            dayTargetEnd = dayStart + (25.5 * 3600 * 1000);
            dayTitleType = `盘中总结 (${dateTag})`;
            break;
          case 'closing':
            // 收盘回顾：北京时间 $D+1$ 日 01:30 至 08:00 (美股后半程至收盘结账)
            dayTargetStart = dayStart + (25.5 * 3600 * 1000);
            dayTargetEnd = dayStart + (32 * 3600 * 1000);
            dayTitleType = `收盘回顾 (${dateTag})`;
            break;
          case 'macro':
            // 宏观周报：周日触发，涵盖前 7 天
            if (currentDate.getDay() === 0) {
              dayTargetStart = dayStart - (6 * 24 * 3600 * 1000);
              dayTargetEnd = dayEnd;
              dayTitleType = `本周宏观总结 (${dateTag})`;
            } else {
              currentDate.setDate(currentDate.getDate() + 1);
              continue;
            }
            break;
          default:
            dayTitleType = `资讯总结 (${dateTag})`;
        }

        try {
          await generateSingleNewsSummary(type, dayTargetStart, dayTargetEnd, dayTitleType, forceRefresh);
          generatedBatches++;
        } catch (err) {
          if (err.message.includes('没有任何聊天数据')) {
            skippedNoData++;
          } else {
            console.warn(`[News Engine] 生成 ${dateTag} ${type} 提示: ${err.message}`);
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      return {
        success: true,
        status: 'batch_started',
        message: `成功为 ${spanDays} 天生成/补充资讯速报！提交批次: ${generatedBatches}，跳过无数据时段: ${skippedNoData}`
      };
    }
  }

  // 单天或默认抓取范围
  const endTime = customEndTime ? new Date(customEndTime).getTime() : Date.now();
  let startTime;
  let titleType = '';

  if (customStartTime) {
    startTime = new Date(customStartTime).getTime();
    const startStr = new Date(startTime).toLocaleString('zh-CN', { hour12: false }).substring(5, 16);
    const endStr = new Date(endTime).toLocaleString('zh-CN', { hour12: false }).substring(5, 16);
    switch (type) {
      case 'briefing': titleType = `盘前速报 (${startStr} 至 ${endStr})`; break;
      case 'intraday': titleType = `盘中总结 (${startStr} 至 ${endStr})`; break;
      case 'closing': titleType = `收盘回顾 (${startStr} 至 ${endStr})`; break;
      case 'macro': titleType = `本周宏观总结 (${startStr} 至 ${endStr})`; break;
      default: titleType = `自定义资讯总结 (${startStr} 至 ${endStr})`;
    }
  } else {
    switch (type) {
      case 'briefing':
        startTime = endTime - (16 * 60 * 60 * 1000);
        titleType = '盘前速报';
        break;
      case 'intraday':
        startTime = endTime - (4 * 60 * 60 * 1000);
        titleType = '盘中总结';
        break;
      case 'closing':
        startTime = endTime - (10 * 60 * 60 * 1000);
        titleType = '收盘回顾';
        break;
      case 'macro':
        startTime = endTime - (7 * 24 * 60 * 60 * 1000);
        titleType = '本周宏观总结';
        break;
    }
  }

  return await generateSingleNewsSummary(type, startTime, endTime, titleType, forceRefresh);
}

/**
 * 核心辅助函数：为特定时间段与标题生成 Map-Reduce 任务
 */
async function generateSingleNewsSummary(type, startTime, endTime, titleType, forceRefresh = false) {
  const db = getDb();

  // 1. 检查是否有活跃的资讯总结任务在跑 (同一时间范围与类型)
  const activeTask = db.prepare(`
    SELECT id FROM task_queue 
    WHERE task_type IN ('news_map', 'news_reduce')
      AND status IN ('pending', 'running', 'retry')
      AND json_extract(payload, '$.summaryType') = ?
      AND json_extract(payload, '$.startTime') = ?
    LIMIT 1
  `).get(type, startTime);

  if (activeTask && !forceRefresh) {
    return { 
      success: true, 
      status: 'running', 
      message: '该时段资讯生成任务已经在后台队列中运行。' 
    };
  }

  // 2. 获取大V和群友发言
  const targetSpeakersStr = process.env.TARGET_SPEAKER_USER_IDS || '';
  const targetSpeakers = targetSpeakersStr.split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (targetSpeakers.length === 0) {
    throw new Error('TARGET_SPEAKER_USER_IDS is not configured.');
  }

  const placeholders = targetSpeakers.map(() => '?').join(',');

  // 3a. 大V消息 — 带智能回溯避空机制（若狭隘窗口内大V发言少于 2 条，自动扩展回溯 12 小时补充大V战略动作）
  let speakerMessagesRaw = db.prepare(`
    SELECT sender_name, content, created_at FROM messages
    WHERE sender_id IN (${placeholders}) AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT 60
  `).all(...targetSpeakers, startTime, endTime);

  if (speakerMessagesRaw.length < 2) {
    const extendedStartTime = startTime - (12 * 3600 * 1000);
    console.log(`[News Engine] ${titleType} 精确窗口内大V发言较少 (${speakerMessagesRaw.length} 条)，触发智能 12h 回溯补充...`);
    speakerMessagesRaw = db.prepare(`
      SELECT sender_name, content, created_at FROM messages
      WHERE sender_id IN (${placeholders}) AND created_at BETWEEN ? AND ?
      ORDER BY created_at DESC
      LIMIT 60
    `).all(...targetSpeakers, extendedStartTime, endTime);
  }

  const speakerMessages = speakerMessagesRaw.reverse();

  // 3b. 群友消息 — 智能筛选高价值代表性发言以规避 Token 溢出
  const communityMessagesRaw = db.prepare(`
    SELECT sender_name, content, created_at FROM messages
    WHERE sender_id NOT IN (${placeholders}) AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(...targetSpeakers, startTime, endTime);

  const filteredCommunity = communityMessagesRaw.map(msg => {
    let score = 0;
    const content = msg.content || '';

    if (/[买卖涨跌多空能不收平仓仓位浮亏止损抄底爆仓跟单实盘模拟]/i.test(content)) {
      score += 30;
    }
    if (/[A-Z]{2,5}/.test(content)) {
      score += 15;
    }

    const len = content.length;
    if (len < 5 && score === 0) {
      score -= 20;
    } else {
      score += Math.min(len / 20, 5);
    }

    return { msg, score };
  })
  .filter(item => item.score >= 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 50)
  .map(item => item.msg);

  const communityMessages = filteredCommunity.sort((a, b) => a.created_at - b.created_at);

  if (speakerMessages.length === 0 && communityMessages.length === 0) {
    throw new Error('该时段内没有任何聊天数据，无需生成总结。');
  }

  const formatMsgList = (msgs) => {
    return msgs.map(m => {
      const timeStr = new Date(m.created_at).toISOString().replace('T', ' ').substr(0, 19);
      const text = (m.content || '').substring(0, 300);
      return `[${timeStr}] ${m.sender_name}: ${text}`;
    }).join('\n');
  };

  const speakerText = formatMsgList(speakerMessages);
  const communityText = formatMsgList(communityMessages);

  const batchId = `news_batch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  const localProvider = process.env.AI_PROVIDER || 'lm-studio';

  // 提交 Map 任务
  addTask({
    taskType: 'news_map',
    priority: 2,
    payload: {
      batchId,
      messagesText: speakerText || '该时段内大V未发言。',
      isSpeaker: true,
      provider: localProvider
    }
  });

  addTask({
    taskType: 'news_map',
    priority: 2,
    payload: {
      batchId,
      messagesText: communityText || '该时段内群友未发言。',
      isSpeaker: false,
      provider: localProvider
    }
  });

  // 提交 Reduce 任务
  addTask({
    taskType: 'news_reduce',
    priority: 2,
    payload: {
      batchId,
      summaryType: type,
      title: titleType,
      startTime,
      endTime,
      rawMessagesCount: speakerMessages.length + communityMessages.length,
      provider: 'gemini'
    }
  });

  console.log(`[News Engine] Scheduled news Map-Reduce tasks for batch ${batchId} (${titleType}). Speaker msgs: ${speakerMessages.length}, Community msgs: ${communityMessages.length}`);

  return {
    success: true,
    status: 'started',
    batchId,
    stats: {
      speakerMsgs: speakerMessages.length,
      communityMsgs: communityMessages.length
    }
  };
}

// 批量全板块生成辅助路由
export async function generateBatchNewsSummaries(options = {}) {
  const { types = ['briefing', 'intraday', 'closing', 'macro'], customStartTime, customEndTime, forceRefresh = true } = options;
  let results = [];
  for (const t of types) {
    try {
      const res = await generateNewsSummary(t, { customStartTime, customEndTime, forceRefresh });
      results.push({ type: t, success: true, res });
    } catch (err) {
      results.push({ type: t, success: false, error: err.message });
    }
  }
  return results;
}

// ============================================================
// 2. 任务队列执行入口
// ============================================================
export async function processNewsTask(task) {
  const payload = JSON.parse(task.payload);
  const { batchId, provider } = payload;

  if (task.task_type === 'news_map') {
    const { messagesText, isSpeaker } = payload;
    console.log(`[News Worker] 正在执行 Map 任务 #${task.id} (批次: ${batchId}, 类型: ${isSpeaker ? '大V' : '群友'})`);

    let prompt = '';
    if (isSpeaker) {
      prompt = `
你是一位极其严谨的金融分析助理。请分析以下提供的大V发言历史记录（已按时间排序），提取关键投资决策信息。

大V发言记录：
${messagesText}

请按照以下规则进行提取，并在分析结果中输出：
1. 【个股与点位分析】：提取所有被大V点名或讨论的个股/ETF（如 TSLA、GOOGL 等）。只要大V提到了具体的买入/卖出方向、仓位比例或明确的技术位（支撑/阻力/缺口），你必须在该行开头标注 **[大V确认]**。如果仅是随口提及或无结论的分析，标为 **[大V提及]**。
2. 【交易策略与期权】：提取大V推荐的任何特定期权代码、买卖日期以及开仓平仓策略，或者仓位配置纪律。
3. 【宏观与市场态度】：提取大V对美股宏观背景（如财报季、资金回流、政策影响等）的核心解读与态度。

不要包含多余废话，直接输出结构化的要点。`;
    } else {
      prompt = `
你是一位社区洞察专家。请分析以下提供的普通群友聊天发言记录，提炼群友关注点、市场情绪和反馈。

群友发言记录：
${messagesText}

请按照以下规则进行提取，并在分析结果中输出：
1. 【社区热点个股讨论】：整理普通群友在讨论中关注的个股（如 TSLA、NVDA、ASTS 等）以及他们自己的讨论（如抄底、止损、爆仓）。注意：因为这些是非大V的普通群友的言论，你提取的所有个股观点行开头必须强行加上 **[群友意见]**，绝对不能混淆为官方大V建议。
2. 【市场情绪】：总结群友的整体情绪（如极度恐慌、疯狂看多、对跟单的反馈）。
3. 【观点冲突】：提炼出群友之间或群友与大V之间争议较大的核心问题（比如某只股票是否到抄底时机，二次探底的真伪）。

直接输出结构化的分析要点。`;
    }

    const result = await callLocalAI(provider, prompt);
    return {
      batchId,
      isSpeaker,
      analysis: result
    };
  }

  if (task.task_type === 'news_reduce') {
    const { summaryType, title, startTime, endTime, rawMessagesCount } = payload;
    console.log(`[News Worker] 正在执行 Reduce 任务 #${task.id} (批次: ${batchId}, 使用 Gemini)...`);

    const db = getDb();

    // 1. 获取同批次所有 Map 任务的结果
    const siblingTasks = db.prepare(`
      SELECT result FROM task_queue
      WHERE task_type = 'news_map'
        AND status = 'done'
        AND json_extract(payload, '$.batchId') = ?
    `).all(batchId);

    let speakerAnalysis = '未获取到大V分析。';
    let communityAnalysis = '未获取到群友分析。';

    for (const t of siblingTasks) {
      if (!t.result) continue;
      try {
        const res = JSON.parse(t.result);
        if (res.isSpeaker) {
          speakerAnalysis = res.analysis;
        } else {
          communityAnalysis = res.analysis;
        }
      } catch(e) {}
    }

    // 2. 最终云端 Gemini 总结润色，并载入大V画像白皮书进行对齐度诊断
    const playbookReport = getLatestPersonaPlaybook();
    const playbookContent = playbookReport ? playbookReport.summary_content : '未检测到历史画像白皮书，暂按常规逻辑提取分析。';

    const prompt = `
你是一位顶级的美股交易助理。请将以下整理出的「大V发言核心提取」与「普通群友言论提取」进行融合成一篇高质量、结构化、排版现代 of 社区资讯总结报告。

同时，为了辅助订阅用户进行跟单决策与风控控制，你必须结合【大V行为特征画像白皮书】，在报告尾部对大V在本时段内进行的所有交易个股与方向，进行深刻的置信度诊断与擅长对齐度匹配评估。

【大V发言核心提取】：
${speakerAnalysis}

【普通群友言论提取】：
${communityAnalysis}

【大V行为特征画像白皮书】：
${playbookContent}

请按照以下大纲结构生成 Markdown 格式的最终总结报告：
1. 报告必须包含以下二级标题：
   - ## 聊天总结：概括该时段群内聊天讨论的核心（如短线博弈、抄底热点）与大V做出的重点预警/仓位建议。
   - ## 个股/ETF信息：列出在此期间重点讨论的股票。每一只股票的描述中，**你必须显式包含且突出标注真伪信源标签**：
     - 若属于大V的明确交易决策和点位建议，标为 \`[大V确认]\`（在 Markdown 中可用反单引号标明）。
     - 若属于普通群友的观点、猜测或跟单吐槽，标为 \`[群友意见]\`。
     不要将群友的猜测归为大V的决定，以防止读者产生交易错觉！
   - ## 大V交易画像对齐诊断：请对照【大V行为特征画像白皮书】，针对大V本时段的所有个股交易动作（如买入/卖出），进行置信度和擅长模式对齐度评估。阐明该标的是否属于他一贯胜率极高的优势方向（如科技巨头股趋势跟踪），哪些是个股试错单或可能与防守周期冲突，并给订阅用户相应的跟单仓位降级、防守防御建议、或 2 倍做多 ETF 代用提示。
   - ## 期权信息：提炼期权讨论要点、异动期权链或历史交易反馈。
   - ## 经济事件与观点分歧：总结提及的经济大事件与群里多空分歧的核心论调。
2. 确保排版精美、用语专业，采用适合金融交易员的精炼风格。

直接输出 Markdown 报告文本，不要包含任何 json 封装或多余的引导说明。`;

    const summaryContent = await callCloudAI(prompt, provider);

    // 3. 将合成报告存入 SQLite 数据库
    saveNewsSummary({
      batchId,
      summaryType,
      title,
      startTime,
      endTime,
      summaryContent,
      rawMessagesCount
    });

    console.log(`[News Worker] 社区时段总结 "${title}" 生成并归档成功！批次: ${batchId}`);
    return { success: true, batchId, title };
  }

  throw new Error(`Unsupported task type: ${task.task_type}`);
}
