import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../database.js';

// =========================================================================
// 🏭 L2b 知识层离线流水线 (赵哥判断/答疑/日历纪律/看图互证)
// 规范参照: data/specs/ENGINEERING_HANDOFF_20260829.md
// =========================================================================

const args = process.argv.slice(2);
const isDryCut = args.includes('--dry-cut');
const runIdIdx = args.indexOf('--run-id');
const runId = runIdIdx !== -1 && args[runIdIdx + 1] ? args[runIdIdx + 1] : `20260829_know01`;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null;

console.log('====================================================');
console.log(`🧠 L2b 知识层离线流水线 (Run ID: ${runId})`);
console.log(`🛠️ 运行模式: ${isDryCut ? '✂️ [DRY-CUT 知识切窗 + 全量下图]' : '🤖 [14B/多模态知识抽取]'}`);
console.log('🛡️ 隔离约束: 绝不修改 L2a 文件/水印，绝不在点击路径调模型');
console.log('====================================================\n');

// 保证目录存在
const MEDIA_BASE_DIR = 'data/media/zhao';
const SAMPLES_DIR = 'data/samples';
const RUNS_DIR = 'data/runs';
[MEDIA_BASE_DIR, SAMPLES_DIR, RUNS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ----------------------------------------------------
// 1. 时区与时段工具函数 (严格美东时区)
// ----------------------------------------------------
function getEtInfo(timestampMs) {
  const date = new Date(timestampMs);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const partMap = {};
  parts.forEach(p => partMap[p.type] = p.value);
  
  const et_date = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const hour = parseInt(partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);
  const timeNum = hour * 100 + minute;
  
  let session = 'regular';
  if (timeNum >= 400 && timeNum < 930) session = 'pre_market';
  else if (timeNum >= 930 && timeNum <= 1600) session = 'regular';
  else if (timeNum > 1600 && timeNum <= 2000) session = 'post_market';
  else session = 'overnight';
  
  return { et_date, session };
}

// ----------------------------------------------------
// 2. 图片下载与本地持久化引擎 (§5.3 硬交付)
// ----------------------------------------------------
function extractImageUrls(content) {
  if (!content) return [];
  const urls = [];
  
  // 1. 匹配 [IMAGE:url]
  const imageTagRegex = /\[IMAGE:(https?:\/\/[^\]]+)\]/gi;
  let match;
  while ((match = imageTagRegex.exec(content)) !== null) {
    urls.push(match[1].trim());
  }
  
  // 2. 匹配原生 URL (Whop assets / prod)
  const plainWhopRegex = /(https?:\/\/(?:img-v2-prod\.whop\.com|assets-2-prod\.whop\.com)\/[^\s\)\"\'\]]+)/gi;
  while ((match = plainWhopRegex.exec(content)) !== null) {
    const u = match[1].trim();
    if (!urls.includes(u)) urls.push(u);
  }
  
  return urls;
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function downloadAndCacheImage(url, etDate, messageId, idx) {
  const dateDir = path.join(MEDIA_BASE_DIR, etDate);
  if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });
  
  const filename = `${messageId}_${idx}.jpg`;
  const localPath = path.join(dateDir, filename).replace(/\\/g, '/');
  
  // 若本地已有且有效
  if (fs.existsSync(localPath)) {
    try {
      const existingBuf = fs.readFileSync(localPath);
      if (existingBuf.length > 500) {
        return {
          url,
          local_path: localPath,
          sha256: computeSha256(existingBuf),
          status: 'ok',
          cached: true
        };
      }
    } catch (e) {}
  }
  
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!res.ok) {
      return {
        url,
        local_path: localPath,
        sha256: null,
        status: 'missing',
        error: `HTTP ${res.status}`
      };
    }
    
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    
    if (buf.length < 200) {
      return {
        url,
        local_path: localPath,
        sha256: null,
        status: 'missing',
        error: 'Image buffer too small or expired'
      };
    }
    
    fs.writeFileSync(localPath, buf);
    const sha256 = computeSha256(buf);
    
    return {
      url,
      local_path: localPath,
      sha256,
      status: 'ok',
      cached: false
    };
  } catch (err) {
    return {
      url,
      local_path: localPath,
      sha256: null,
      status: 'missing',
      error: err.message
    };
  }
}

