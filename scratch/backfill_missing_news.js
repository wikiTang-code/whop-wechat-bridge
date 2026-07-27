import { getDb } from '../database.js';
import { addTask } from '../task-queue.js';

const db = getDb();

console.log('====================================================');
console.log('🚀 极速一键追发补全 6/26 ~ 7/25 缺失的美股交易日社区资讯速报');
console.log('====================================================\n');

// 1. 生成 2026/06/26 到 2026/07/25 之间所有的美股交易日日期数组
const startDate = new Date('2026-06-26T00:00:00+08:00');
const endDate = new Date('2026-07-25T23:59:59+08:00');

const tradingDays = [];
let curr = new Date(startDate);

while (curr <= endDate) {
  const dayOfWeek = curr.getDay();
  // 避开周末 (0 = 周日, 6 = 周六)
  if (dayOfWeek !== 0 && dayOfWeek !== 6) {
    const yyyy = curr.getFullYear();
    const mm = String(curr.getMonth() + 1).padStart(2, '0');
    const dd = String(curr.getDate()).padStart(2, '0');
    tradingDays.push(`${yyyy}/${mm}/${dd}`);
  }
  curr.setDate(curr.getDate() + 1);
}

console.log(`📅 共筛选出 6/26 ~ 7/25 之间的 ${tradingDays.length} 个美股交易日:\n`, tradingDays);

// 2. 查找哪些交易日的速报尚未落库，并进行精准补发
let addedCount = 0;
const summaryTypes = ['briefing', 'closing']; // 精准补发 盘前速报 + 收盘回顾

for (const dateStr of tradingDays) {
  for (const type of summaryTypes) {
    // 检查该日期 + 该类型的速报是否已落库
    const existing = db.prepare(`
      SELECT id FROM news_summaries 
      WHERE summary_type = ? AND (title LIKE ? OR summary_content LIKE ?)
    `).get(type, `%${dateStr}%`, `%${dateStr}%`);

    if (!existing) {
      // 缺失该日的速报，精确下发补发任务
      const dateParts = dateStr.split('/');
      const dObj = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
      const startTime = dObj.getTime();
      const endTime = startTime + 24 * 3600 * 1000;

      const batchId = `news_batch_${startTime}_${type}`;
      
      addTask({
        taskType: `news_${type}`,
        priority: 3, // P3 离线资讯次优
        payload: {
          batchId,
          startTime,
          endTime,
          summaryType: type,
          dateStr
        }
      });
      addedCount++;
    }
  }
}

console.log(`\n✅ 成功精准下发了 ${addedCount} 个缺失的美股交易日速报生成任务！`);
console.log('🚀 6 个 Worker 正协同 5-Key Gemini 极速追号合成，预计 2-3 分钟内全量追齐落库！');
