import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📦 构建 L2a 广播频道 1195 组 Context Units 数据集');
console.log('====================================================\n');

// 1. 创建独立候选表 l2a_order_candidates
db.exec(`
  CREATE TABLE IF NOT EXISTS l2a_order_candidates (
    cu_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    channel_id TEXT,
    et_session TEXT,
    et_date TEXT,
    speech_act TEXT,
    actions_json TEXT,
    claims_json TEXT,
    raw_text TEXT,
    parse_ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_speech_act ON l2a_order_candidates(speech_act);
  CREATE INDEX IF NOT EXISTS idx_l2a_cand_date ON l2a_order_candidates(et_date);
`);
console.log('✅ 数据库候选表 l2a_order_candidates 已就绪！');

// 2. 提取目标频道大V消息
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

console.log(`📥 成功提取交易记录频道大V发言: ${msgs.length} 条`);

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

// 3. 严格 V3 聚类切窗
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

console.log(`🏛️ 严格切窗完成，共切出 ${clusters.length} 组 L1 Context Units`);

// 4. 格式化并输出为标准 Context Unit JSONL 文件
const outCuList = clusters.map((c, idx) => {
  const first = c[0];
  const last = c[c.length - 1];
  const cuId = `cu_trade_${String(idx + 1).padStart(5, '0')}`;

  return {
    cu_id: cuId,
    channel: first.channel_id,
    time: {
      et_date: first.info.etDateStr,
      session: first.info.session,
      start_utc: new Date(first.tMs).toISOString(),
      end_utc: new Date(last.tMs).toISOString(),
      duration_min: parseFloat(((last.tMs - first.tMs) / 60000).toFixed(1))
    },
    message_count: c.length,
    dialogue_messages: c.map(m => ({
      role: 'kol',
      speaker: '赵哥',
      text: m.content
    }))
  };
});

const outDir = 'data/samples';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outCuPath = path.join(outDir, 'l2a_broadcast_cu_1195.jsonl');
fs.writeFileSync(outCuPath, outCuList.map(item => JSON.stringify(item)).join('\n'), 'utf-8');

console.log(`💾 成功写入标准数据集: ${outCuPath} (共 ${outCuList.length} 组 CU)\n`);