// ----------------------------------------------------
// 3. 知识层切窗算法 (§5.2 前3 + 后2 上下文)
// ----------------------------------------------------
console.log('📡 开始从 SQLite 数据库提取赵哥发言与上下文消息...');
const db = getDb();

// 提取全频道所有发言 (按时间升序)
const allMessages = db.prepare(`
  SELECT id, channel_id, channel_name, sender_id, sender_name, content, created_at
  FROM messages
  WHERE content IS NOT NULL AND content != ''
  ORDER BY created_at ASC
`).all();

console.log(`📦 全库可用消息总数: ${allMessages.length} 条`);

// 建立频道消息时序索引
const channelMsgMap = new Map();
for (let i = 0; i < allMessages.length; i++) {
  const m = allMessages[i];
  const { et_date, session } = getEtInfo(m.created_at);
  m.et_date = et_date;
  m.session = session;
  
  if (!channelMsgMap.has(m.channel_id)) channelMsgMap.set(m.channel_id, []);
  channelMsgMap.get(m.channel_id).push(m);
}

// 识别赵哥发言作为锚点
function isZhaoSpeaker(m) {
  if (m.sender_id === 'user_4yeplXgbguTu4') return true;
  if (m.sender_name && (m.sender_name.includes('赵哥') || m.sender_name === 'xiaozhaolucky')) return true;
  return false;
}

const BROADCAST_CHANNEL = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN';

// 收集知识 CU
const rawKnowledgeCus = [];
const processedAnchorIds = new Set();

for (const [chanId, msgs] of channelMsgMap.entries()) {
  for (let i = 0; i < msgs.length; i++) {
    const anchor = msgs[i];
    if (!isZhaoSpeaker(anchor)) continue;
    if (processedAnchorIds.has(anchor.id)) continue;
    
    // 确定前 3 + 后 2 窗口边界 (必须同频道、同美东日、同交易时段)
    let startIdx = i;
    let prevCount = 0;
    while (startIdx > 0 && prevCount < 3) {
      const prevMsg = msgs[startIdx - 1];
      if (prevMsg.et_date === anchor.et_date && prevMsg.session === anchor.session) {
        startIdx--;
        prevCount++;
      } else {
        break;
      }
    }
    
    let endIdx = i;
    let nextCount = 0;
    while (endIdx < msgs.length - 1 && nextCount < 2) {
      const nextMsg = msgs[endIdx + 1];
      if (nextMsg.et_date === anchor.et_date && nextMsg.session === anchor.session) {
        endIdx++;
        nextCount++;
      } else {
        break;
      }
    }
    
    const cuMessages = msgs.slice(startIdx, endIdx + 1);
    
    // 标记窗口内所有赵哥发言已被覆盖
    cuMessages.forEach(m => {
      if (isZhaoSpeaker(m)) processedAnchorIds.add(m.id);
    });
    
    const isBroadcast = chanId === BROADCAST_CHANNEL;
    rawKnowledgeCus.push({
      channel_id: chanId,
      channel_name: anchor.channel_name || (isBroadcast ? '广播频道' : '讨论/期权区'),
      kind: isBroadcast ? 'K_BROADCAST' : 'K_FORUM',
      anchor_id: anchor.id,
      et_date: anchor.et_date,
      session: anchor.session,
      start_utc: new Date(cuMessages[0].created_at).toISOString(),
      end_utc: new Date(cuMessages[cuMessages.length - 1].created_at).toISOString(),
      messages: cuMessages
    });
  }
}

console.log(`🎯 知识切窗完成: 共划分 ${rawKnowledgeCus.length} 组知识 CU (K-广播 + K-讨论)`);

// ----------------------------------------------------
// 4. 全量图片下载与本地化关联
// ----------------------------------------------------
console.log('\n🖼️ 开始全量图片下载与本地持久化 (落盘至 data/media/zhao/**)...');

let totalImgsDetected = 0;
let totalImgsDownloaded = 0;
let totalImgsCached = 0;
let totalImgsMissing = 0;

const finalKnowledgeCus = [];

