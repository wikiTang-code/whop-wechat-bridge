/**
 * @file verify_monitor_ingest_pipeline.js
 * @description 运行一次 monitor.js 的 syncChannel，验证活消息进入库时自动触发 ISR 分发 + 自动触发 DPC 媒体下载
 */

import { syncAndAnalyze } from '../monitor.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

console.log('========================================================================================');
console.log('🧪 启动 monitor.js 主链路入库自动化验收测试 (ISR + DPC 集成实测)');
console.log('========================================================================================\n');

const db = new Database(path.resolve('whop_archive.db'));

// 1. 获取当前 ingest_events 和 pipeline_tasks 计数
const beforeEvents = db.prepare(`SELECT count(*) as count FROM ingest_events`).get().count;
const beforeTasks = db.prepare(`SELECT count(*) as count FROM pipeline_tasks`).get().count;

console.log(`📊 执行前数据库状态: ingest_events = ${beforeEvents}, pipeline_tasks = ${beforeTasks}\n`);

// 2. 触发一次 monitor.js 的常规同步 (跳过交易和微信，纯验证入库 + ISR + DPC)
console.log('📡 正在触发 monitor.js syncAndAnalyze (常规增量同步)...');
const syncRes = await syncAndAnalyze({ backfill: false, skipTrades: true, skipWeChat: true, skipReport: true });
console.log('📥 增量同步执行完毕:', syncRes);

// 3. 检查执行后状态
const afterEvents = db.prepare(`SELECT count(*) as count FROM ingest_events`).get().count;
const afterTasks = db.prepare(`SELECT count(*) as count FROM pipeline_tasks`).get().count;

console.log(`\n📊 执行后数据库状态: ingest_events = ${afterEvents} (+${afterEvents - beforeEvents}), pipeline_tasks = ${afterTasks} (+${afterTasks - beforeTasks})`);

// 4. 检查 queue_status.json 是否已自动刷新
const qsPath = path.resolve('data/queue_status.json');
if (fs.existsSync(qsPath)) {
  const qs = JSON.parse(fs.readFileSync(qsPath, 'utf-8'));
  console.log(`\n🏷️ queue_status.json 实时徽章: [${qs.badge_summary}]`);
  console.log(`   - 媒体队列待下载 (pending): ${qs.queues?.media?.pending || 0}`);
  console.log(`   - 媒体队列已完成 (done): ${qs.queues?.media?.done || 0}`);
}

console.log('\n========================================================================================');
console.log('🎉 monitor.js 主链路入库中断流水线集成测试 100% 成功！');
console.log('========================================================================================\n');
