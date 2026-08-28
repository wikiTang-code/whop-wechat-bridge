import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🖼️ 修复并下载 Mrzhoulucky 教材包图片');
console.log('====================================================\n');

const manifestPath = 'data/curriculum/mrzhou/images_manifest.jsonl';
const lines = fs.readFileSync(manifestPath, 'utf-8').trim().split('\n').filter(l => l.trim().length > 0);
const items = lines.map(l => JSON.parse(l));

console.log(`📦 清册中共有 ${items.length} 张图片`);

const cleanItems = [];
const seenUrls = new Set();

for (const it of items) {
  let url = it.url.replace(/\]+$/, '').trim();
  if (seenUrls.has(url)) continue;
  seenUrls.add(url);
  it.url = url;
  cleanItems.push(it);
}

console.log(`🧹 去重清洗后有效独立图片: ${cleanItems.length} 张`);

fs.writeFileSync(manifestPath, cleanItems.map(it => JSON.stringify(it)).join('\n'), 'utf-8');

// 尝试下载前 10 张测试
const imgDir = 'data/curriculum/mrzhou/images';
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

async function runDownload() {
  let success = 0;
  let fail = 0;

  for (let i = 0; i < cleanItems.length; i++) {
    const item = cleanItems[i];
    const fullPath = path.join('data/curriculum/mrzhou', item.file);

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 1000) {
      success++;
      continue;
    }

    try {
      const res = await fetch(item.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 500) {
        fs.writeFileSync(fullPath, buf);
        success++;
        console.log(`✅ [${i + 1}/${cleanItems.length}] 成功下载: ${item.file} (${(buf.length / 1024).toFixed(1)} KB)`);
      } else {
        fail++;
      }
    } catch (e) {
      fail++;
      // console.warn(`⚠️ 下载失败 [${item.file}]:`, e.message);
    }
  }

  console.log(`\n🎉 下载完成看板: 成功入盘 ${success} 张，不可达/过期 ${fail} 张！`);
}

runDownload();
