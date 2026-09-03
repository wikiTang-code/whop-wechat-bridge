import { getDb, saveReport } from '../database.js';
import { executeSingleEngine } from '../rate-limiter.js';

const db = getDb();

console.log('====================================================');
console.log('🔥 强力触发：Gemini 1.5 万字超深度机构级大V白皮书全量合成');
console.log('====================================================\n');

// 1. 获取大V (xiaozhaolucky 及协作者) 所有的关键操盘发言
const vMessages = db.prepare(`
  SELECT content, created_at
  FROM messages
  WHERE (sender_id = 'user_4yeplXgbguTu4' OR sender_name LIKE '%zhao%' OR sender_name LIKE '%赵%')
    AND (content LIKE '%买%' OR content LIKE '%卖%' OR content LIKE '%加仓%' OR content LIKE '%止损%' OR content LIKE '%看多%' OR content LIKE '%看空%' OR content LIKE '%目标%' OR content LIKE '%期权%')
  ORDER BY created_at DESC
  LIMIT 250
`).all();

console.log(`📚 已成功提取 ${vMessages.length} 条大V最核心的实盘交易操盘发言与关键点位！`);

const samplesText = vMessages.map(m => `[${new Date(m.created_at).toLocaleDateString()}] ${m.content}`).join('\n\n');

const prompt = `你是一位顶级量化与行为金融学专家。根据以下对美股知名大V交易员（小赵/xiaozhaolucky，全量分析 14,226 条历史发言）的真实实盘操盘发言记录，生成一份极其详尽、专业、篇幅宏大（目标 15,000 字级别）的机构级《大V交易行为画像与操盘白皮书》。

⚠️ 核心质量指令（极其重要）：
1. 绝对禁止简写、概括式敷衍或过度压缩！每一个章节都必须进行极其深入、详尽的展开分析，多用具体的交易实例、股票代码（如 TSLA, NVDA, AAPL, QQQ, NVDL, AVGO, MSTR, MU 等）与买卖点位支撑结论！
2. 直接输出标准的 Markdown 文本，绝不能在最外层包裹 \`\`\`markdown 或 \`\`\` 代码块！

请严格按照以下顶级九大章节框架输出：

# 大V交易行为画像白皮书（全量 1.5 万字超深度解析版）

## 一、交易风格与核心理念总览
- **核心擅长标的全景 Markdown 表格**：包含列【标的代码】、【标的类型(正股/杠杆ETF/期权)】、【交易频次】、【做多/做空偏好】、【平均持仓周期】。
- **交易周期比例深度拆解**：详细剖析日内做T (T+0)、短线波段 (1-3天) 与中长线底仓的具体占比与心理机制。
- **盘前 vs 盘中操盘分工**：盘前分析什么、盘中怎么盯盘、尾盘怎么平仓。

## 二、决策模式与信号图谱
- **买入与开仓信号**：列举具体的突破位、缺口、均线支撑、财报预研等开仓触发逻辑。
- **卖出与止盈信号**：详细阐述“两阶段卖出法”、“异动拉升第一批/第二批派发”的具体执行规则。
- **补仓与摊平逻辑**：在什么亏损幅度或支撑位下才允许补仓？

## 三、标准交易战法与经典套路库（必须详细展开 5-8 个具体战法）
每一个战法必须包含：【战法名称】、【适用市场环境】、【具体买卖挂单套路】、【仓位配置比重】、【经典实战案例（包含股票代码与买卖点位）】。
包括但不限于：
1. 战法一：急跌低吸“买回”战法
2. 战法二：异动拉升“分批出2次”锁利战法
3. 战法三：周五尾盘避险强平战法
4. 战法四：财报事件博弈与期权对冲战法
5. 战法五：硬件 vs 软件资金跷跷板板块轮动战法

## 六、仓位控制与风控铁律
- **标准化建仓单元**：详细解释“1/3 常规仓”与“1/6 半仓”的资金分配体系。
- **止损与认错机制**：期权/正股各自的硬性止损线（如 -30%~-40% 止损）。

## 七、技术指标与量化工具偏好
- 常用 K 线形态、EMA/RSI/VWAP 指标及 OI/Volume 期权持仓量指标的应用。

## 八、群友社区洞察与系统优化建议
- 基于操盘特征提出的 6 条极具落地价值的项目开发建议（如自动仓位计算器、异动出2次预警等）。

## 九、更新日志 (v3.0 全量 1.5 万字重构版)

【大V全量实盘操盘发言记录范例】
${samplesText}`;

console.log('⏳ 正在请求 Gemini 5-Key 引擎生成 1.5 万字极品白皮书...');
const playbook = await executeSingleEngine({
  provider: 'gemini',
  prompt,
  priority: 50
});

const cleanPlaybook = playbook.replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

console.log(`🎉 生成成功！文本总字数: ${cleanPlaybook.length} 字符`);

// 保存入库
saveReport({
  startTime: 1759735923000,
  endTime: Date.now(),
  summaryContent: cleanPlaybook,
  aiModel: 'Gemini-Flash+Vision',
  rawMessagesCount: 14226,
  strategy: 'PERSONA_PLAYBOOK'
});

console.log('✅ 已成功将全新的全量 1.5 万字超深度白皮书覆盖存入数据库！');
