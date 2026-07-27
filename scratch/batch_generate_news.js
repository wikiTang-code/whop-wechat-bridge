import { generateNewsSummary } from '../news-engine.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * 批量生成 2026-07-13 至 2026-07-22（目前为止）的所有资讯总结
 */
async function main() {
  console.log('=== 🚀 开始批量提交 2026-07-13 至 2026-07-22 资讯生成任务 ===');

  // 日期范围：2026-07-13 到 2026-07-22
  const startDay = new Date('2026-07-13T00:00:00+08:00');
  const endDay = new Date('2026-07-22T23:59:59+08:00');

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // 遍历每一天
  const curr = new Date(startDay);
  while (curr <= endDay) {
    const year = curr.getFullYear();
    const month = String(curr.getMonth() + 1).padStart(2, '0');
    const day = String(curr.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    console.log(`\n📅 正在处理日期: ${dateStr}...`);

    // 构建该日期在美东时间 (EDT, UTC-4) 对应的三个核心时间段
    // 盘前速报: 该日期美东 04:00 ~ 09:30  (即 UTC 08:00 ~ 13:30)
    // 盘中总结: 该日期美东 09:30 ~ 16:00  (即 UTC 13:30 ~ 20:00)
    // 收盘回顾: 该日期美东 16:00 ~ 23:59  (即 UTC 20:00 ~ 03:59+1)

    const dateEdtBase = `${year}-${month}-${day}`;
    
    // 1. 盘前速报 (Briefing)
    const briefingStart = new Date(`${dateEdtBase}T04:00:00-04:00`).toISOString();
    const briefingEnd = new Date(`${dateEdtBase}T09:30:00-04:00`).toISOString();
    
    // 2. 盘中总结 (Intraday)
    const intradayStart = new Date(`${dateEdtBase}T09:30:00-04:00`).toISOString();
    const intradayEnd = new Date(`${dateEdtBase}T16:00:00-04:00`).toISOString();

    // 3. 收盘回顾 (Closing)
    const closingStart = new Date(`${dateEdtBase}T09:30:00-04:00`).toISOString(); // 包含全天交易洞察
    const closingEnd = new Date(`${dateEdtBase}T20:00:00-04:00`).toISOString();

    const tasks = [
      { type: 'briefing', name: '盘前速报', start: briefingStart, end: briefingEnd },
      { type: 'intraday', name: '盘中总结', start: intradayStart, end: intradayEnd },
      { type: 'closing',  name: '收盘回顾', start: closingStart, end: closingEnd }
    ];

    for (const t of tasks) {
      try {
        console.log(`  └─ 提交 [${t.name}] (${t.start.slice(0,16)} 至 ${t.end.slice(0,16)})...`);
        const res = await generateNewsSummary(t.type, {
          customStartTime: t.start,
          customEndTime: t.end,
          forceRefresh: true
        });
        console.log(`     ✅ 成功提交: ${res.batchId}`);
        successCount++;
      } catch (err) {
        if (err.message.includes('没有任何聊天数据')) {
          console.log(`     ⏩ 跳过 (无发言数据): ${err.message}`);
          skipCount++;
        } else {
          console.error(`     ❌ 错误: ${err.message}`);
          errorCount++;
        }
      }
    }

    // 前进一天
    curr.setDate(curr.getDate() + 1);
  }

  // 4. 提交宏观周报 (Macro Weekly)
  console.log('\n📊 提交宏观周报 (2026-07-13 至 2026-07-22)...');
  try {
    const macroStart = new Date('2026-07-13T00:00:00+08:00').toISOString();
    const macroEnd = new Date('2026-07-22T23:59:59+08:00').toISOString();
    const res = await generateNewsSummary('macro', {
      customStartTime: macroStart,
      customEndTime: macroEnd,
      forceRefresh: true
    });
    console.log(`     ✅ 宏观周报成功提交: ${res.batchId}`);
    successCount++;
  } catch (err) {
    console.error(`     ❌ 宏观周报提交失败: ${err.message}`);
  }

  console.log(`\n=== 🎉 批量触发完成！ ===`);
  console.log(`成功提交: ${successCount} 个任务 | 无数据跳过: ${skipCount} | 异常: ${errorCount}`);
}

main().catch(console.error);
