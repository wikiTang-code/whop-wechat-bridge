import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('📚 导出 Mrzhoulucky 四频道全量教材包 (只读研究数据集)');
console.log('====================================================\n');

const CHANNEL_MAP = {
  'chat_feed_1CaEnj8BrNBr95YSbgabYZ': '日内波段信号检测',
  'chat_feed_1CaPyASfSWTuruMgL2u3sT': '股票分析',
  'chat_feed_1CaChz8Ru2cjRfAFKi7KbF': '每日选股',
  'chat_feed_1CabPvHkbHhMwHft19jd83': '财报日提醒'
};

const targetChannelIds = Object.keys(CHANNEL_MAP);
const placeholders = targetChannelIds.map(() => '?').join(',');

const outDir = 'data/curriculum/mrzhou';
const imgDir = path.join(outDir, 'images');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

// 1. 读取 4 频道全部历史消息
const msgs = db.prepare(`
  SELECT id, channel_id, sender_id, content, created_at
  FROM messages
  WHERE channel_id IN (${placeholders})
  ORDER BY created_at ASC
`).all(...targetChannelIds);

console.log(`📥 成功提取 4 频道消息总数: ${msgs.length} 条`);

function formatTimeStamps(rawT) {
  const tMs = rawT < 9999999999 ? rawT * 1000 : rawT;
  const d = new Date(tMs);
  const tsUtc = d.toISOString();
  
  // 美东时间格式化 (YYYY-MM-DDTHH:mm:ss-04:00 / -05:00)
  const etFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = etFormatter.formatToParts(d);
  const map = {};
  parts.forEach(p => map[p.type] = p.value);
  const tsEt = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-04:00`;
  
  // 紧凑时间戳用于文件名
  const cleanUtc = tsUtc.replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
  return { tMs, tsUtc, tsEt, cleanUtc };
}

// 2. 提取图片 URL
function extractImageUrls(content) {
  const urls = [];
  if (!content) return urls;

  // 正则匹配 [IMAGE:url] 或普通 https://...whop.com... 图片链接
  const regex1 = /\[IMAGE:(https?:\/\/[^\]]+)\]/gi;
  let m;
  while ((m = regex1.exec(content)) !== null) {
    urls.push(m[1].trim());
  }

  const regex2 = /(https?:\/\/[^\s\)]+\.(?:png|jpg|jpeg|webp|gif))/gi;
  while ((m = regex2.exec(content)) !== null) {
    if (!urls.includes(m[1])) urls.push(m[1].trim());
  }

  const regex3 = /https:\/\/img-v2-prod\.whop\.com\/[^\s\)]+/gi;
  while ((m = regex3.exec(content)) !== null) {
    if (!urls.includes(m[0])) urls.push(m[0].trim());
  }

  return urls;
}

// 3. 处理消息与构建 Manifest
const exportMessages = [];
const imageManifest = [];
const downloadQueue = [];

const channelStats = {};
for (const cid of targetChannelIds) {
  channelStats[cid] = {
    channel_name: CHANNEL_MAP[cid],
    total_messages: 0,
    messages_with_image: 0,
    total_images: 0,
    min_date_et: null,
    max_date_et: null
  };
}

for (const m of msgs) {
  const { tsUtc, tsEt, cleanUtc } = formatTimeStamps(m.created_at);
  const chName = CHANNEL_MAP[m.channel_id] || '未知频道';
  const imgUrls = extractImageUrls(m.content);

  const stats = channelStats[m.channel_id];
  stats.total_messages++;
  if (imgUrls.length > 0) {
    stats.messages_with_image++;
    stats.total_images += imgUrls.length;
  }
  if (!stats.min_date_et || tsEt < stats.min_date_et) stats.min_date_et = tsEt.slice(0, 10);
  if (!stats.max_date_et || tsEt > stats.max_date_et) stats.max_date_et = tsEt.slice(0, 10);

  const imageIds = [];

  imgUrls.forEach((url, idx) => {
    const ext = url.includes('.png') ? 'png' : (url.includes('.webp') ? 'webp' : 'jpg');
    const imgId = `img_${m.id}_${String(idx + 1).padStart(2, '0')}`;
    const filename = `${cleanUtc}_${m.id}_${String(idx + 1).padStart(2, '0')}.${ext}`;
    const relativePath = `images/${filename}`;
    const fullPath = path.join(imgDir, filename);

    imageIds.push(imgId);
    imageManifest.push({
      image_id: imgId,
      msg_id: m.id,
      channel_id: m.channel_id,
      channel_name: chName,
      file: relativePath,
      url: url,
      ts_utc: tsUtc,
      ts_et: tsEt,
      ocr_text: null
    });

    downloadQueue.push({ url, fullPath });
  });

  exportMessages.push({
    msg_id: m.id,
    channel_id: m.channel_id,
    channel_name: chName,
    ts_utc: tsUtc,
    ts_et: tsEt,
    speaker: m.sender_id === 'user_4yeplXgbguTu4' ? '赵哥' : (m.sender_id || 'Mrzhoulucky'),
    text: m.content,
    has_image: imgUrls.length > 0,
    image_ids: imageIds
  });
}

// 4. 保存 JSONL 与 Stats
const msgsPath = path.join(outDir, 'messages.jsonl');
const manifestPath = path.join(outDir, 'images_manifest.jsonl');
const statsPath = path.join(outDir, 'channel_stats.json');

fs.writeFileSync(msgsPath, exportMessages.map(item => JSON.stringify(item)).join('\n'), 'utf-8');
fs.writeFileSync(manifestPath, imageManifest.map(item => JSON.stringify(item)).join('\n'), 'utf-8');
fs.writeFileSync(statsPath, JSON.stringify(channelStats, null, 2), 'utf-8');

console.log(`\n💾 全量文字已保存: ${msgsPath} (共 ${exportMessages.length} 条)`);
console.log(`🖼️ 图片清册已保存: ${manifestPath} (共 ${imageManifest.length} 张图)`);
console.log(`📊 统计报告已保存: ${statsPath}`);

// 5. 异步下载图片 (限速并发 5)
async function downloadImages() {
  if (downloadQueue.length === 0) {
    console.log('\n✅ 无需下载新图片。');
    return;
  }

  console.log(`\n🚀 正在并发下载 ${downloadQueue.length} 张图片到本地...`);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < downloadQueue.length; i += 5) {
    const batch = downloadQueue.slice(i, i + 5);
    await Promise.all(batch.map(async item => {
      if (fs.existsSync(item.fullPath)) {
        successCount++;
        return;
      }
      try {
        const res = await fetch(item.url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(item.fullPath, buf);
        successCount++;
      } catch (e) {
        failCount++;
      }
    }));
  }

  console.log(`🎉 图片下载完成: 成功 ${successCount} 张，失败/跳过 ${failCount} 张！\n`);
}

downloadImages().then(() => {
  console.log('====================================================');
  console.log('✅ Mrzhoulucky 教材包全套工程资产已就绪！');
  console.log('====================================================');
});