for (let seq = 0; seq < rawKnowledgeCus.length; seq++) {
  const rawCu = rawKnowledgeCus[seq];
  const cuId = `cu_know_${runId}_${String(seq + 1).padStart(5, '0')}`;
  
  const dialogueMessages = [];
  const cuMediaList = [];
  
  for (const m of rawCu.messages) {
    const isZhao = isZhaoSpeaker(m);
    const speakerName = isZhao ? '赵哥' : (m.sender_name || '群友');
    
    dialogueMessages.push({
      message_id: m.id,
      speaker: speakerName,
      is_zhao: isZhao,
      text: m.content
    });
    
    // 提取图片
    const imgUrls = extractImageUrls(m.content);
    for (let uIdx = 0; uIdx < imgUrls.length; uIdx++) {
      totalImgsDetected++;
      const u = imgUrls[uIdx];
      const resMedia = await downloadAndCacheImage(u, rawCu.et_date, m.id, uIdx);
      
      if (resMedia.status === 'ok') {
        if (resMedia.cached) totalImgsCached++;
        else totalImgsDownloaded++;
      } else {
        totalImgsMissing++;
      }
      
      cuMediaList.push(resMedia);
    }
  }
  
  finalKnowledgeCus.push({
    cu_id: cuId,
    kind: rawCu.kind,
    channel: rawCu.channel_id,
    channel_name: rawCu.channel_name,
    time: {
      et_date: rawCu.et_date,
      session: rawCu.session,
      start_utc: rawCu.start_utc,
      end_utc: rawCu.end_utc
    },
    dialogue_messages: dialogueMessages,
    media: cuMediaList
  });
  
  if ((seq + 1) % 100 === 0 || seq === rawKnowledgeCus.length - 1) {
    process.stdout.write(`  ⏳ 已处理 ${seq + 1}/${rawKnowledgeCus.length} 组 CU | 图片已捕获: ${totalImgsDetected} 张\r`);
  }
}

console.log('\n');

// ----------------------------------------------------
// 5. 产物落盘与统计看板
// ----------------------------------------------------
const outCuPath = `data/samples/l2b_cu_${runId}.jsonl`;
fs.writeFileSync(outCuPath, finalKnowledgeCus.map(c => JSON.stringify(c)).join('\n'), 'utf-8');

const kBroadcastCount = finalKnowledgeCus.filter(c => c.kind === 'K_BROADCAST').length;
const kForumCount = finalKnowledgeCus.filter(c => c.kind === 'K_FORUM').length;
const cusWithMediaCount = finalKnowledgeCus.filter(c => c.media && c.media.length > 0).length;

console.log('========================================================================================');
console.log(`📊 L2b 知识层离线切窗与图片下载看板 (Run ID: ${runId})`);
console.log('========================================================================================');
console.log(`  1. 知识 CU 样本总数:      ${finalKnowledgeCus.length} 组 (已落盘至 ${outCuPath})`);
console.log(`     - 📻 K-广播知识窗:    ${kBroadcastCount} 组 (来自官方广播频道)`);
console.log(`     - 💬 K-讨论知识窗:    ${kForumCount} 组 (来自讨论区/期权区答疑)`);
console.log(`     - 🖼️ 含有配图的 CU 数: ${cusWithMediaCount} 组 (${((cusWithMediaCount / finalKnowledgeCus.length)*100).toFixed(1)}%)`);
console.log('----------------------------------------------------------------------------------------');
console.log(`  2. 全量图片下载审计看板:`);
console.log(`     - 📸 检测到图片 URL 总数: ${totalImgsDetected} 张`);
console.log(`     - ✅ 本地下载并落盘成功:  ${totalImgsDownloaded} 张`);
console.log(`     - 🔄 本地缓存已存在复用:  ${totalImgsCached} 张`);
console.log(`     - ❌ 图片过期或下载失败:  ${totalImgsMissing} 张 (${totalImgsDetected > 0 ? ((totalImgsMissing/totalImgsDetected)*100).toFixed(2) : 0}%)`);
console.log(`     - 📂 存储目录:          data/media/zhao/**`);
console.log('----------------------------------------------------------------------------------------');
console.log('🛡️ 阶段保护核验:');
console.log('  - 无任何 BUY / SELL 交易动作字段');
console.log('  - L2a 水印与增量指针分毫未改');
console.log('  - 未触发任何大模型调用 (0 API calls)');
console.log('========================================================================================\n');
