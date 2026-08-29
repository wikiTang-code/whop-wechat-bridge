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

const filenameToManifestMap = new Map();
for (const item of manifest) {
  const match = item.raw_url.match(/([a-f0-9\-]{30,}\.(?:png|jpg|jpeg))/i);
  if (match) {
    filenameToManifestMap.set(match[1].toLowerCase(), item);
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

async function run() {
  console.log('========================================================================================');
  console.log('📻 启动官方广播/喊单频道专属极速换签落盘流水线');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  let totalSaved = manifest.filter(m => m.status === 'ok').length;

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('img-v2-prod.whop.com') || url.includes('assets-2-prod.whop.com')) {
      for (const [fn, item] of filenameToManifestMap.entries()) {
        if (url.toLowerCase().includes(fn) && item.status !== 'ok') {
          try {
            const buf = await res.buffer();
            if (await saveImage(buf, item, url)) {
              totalSaved++;
              console.log(`  📸 [广播网络拦截] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA: ${item.sha256.slice(0, 10)}`);
            }
          } catch (e) {}
        }
      }
    }
  });

  console.log('🚀 正在直达进入官方广播论坛页面...');
  await page.goto('https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 4000));

  // 论坛页面连续向下大步幅滚动 100 轮
  for (let step = 1; step <= 100; step++) {
    // 提取 DOM
    try {
      const domImgs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(img => img.src).filter(s => s && (s.includes('img-v2-prod.whop.com') || s.includes('assets-2-prod.whop.com')));
      });

      for (const src of domImgs) {
        for (const [fn, item] of filenameToManifestMap.entries()) {
          if (src.toLowerCase().includes(fn) && item.status !== 'ok') {
            try {
              const imgRes = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                if (await saveImage(buf, item, src)) {
                  totalSaved++;
                  console.log(`  📸 [广播DOM提取] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // 向下大步幅滚动加载历史帖子卡片
    await page.evaluate(() => {
      window.scrollBy(0, 1500);
      const scrollers = document.querySelectorAll('.fui-ScrollAreaViewport, [role="presentation"], div[class*="ScrollArea"], main div');
      scrollers.forEach(s => {
        if (s.scrollHeight > s.clientHeight) s.scrollTop += 1500;
      });
    });

    await new Promise(r => setTimeout(r, 400));

    if (step % 20 === 0 || step === 100) {
      const currentOk = manifest.filter(m => m.status === 'ok').length;
      const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
      console.log(`  ⏳ 官方广播向下滚动 [${step}/100] 轮 | 广播落盘: ${broadcastOk}/369 (${((broadcastOk/369)*100).toFixed(1)}%) | 全库就绪: ${currentOk}/1289`);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');
  await browser.disconnect();
}

run().catch(console.error);
