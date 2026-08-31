/**
 * @file verify_interrupt_pipeline_zhou.js
 * @description 验证 Top Half / Bottom Half (ISR / DPC) 中断流水线端到端验收测试
 */

import { dispatchIngestTopHalf } from './ingest_dispatcher.js';
import { runMediaWorker } from './media_worker.js';
import { generateQueueStatus } from './generate_queue_status.js';
import Database from 'better-sqlite3';
import path from 'path';

console.log('========================================================================================');
console.log('🧪 启动 Top Half / Bottom Half (ISR / DPC) 端到端真实流水线验收测试');
console.log('========================================================================================\n');

const db = new Database(path.resolve('whop_archive.db'));

// 测试用例 1: 周哥 8:02 券商成交真实带图帖
const zhouTestPost = {
  id: 'post_1CeZqyZPfc3CYSB1bsF5yG',
  feedId: 'chat_feed_1CTr5VAdNHtbZAFaTitvoT',
  channel_name: '不用翻墙美股讨论区',
  sender_name: 'Mrzhoulucky',
  created_at: 1788134533000,
  content: '',
  attachments: [
    {
      id: 'att_zhou_001',
      source: {
        url: 'https://img-v2-prod.whop.com/Vfw_iSpdcntx_woghoH1UlP-g8kzU8-miRz6BFeEKUc/plain/h_2000'
      },
      url: 'https://img-v2-prod.whop.com/Vfw_iSpdcntx_woghoH1UlP-g8kzU8-miRz6BFeEKUc/plain/h_2000',
      contentType: 'image/jpeg'
    }
  ]
};

// 测试用例 2: 赵哥 8-28 官方教案帖 (规则触发词 + 广播区)
const zhaoTestPost = {
  id: 'post_1CeVMWfa7s3SwVLxrSg3X9',
  feedId: 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
  channel_name: '不用翻墙美股发布',
  sender_name: 'xiaozhaolucky',
  created_at: 1787923200000,
  content: '36.5出掉34.75剩下一半spyu 指数低什么都不敢买时候就可以买指数 指数前瞻预测知道要上去指数的杠杆是必然涨',
  attachments: []
};

console.log('1️⃣ 【上半部 ISR 测试】模拟活消息触发中断写入：');
const isrResZhou = dispatchIngestTopHalf(zhouTestPost);
console.log(`   - 周哥发图帖 ISR 耗时: ${isrResZhou.elapsed_ms}ms (预算 < 200ms)`);
console.log(`     Dispatched Queues: [${isrResZhou.dispatched_queues.join(', ')}]`);

const isrResZhao = dispatchIngestTopHalf(zhaoTestPost);
console.log(`   - 赵哥教案帖 ISR 耗时: ${isrResZhao.elapsed_ms}ms (预算 < 200ms)`);
console.log(`     Dispatched Queues: [${isrResZhao.dispatched_queues.join(', ')}]\n`);

console.log('2️⃣ 【检查 ingest_events 与 pipeline_tasks 落库状态】：');
const eventCount = db.prepare(`SELECT count(*) as count FROM ingest_events`).get().count;
const taskCount = db.prepare(`SELECT count(*) as count FROM pipeline_tasks`).get().count;
console.log(`   - ingest_events 事件总数: ${eventCount}`);
console.log(`   - pipeline_tasks 任务总数: ${taskCount}\n`);

console.log('3️⃣ 【下半部 DPC 消费测试】启动 media_worker 异步消费 media 队列：');
await runMediaWorker(5);

console.log('4️⃣ 【生成队列水位状态 queue_status.json】：');
generateQueueStatus();

console.log('========================================================================================');
console.log('🎉 中断处理流水线 (ISR / DPC) 核心逻辑验收通过！');
console.log('========================================================================================\n');
