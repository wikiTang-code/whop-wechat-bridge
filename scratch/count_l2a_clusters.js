import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

const targetChannelIds = [
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN',
  'chat_feed_1CU95KbtifP1JtuqTiVXZb',
  'chat_feed_1CWLuNUVYVVYttro8gAvJ5'
];

const placeholders = targetChannelIds.map(() => '?').join(',');
const TARGET_SPEAKER = 'user_4yeplXgbguTu4';

const msgs = db.prepare(`
  SELECT id, channel_id, sender_id, content, created_at
  FROM messages
  WHERE channel_id IN (${placeholders}) AND sender_id = ?
  ORDER BY created_at ASC
`).all(...targetChannelIds, TARGET_SPEAKER);

console.log(`📦 交易记录频道大V发言总数: ${msgs.length} 条`);

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

// 聚类切窗
const clusters = [];
let curCluster = [];

for (let i = 0; i < msgs.length; i++) {
  const m = msgs[i];
  const tMs = m.created_at < 9999999999 ? m.created_at * 1000 : m.created_at;
  const info = getEtInfo(tMs);

  if (curCluster.length === 0) {
    curCluster.push({ ...m, tMs, info });
  } else {
    const prev = curCluster[curCluster.length - 1];
    const first = curCluster[0];
    const isSameDate = prev.info.etDateStr === info.etDateStr;
    const isSameSession = prev.info.session === info.session;
    const isWithinGap = (tMs - prev.tMs) <= 20 * 60 * 1000;
    const isWithinMaxDur = (tMs - first.tMs) <= 60 * 60 * 1000;

    if (isSameDate && isSameSession && isWithinGap && isWithinMaxDur && curCluster.length < 8) {
      curCluster.push({ ...m, tMs, info });
    } else {
      clusters.push(curCluster);
      curCluster = [{ ...m, tMs, info }];
    }
  }
}
if (curCluster.length > 0) clusters.push(curCluster);

console.log(`\n🏛️ 按 V3 严格切窗规则聚类后:`);
console.log(`   - 交易单总 Context Unit (CU) 数量: ${clusters.length} 组`);
console.log(`   - 平均每组包含消息数: ${(msgs.length / clusters.length).toFixed(1)} 条/窗`);
