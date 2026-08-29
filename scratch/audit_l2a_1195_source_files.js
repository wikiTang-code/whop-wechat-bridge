import fs from 'fs';
import readline from 'readline';
import { getDb } from '../database.js';

const db = getDb();

async function auditL2aSources() {
  console.log('========================================================================================');
  console.log('🔍 深度审计: L2a 1195 笔成交单 & L2b 5807 组 CU 的真实数据源频道分布');
  console.log('========================================================================================\n');

  // 1. 审计 L2a 1195 候选集
  const l2aFile = 'data/runs/l2a_broadcast_candidates_1195.jsonl';
  const l2aLines = fs.readFileSync(l2aFile, 'utf-8').trim().split('\n').filter(Boolean);
  
  const l2aChannelCounts = {};
  const l2aSampleMessages = {};

  for (const line of l2aLines) {
    const item = JSON.parse(line);
    const msgId = item.message_id || item.id;
    
    // 从 messages 表查该消息属于哪个 channel_id
    const msg = db.prepare(`SELECT channel_id, content, sender_name FROM messages WHERE id = ?`).get(msgId);
    const chId = msg?.channel_id || item.channel_id || 'UNKNOWN';
    
    l2aChannelCounts[chId] = (l2aChannelCounts[chId] || 0) + 1;
    if (!l2aSampleMessages[chId]) {
      l2aSampleMessages[chId] = { content: msg?.content || item.content, sender: msg?.sender_name || item.sender_name };
    }
  }

  console.log(`📊 1. L2a (1,195 笔成交单) 来源频道精准分布:`);
  for (const [chId, count] of Object.entries(l2aChannelCounts)) {
    console.log(`  ▶️ 频道 ID: ${chId} -> 提取成交单数: ${count} 笔 (${((count/l2aLines.length)*100).toFixed(1)}%)`);
    console.log(`     消息样例: [${l2aSampleMessages[chId]?.sender}]: ${l2aSampleMessages[chId]?.content?.slice(0, 100).replace(/\n/g, ' ')}`);
  }

  // 2. 审计 L2b 5807 组知识 CU
  const l2bFile = 'data/samples/l2b_cu_20260829_know01.jsonl';
  const l2bLines = fs.readFileSync(l2bFile, 'utf-8').trim().split('\n').filter(Boolean);
  const l2bChannelCounts = {};

  for (const line of l2bLines) {
    const item = JSON.parse(line);
    const chId = item.channel_id || item.feed_id || 'UNKNOWN';
    l2bChannelCounts[chId] = (l2bChannelCounts[chId] || 0) + 1;
  }

  console.log(`\n📊 2. L2b (5,807 组知识抽取窗口) 来源频道精准分布:`);
  for (const [chId, count] of Object.entries(l2bChannelCounts)) {
    console.log(`  ▶️ 频道 ID: ${chId} -> 知识窗口数: ${count} 组 (${((count/l2bLines.length)*100).toFixed(1)}%)`);
  }
}

auditL2aSources().catch(console.error);
