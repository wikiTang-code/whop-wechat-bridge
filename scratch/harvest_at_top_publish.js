import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const MANIFEST_PATH = 'data/media/zhao/media_manifest.json';
const manifestData = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const manifest = manifestData.manifest || [];

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const uuidToManifestMap = new Map();
for (const item of manifest) {
  const match = item.raw_url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (match) {
    uuidToManifestMap.set(match[1].toLowerCase(), item);
  }
}

async function saveImage(buf, item, sourceUrl) {
  if (!buf || buf.length < 500) return false;
  const dir = path.dirname(item.local_path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(item.local_path, buf);
  item.status = 'ok';
  item.sha256 = computeSha256(buf);
  item.size_bytes = buf.length;
  item.fresh_url = sourceUrl;
  return true;
}

async function matchAndSave(url, bufGetter) {
  const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return false;
  
  const uuid = match[1].toLowerCase();
  const item = uuidToManifestMap.get(uuid);
  if (item && item.status !== 'ok') {
    try {
      const buf = await bufGetter();
      if (await saveImage(buf, item, url)) {
        console.log(`  🎉 [实质落盘成功] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA256: ${item.sha256.slice(0, 10)}`);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function harvestTop() {
  console.log('========================================================================================');
  console.log('🎯 在【不用翻墙美股发布】历史顶端区间逐屏精细扫描与落盘');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('whop.com')) {
      await matchAndSave(u, async () => await res.buffer());
    }
  });

  // 从 scrollTop = 0 开始，每次向下平滑滚动 300px，直到底部（7000px）
  console.log('🚀 开始从历史顶端向下逐屏 300px 精细扫描（确保每张图都进入视口并渲染）...');

  for (let pos = 0; pos <= 7500; pos += 250) {
    await page.evaluate((scrollTarget) => {
      const scrollers = document.querySelectorAll('.ChatMessagesScroller, .Sl1Q0W_ChatMessagesScroller, .fui-ScrollAreaViewport');
      scrollers.forEach(s => {
        if (s.scrollHeight > 1000) s.scrollTop = scrollTarget;
      });
    }, pos);

    await new Promise(r => setTimeout(r, 600));

    // 提取 DOM
    const domUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(i => i.src).filter(Boolean);
    });

    for (const u of domUrls) {
      await matchAndSave(u, async () => {
        const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return Buffer.from(await r.arrayBuffer());
      });
    }

    if (pos % 1000 === 0 || pos >= 7500) {
      const currentOk = manifest.filter(m => m.status === 'ok').length;
      const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
      console.log(`  📍 扫描位置: ${pos}/7500 px | 广播落盘: ${broadcastOk}/234 (${((broadcastOk/234)*100).toFixed(1)}%) | 全库就绪: ${currentOk}/1289`);
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');
    }
  }

  // 最终核查
  const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
  console.log('\n========================================================================================');
  console.log(`📊 【不用翻墙美股发布】精细扫描完成！实盘落盘数: ${broadcastOk} 张 / 234 张 (${((broadcastOk/234)*100).toFixed(1)}%)`);
  console.log('========================================================================================\n');

  await browser.disconnect();
}

harvestTop().catch(console.error);
