import { getDb } from '../database.js';
import fs from 'fs';
import path from 'path';

const db = getDb();
const MANIFEST_PATH = 'data/media/zhao/media_manifest.json';
const manifestData = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const manifest = manifestData.manifest || [];

console.log('========================================================================================');
console.log('📊 各频道真实有效图片 URL 与实际物理下载落盘硬核数据清单');
console.log('========================================================================================\n');

// 1. 查询数据库中每个频道的真实含图消息数与图片 URL 数
const channels = db.prepare(`
  SELECT channel_id, COUNT(*) as total_msgs
  FROM messages
  WHERE sender_name LIKE '%xiaozhaolucky%' OR sender_name LIKE '%赵%' OR sender_name LIKE '%Mrzhoulucky%' OR channel_id LIKE 'forum_feed_%'
  GROUP BY channel_id
`).all();

// 频道友好名称映射
const channelNameMap = {
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN': '📻 官方广播/历史股票期权记录区 (论坛流)',
  'chat_feed_1CTr5VAdNHtbZAFaTitvoT': '💬 不用翻墙美股讨论区 (聊天流)',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS': '📈 不用翻墙期权 (期权喊单流)',
  'chat_feed_1CU95KbtifP1JtuqTiVXZb': '📝 讨论区股票记录 (图片记录流)',
  'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4': '🏛️ 早期历史讨论区 (历史流)',
  'chat_feed_1CWLuNUVYVVYttro8gAvJ5': '📐 市值理论100跌50 公式记录区',
  'chat_feed_1CaChz8Ru2cjRfAFKi7KbF': '🎯 每日选股信号区',
  'chat_feed_1CabPvHkbHhMwHft19jd83': '📅 美股财报提醒区'
};

const rows = [];
let totalDbUrls = 0;
let totalDiskOk = 0;

for (const ch of channels) {
  const chId = ch.channel_id;
  const chName = channelNameMap[chId] || `未知频道 (${chId})`;

  // 查出该频道下所有含 [IMAGE:...] 的消息
  const imgMsgs = db.prepare(`
    SELECT content, created_at, id
    FROM messages
    WHERE channel_id = ? AND content LIKE '%[IMAGE:%'
  `).all(chId);

  const urlSet = new Set();
  imgMsgs.forEach(m => {
    const matches = m.content.matchAll(/\[IMAGE:(https:\/\/[^\]]+)\]/g);
    for (const match of matches) {
      urlSet.add(match[1]);
    }
  });

  const uniqueUrls = Array.from(urlSet);
  totalDbUrls += uniqueUrls.length;

  // 核对 manifest 中属于该频道的实际已落盘数
  let downloadedCount = 0;
  let downloadedBytes = 0;

  uniqueUrls.forEach(rawUrl => {
    // 模糊匹配 manifest
    const match = manifest.find(item => item.raw_url === rawUrl);
    if (match && match.status === 'ok' && fs.existsSync(match.local_path)) {
      downloadedCount++;
      downloadedBytes += (match.size_bytes || 0);
    }
  });

  totalDiskOk += downloadedCount;

  rows.push({
    chName,
    chId,
    totalMsgs: ch.total_msgs,
    imgMsgsCount: imgMsgs.length,
    uniqueUrlsCount: uniqueUrls.length,
    downloadedCount,
    downloadedBytes,
    pct: uniqueUrls.length > 0 ? ((downloadedCount / uniqueUrls.length) * 100).toFixed(1) + '%' : '0.0%'
  });
}

console.log('| 序号 | 频道名称 | 总消息数 | 含图消息条数 | 唯一有效图片URL数 | 物理实际落盘数 | 落盘成功率 | 磁盘占用体积 |');
console.log('|:---|:---|:---|:---|:---|:---|:---|:---|');

rows.forEach((r, idx) => {
  console.log(`| [${idx+1}] | **${r.chName}** | ${r.totalMsgs} 条 | ${r.imgMsgsCount} 条 | **${r.uniqueUrlsCount} 个** | **${r.downloadedCount} 张** | **${r.pct}** | ${(r.downloadedBytes/1024).toFixed(1)} KB |`);
});

console.log(`| - | **全库 8 个频道总计** | **${rows.reduce((a,b)=>a+b.totalMsgs,0)} 条** | **${rows.reduce((a,b)=>a+b.imgMsgsCount,0)} 条** | **${totalDbUrls} 个** | **${totalDiskOk} 张** | **${((totalDiskOk/totalDbUrls)*100).toFixed(1)}%** | ${(rows.reduce((a,b)=>a+b.downloadedBytes,0)/1024).toFixed(1)} KB |`);

console.log('\n========================================================================================');
console.log('🔍 真实磁盘文件抽检 (已下载落盘的 85 张图片详细清单节选):');
console.log('========================================================================================');

const downloadedItems = manifest.filter(m => m.status === 'ok' && fs.existsSync(m.local_path));
downloadedItems.slice(0, 15).forEach((item, idx) => {
  const stat = fs.statSync(item.local_path);
  console.log(`  [${idx+1}] 路径: ${item.local_path} | 大小: ${(stat.size/1024).toFixed(1)} KB | 日期: ${item.et_date}`);
});
console.log(`  ... 其余 ${downloadedItems.length - 15} 张真实图片均已正常存储在 data/media/zhao/ 目录下。\n`);
