import { getDb, initDb } from '../database.js';
import fs from 'fs';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🏛️ 全量历史发言 L1 Context Unit 切窗与分布统计');
console.log('====================================================\n');

const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

// 1. 获取所有赵哥发言
const kolMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  WHERE sender_id = ?
  ORDER BY created_at ASC
`).all(TARGET_SPEAKER);

console.log(`📚 数据库中大V发言总数: ${kolMsgs.length} 条\n`);

function getEtInfo(dateMs) {
  const d = new Date(dateMs);
  const etDateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const timeMatch = etStr.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  
  let session = 'regular';
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const min = parseInt(timeMatch[2], 10);
    const totalMin = hour * 60 + min;

    if (totalMin >= 240 && totalMin < 570) session = 'pre_market';
    else if (totalMin >= 570 && totalMin < 960) session = 'regular';
    else if (totalMin >= 960 && totalMin < 1200) session = 'post_market';
    else session = 'overnight';
  }

  return { etDateStr, session };
}

// 2. 一次性读取该发言者所在频道的所有消息到内存，构建时间索引，避免 1.1 万次 SQL 往返
const allChannelMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  ORDER BY created_at ASC
`).all();

console.log(`⚡ 全库消息已载入内存: ${allChannelMsgs.length} 条，开始极速聚类切窗...`);

const channelMap = new Map();
for (const m of allChannelMsgs) {
  if (!channelMap.has(m.channel_id)) channelMap.set(m.channel_id, []);
  channelMap.get(m.channel_id).push(m);
}

const allUnits = [];
for (let i = 0; i < kolMsgs.length; i++) {
  const msg = kolMsgs[i];
  const timeMs = msg.created_at < 9999999999 ? msg.created_at * 1000 : msg.created_at;
  const { etDateStr, session } = getEtInfo(timeMs);
  const isBroadcast = msg.channel_id === 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN' || msg.channel_name?.includes('记录');

  const cList = channelMap.get(msg.channel_id) || [];
  let msgsInUnit = [];

  if (isBroadcast) {
    const windowStart = timeMs - 20 * 60 * 1000;
    const windowEnd = timeMs + 20 * 60 * 1000;

    const raw = cList.filter(m => {
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      return mTime >= windowStart && mTime <= windowEnd;
    });

    const valid = [];
    for (const m of raw) {
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      const mInfo = getEtInfo(mTime);
      if (mInfo.etDateStr === etDateStr && mInfo.session === session) {
        if (valid.length === 0) valid.push(m);
        else {
          const prevTime = valid[valid.length - 1].created_at < 9999999999 ? valid[valid.length - 1].created_at * 1000 : valid[valid.length - 1].created_at;
          if (mTime - prevTime <= 20 * 60 * 1000) valid.push(m);
        }
      }
    }
    msgsInUnit = valid.slice(0, 8);
  } else {
    // 讨论区：取 index 前 3 条 + 后 2 条
    const msgIdx = cList.findIndex(m => m.id === msg.id);
    if (msgIdx !== -1) {
      const startIdx = Math.max(0, msgIdx - 3);
      const endIdx = Math.min(cList.length, msgIdx + 3);
      const candidateList = cList.slice(startIdx, endIdx);
      msgsInUnit = candidateList.filter(m => {
        const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
        const mInfo = getEtInfo(mTime);
        return mInfo.etDateStr === etDateStr && mInfo.session === session;
      });
    }
  }

  if (msgsInUnit.length === 0) msgsInUnit = [msg];

  const startMs = msgsInUnit[0].created_at < 9999999999 ? msgsInUnit[0].created_at * 1000 : msgsInUnit[0].created_at;
  const endMs = msgsInUnit[msgsInUnit.length - 1].created_at < 9999999999 ? msgsInUnit[msgsInUnit.length - 1].created_at * 1000 : msgsInUnit[msgsInUnit.length - 1].created_at;
  const durMin = Number(((endMs - startMs) / 60000).toFixed(1));

  const textOnly = msgsInUnit.map(m => m.content.replace(/\[IMAGE:.*?\]/gi, '').trim()).join('');
  const isImageOnly = textOnly.length === 0;

  allUnits.push({
    cu_id: `cu_full_${String(allUnits.length + 1).padStart(5, '0')}`,
    channel: msg.channel_name || msg.channel_id,
    session,
    et_date: etDateStr,
    message_count: msgsInUnit.length,
    duration_minutes: durMin,
    is_image_only: isImageOnly
  });
}

// 3. 计算统计分布
const totalCUs = allUnits.length;
const durList = allUnits.map(u => u.duration_minutes).sort((a, b) => a - b);
const msgCountList = allUnits.map(u => u.message_count).sort((a, b) => a - b);

const medianDuration = durList[Math.floor(totalCUs / 2)];
const medianMsgCount = msgCountList[Math.floor(totalCUs / 2)];
const over60MinCount = allUnits.filter(u => u.duration_minutes > 60).length;
const imageOnlyCount = allUnits.filter(u => u.is_image_only).length;

console.log('====================================================');
console.log('📊 全库 L1 Context Unit 切窗分布统计报告');
console.log('====================================================');
console.log(`1. 生成 Context Units (CU) 总数: ${totalCUs} 个`);
console.log(`2. 中位持续时长 (Median Duration): ${medianDuration} 分钟`);
console.log(`3. 中位包含消息数 (Median Msg Count): ${medianMsgCount} 条`);
console.log(`4. 超过 60 分钟长窗数: ${over60MinCount} 个 (${((over60MinCount / totalCUs) * 100).toFixed(2)}%)`);
console.log(`5. 纯图片噪音单元数: ${imageOnlyCount} 个 (${((imageOnlyCount / totalCUs) * 100).toFixed(2)}%)`);
console.log('====================================================\n');
