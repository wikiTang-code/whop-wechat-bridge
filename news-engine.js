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

async function callCloudAI(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[News] GEMINI_API_KEY not set, falling back to local model');
    return await callLocalAI('lm-studio', prompt);
  }
  return await analyzeWithGemini(apiKey, prompt);
}

// ============================================================
// 1. 初始化生成任务
// ============================================================
export async function generateNewsSummary(type = 'briefing', options = {}) {
  const { forceRefresh = false, customStartTime = null, customEndTime = null } = options;
  const db = getDb();

  // 1. 检查是否有活跃的资讯总结任务在跑
  const activeTask = db.prepare(`
    SELECT id FROM task_queue 
    WHERE task_type IN ('news_map', 'news_reduce')
      AND status IN ('pending', 'running', 'retry')
    LIMIT 1
  `).get();

  if (activeTask && !forceRefresh) {
    return { 
      success: true, 
      status: 'running', 
      message: '资讯生成任务已经在后台队列中运行。' 
    };
  }

  // 2. 设定抓取的时间范围
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
        startTime = endTime - (16 * 60 * 60 * 1000); // 过去 16 小时
        titleType = '盘前速报';
        break;
      case 'intraday':
        startTime = endTime - (4 * 60 * 60 * 1000);   // 过去 4 小时
        titleType = '盘中总结';
        break;
      case 'closing':
        startTime = endTime - (10 * 60 * 60 * 1000);  // 过去 10 小时
        titleType = '收盘回顾';
        break;
      case 'macro':
        startTime = endTime - (7 * 24 * 60 * 60 * 1000); // 过去 7 天
        titleType = '本周宏观总结';
        break;
      default:
        startTime = endTime - (24 * 60 * 60 * 1000);  // 过去 24 小时
        titleType = '社区资讯总结';
    }
  }

  // 3. 获取大V和群友消息
  const targetSpeakers = (process.env.TARGET_SPEAKER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (targetSpeakers.length === 0) {
    throw new Error('TARGET_SPEAKER_USER_IDS is not configured.');
  }

  // 构建占位符
  const placeholders = targetSpeakers.map(() => '?').join(',');

  // 3a. 大V消息 - 限制拉取最新的 60 条并反转为正序
  const speakerMessagesRaw = db.prepare(`
    SELECT sender_name, content, created_at FROM messages
    WHERE sender_id IN (${placeholders}) AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT 60
  `).all(...targetSpeakers, startTime, endTime);
  const speakerMessages = speakerMessagesRaw.reverse();

  // 3b. 群友消息 - 智能筛选高价值代表性发言以规避 Token 溢出，并保护问答语境
  const communityMessagesRaw = db.prepare(`
    SELECT sender_name, content, created_at FROM messages
    WHERE sender_id NOT IN (${placeholders}) AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(...targetSpeakers, startTime, endTime);

  const filteredCommunity = communityMessagesRaw.map(msg => {
    let score = 0;
    const content = msg.content || '';

    // 观点及交易倾向加分 (直接保底)
    if (/[买卖涨跌多空能不收平仓仓位浮亏止损抄底爆仓跟单实盘模拟]/i.test(content)) {
      score += 30;
    }
    // 股票标的提及加分
    if (/[A-Z]{2,5}/.test(content)) {
      score += 15;
    }

    const len = content.length;
    // 只有当发言极短（少于 5 字），且完全没有命中任何个股或观点词汇时，才判定为水贴扣分过滤
    if (len < 5 && score === 0) {
      score -= 20; // 过滤纯无意义水贴，如 "哈哈"、"收到"、"111" 等
    } else {
      score += Math.min(len / 20, 5); // 正常讨论句按字数微加分
    }

    return { msg, score };
  })
  .filter(item => item.score >= 0) // 排除噪音水贴
  .sort((a, b) => b.score - a.score) // 降序排序含金量
  .slice(0, 50) // 取前 50 条最精华的群友发言
  .map(item => item.msg);

  // 重新按时间正序排列
  const communityMessages = filteredCommunity.sort((a, b) => a.created_at - b.created_at);

  if (speakerMessages.length === 0 && communityMessages.length === 0) {
    throw new Error('该时段内没有任何聊天数据，无需生成总结。');
  }

  // 4. 格式化为文本流 (截断单条消息内容防止溢出)
  const formatMsgList = (msgs) => {
    return msgs.map(m => {
      const timeStr = new Date(m.created_at).toISOString().replace('T', ' ').substr(0, 19);
      const text = (m.content || '').substring(0, 300);
      return `[${timeStr}] ${m.sender_name}: ${text}`;
    }).join('\n');
  };

  const speakerText = formatMsgList(speakerMessages);
  const communityText = formatMsgList(communityMessages);

  // 5. 提交 Map-Reduce 子任务到队列中
  const batchId = `news_batch_${Date.now()}`;
  const localProvider = process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'lm-studio';

  // 5a. 提交大V发言分析任务
  addTask({
    taskType: 'news_map',
    priority: 2, // 资讯总结任务优先级稍高于普通画像任务
    payload: {
      batchId,
      messagesText: speakerText || '该时段内大V未发言。',
      isSpeaker: true,
      provider: localProvider
    }
  });

  // 5b. 提交群友发言分析任务
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

  // 5c. 提交 Reduce 最终合成任务
  addTask({
    taskType: 'news_reduce',
    priority: 2,
    payload: {
      batchId,
      summaryType: type,
      title: `${titleType} (${new Date().toLocaleDateString('zh-CN')})`,
      startTime,
      endTime,
      rawMessagesCount: speakerMessages.length + communityMessages.length,
      provider: 'gemini'
    }
  });

  console.log(`[News Engine] Scheduled news Map-Reduce tasks for batch ${batchId}. Speaker msgs: ${speakerMessages.length}, Community msgs: ${communityMessages.length}`);

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
      const res = JSON.parse(t.result);
      if (res.isSpeaker) {
        speakerAnalysis = res.analysis;
      } else {
        communityAnalysis = res.analysis;
      }
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

    const summaryContent = await callCloudAI(prompt);

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
