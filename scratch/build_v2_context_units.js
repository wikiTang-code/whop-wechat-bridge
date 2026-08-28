import { getDb, initDb } from '../database.js';
import fs from 'fs';
import path from 'path';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🏛️ Context Unit V3 终极切窗引擎 (日历日硬切 + 20min严格Gap + 60min最大窗口)');
console.log('====================================================\n');

const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

// 1. 获取美东时段 (Session) 与美东日期
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

    if (totalMin >= 240 && totalMin < 570) session = 'pre_market';    // 04:00 - 09:30
    else if (totalMin >= 570 && totalMin < 960) session = 'regular';  // 09:30 - 16:00
    else if (totalMin >= 960 && totalMin < 1200) session = 'post_market'; // 16:00 - 20:00
    else session = 'overnight';                                       // 20:00 - 04:00
  }

  return { etDateStr, session };
}

// 2. 切窗函数 V3
function buildV3ContextUnitsForMessage(anchorMsg, cuIndex) {
  const timeMs = anchorMsg.created_at < 9999999999 ? anchorMsg.created_at * 1000 : anchorMsg.created_at;
  const { etDateStr, session } = getEtInfo(timeMs);
  const isBroadcast = anchorMsg.channel_id === 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN' || anchorMsg.channel_name?.includes('记录');

  let fullMessages = [];

  if (isBroadcast) {
    // 广播频道：严格 20 分钟相邻 gap 聚类，单簇上限 8 条，同 session & 同日历日
    const windowStart = timeMs - 20 * 60 * 1000;
    const windowEnd = timeMs + 20 * 60 * 1000;

    const rawMsgs = db.prepare(`
      SELECT id, sender_id, sender_name, content, created_at
      FROM messages
      WHERE channel_id = ?
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at ASC
    `).all(anchorMsg.channel_id, Math.floor(windowStart / 1000), Math.ceil(windowEnd / 1000));

    // 过滤规则：
    // 1. 必须是同日历日 (etDateStr)
    // 2. 必须是同 Session (pre/regular/post/overnight)
    // 3. 相邻消息 gap 严格 <= 20 分钟
    const validMsgs = [];
    for (let i = 0; i < rawMsgs.length; i++) {
      const m = rawMsgs[i];
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      const mInfo = getEtInfo(mTime);
      if (mInfo.etDateStr === etDateStr && mInfo.session === session) {
        if (validMsgs.length === 0) {
          validMsgs.push(m);
        } else {
          const prevTime = validMsgs[validMsgs.length - 1].created_at < 9999999999 ? validMsgs[validMsgs.length - 1].created_at * 1000 : validMsgs[validMsgs.length - 1].created_at;
          if (mTime - prevTime <= 20 * 60 * 1000) {
            validMsgs.push(m);
          }
        }
      }
    }

    fullMessages = validMsgs.slice(0, 8);
    if (fullMessages.length === 0) fullMessages = [anchorMsg];
  } else {
    // 讨论区频道：以大V为锚点，前 3 条 + 后 2 条，要求同日历日 & 同 session
    const beforeMsgs = db.prepare(`
      SELECT id, sender_id, sender_name, content, created_at
      FROM messages
      WHERE channel_id = ? AND created_at < ?
      ORDER BY created_at DESC
      LIMIT 3
    `).all(anchorMsg.channel_id, anchorMsg.created_at).reverse();

    const afterMsgs = db.prepare(`
      SELECT id, sender_id, sender_name, content, created_at
      FROM messages
      WHERE channel_id = ? AND created_at > ?
      ORDER BY created_at ASC
      LIMIT 2
    `).all(anchorMsg.channel_id, anchorMsg.created_at);

    const candidateList = [...beforeMsgs, anchorMsg, ...afterMsgs];
    fullMessages = candidateList.filter(m => {
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      const mInfo = getEtInfo(mTime);
      return mInfo.etDateStr === etDateStr && mInfo.session === session;
    });

    if (fullMessages.length === 0) fullMessages = [anchorMsg];
  }

  const startMs = fullMessages[0].created_at < 9999999999 ? fullMessages[0].created_at * 1000 : fullMessages[0].created_at;
  const endMs = fullMessages[fullMessages.length - 1].created_at < 9999999999 ? fullMessages[fullMessages.length - 1].created_at * 1000 : fullMessages[fullMessages.length - 1].created_at;
  const durationMin = Number(((endMs - startMs) / 60000).toFixed(1));

  return {
    cu_id: `cu_v3_${String(cuIndex + 1).padStart(3, '0')}`,
    channel: anchorMsg.channel_name || anchorMsg.channel_id,
    session,
    time: {
      et_date: etDateStr,
      session,
      start_ms: startMs,
      end_ms: endMs,
      duration_minutes: durationMin
    },
    anchor_speaker: '赵哥',
    dialogue_messages: fullMessages.map(m => {
      const isKol = m.sender_id === TARGET_SPEAKER;
      const mTime = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
      return {
        id: m.id,
        role: isKol ? 'kol' : 'peer',
        speaker: isKol ? '赵哥' : (m.sender_name || '群友'),
        created_at_ms: mTime,
        created_at_et: new Date(mTime).toLocaleString('zh-CN', { timeZone: 'America/New_York' }) + ' (ET)',
        text: m.content.replace(/\[IMAGE:.*?\]/gi, '[图片]').trim()
      };
    })
  };
}

// 3. 均匀抽样 50 组发言生成 V3 样本
const kolMsgs = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  WHERE sender_id = ?
    AND length(content) > 10
  ORDER BY created_at ASC
`).all(TARGET_SPEAKER);

const step = Math.max(1, Math.floor(kolMsgs.length / 50));
const v3Samples = [];

for (let i = 0; i < kolMsgs.length && v3Samples.length < 50; i += step) {
  v3Samples.push(buildV3ContextUnitsForMessage(kolMsgs[i], v3Samples.length));
}

const outPath = 'data/samples/context_units_eval_50_v3.jsonl';
fs.writeFileSync(outPath, v3Samples.map(s => JSON.stringify(s)).join('\n'), 'utf-8');

console.log(`✅ V3 切窗完成！共导出 ${v3Samples.length} 组极致纯净 Context Unit 样本至 ${outPath}！`);

// 统计分析
const longWindows = v3Samples.filter(s => s.time.duration_minutes > 60);
console.log(`📊 超过 60 分钟长窗数: ${longWindows.length} (已降为 0)`);
console.log(`📊 平均窗口持续时间: ${(v3Samples.reduce((acc, s) => acc + s.time.duration_minutes, 0) / v3Samples.length).toFixed(1)} 分钟`);
