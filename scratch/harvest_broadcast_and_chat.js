import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
dotenv.config();

// =========================================================================
// 🚀 官方广播 (Forum 论坛流) 与主力讨论区 (Chat 聊天流) 深度换签落盘引擎
// 规范参照: data/specs/ENGINEERING_HANDOFF_20260829.md
// =========================================================================

const MANIFEST_PATH = 'data/media/zhao/media_manifest.json';
const manifestData = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const manifest = manifestData.manifest || [];

console.log('========================================================================================');
console.log('🎯 官方广播 (369 张) 与主力讨论区 (720 张) 深度换签落盘引擎');
console.log(`📋 当前已就绪图片数: ${manifest.filter(m => m.status === 'ok').length} 张 / ${manifest.length} 张`);
console.log('========================================================================================\n');

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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 注入 Cookie
  const rawCookie = process.env.WHOP_COOKIE || '';
  for (const pair of rawCookie.split(';')) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name && value) {
        try {
          await page.setCookie({ name, value, domain: '.whop.com', path: '/' });
        } catch (e) {}
      }
    }
  }

  let totalSaved = manifest.filter(m => m.status === 'ok').length;

  // 网络拦截监听
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('img-v2-prod.whop.com') || url.includes('assets-2-prod.whop.com')) {
      for (const [fn, item] of filenameToManifestMap.entries()) {
        if (url.toLowerCase().includes(fn) && item.status !== 'ok') {
          try {
            const buf = await res.buffer();
            if (await saveImage(buf, item, url)) {
              totalSaved++;
              console.log(`  📸 [网络拦截落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA: ${item.sha256.slice(0, 10)}`);
            }
          } catch (e) {}
        }
      }
    }
  });

  // 1. 深度处理官方广播论坛频道 (Forum Feed)
  console.log('📻 阶段一: 深度遍历官方广播论坛频道 (不用翻墙美股发布)...');
  try {
    await page.goto('https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await new Promise(r => setTimeout(r, 6000));

    // 在论坛流中向下滚动（论坛帖子一般是按时间从新到旧向下排列）
    for (let step = 1; step <= 80; step++) {
      const domImgs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && (s.includes('img-v2-prod.whop.com') || s.includes('assets-2-prod.whop.com')));
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
                  console.log(`  📸 [广播DOM提取落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
                }
              }
            } catch (e) {}
          }
        }
      }

      // 论坛向下滚动加载更多历史帖子
      await page.evaluate(() => {
        window.scrollBy(0, 1200);
      });

      await new Promise(r => setTimeout(r, 800));

      if (step % 20 === 0) {
        const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
        console.log(`  ⏳ 广播论坛向下滚动第 [${step}/80] 次 | 广播就绪: ${broadcastOk}/369 (${((broadcastOk/369)*100).toFixed(1)}%)`);
      }
    }
  } catch (e) {
    console.warn('⚠️ 广播论坛抓取提示:', e.message);
  }

  // 2. 深度处理主力讨论区 (Chat Feed)
  console.log('\n💬 阶段二: 深度遍历美股讨论区 (不用翻墙美股讨论区)...');
  try {
    await page.goto('https://whop.com/stock-and-option/exp_9vfxZgBNgXykNt/app/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await new Promise(r => setTimeout(r, 6000));

    // 聊天向上滚动加载历史
    for (let step = 1; step <= 80; step++) {
      const domImgs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && (s.includes('img-v2-prod.whop.com') || s.includes('assets-2-prod.whop.com')));
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
                  console.log(`  📸 [讨论区DOM提取落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
                }
              }
            } catch (e) {}
          }
        }
      }

      await page.evaluate(() => {
        const viewports = document.querySelectorAll('.fui-ScrollAreaViewport, [role="presentation"], div[class*="ScrollArea"]');
        viewports.forEach(v => {
          if (v.scrollHeight > v.clientHeight) v.scrollTop = 0;
        });
        window.scrollBy(0, -1000);
      });

      await new Promise(r => setTimeout(r, 800));

      if (step % 20 === 0) {
        const currentOk = manifest.filter(m => m.status === 'ok').length;
        console.log(`  ⏳ 讨论区向上滚动第 [${step}/80] 次 | 全量落盘: ${currentOk}/${manifest.length}`);
      }
    }
  } catch (e) {
    console.warn('⚠️ 讨论区抓取提示:', e.message);
  }

  await browser.close();

  // 持久化更新 manifest
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

  // 输出最新看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.kind === 'K_FORUM' && m.status === 'ok').length;
  const totalOkCount = manifest.filter(m => m.status === 'ok').length;

  console.log('\n========================================================================================');
  console.log('📊 配图自动换签落盘最新审计看板');
  console.log('========================================================================================');
  console.log(`  1. 📻 官方广播配图: 共 ${broadcastItems.length} 张 | 成功落盘: ${broadcastOk} 张 (${((broadcastOk/broadcastItems.length)*100).toFixed(1)}%)`);
  console.log(`  2. 💬 讨论/期权/其他配图: 共 ${forumItems.length} 张 | 成功落盘: ${forumOk} 张 (${((forumOk/forumItems.length)*100).toFixed(1)}%)`);
  console.log(`  3. 📦 全量配图总数: 共 ${manifest.length} 张 | 成功落盘: ${totalOkCount} 张 (${((totalOkCount/manifest.length)*100).toFixed(1)}%)`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('🛡️ 质量红线核验:');
  console.log(`  - 广播配图达标率 ≥80%: ${broadcastOk / broadcastItems.length >= 0.8 ? '✅ 达标' : '🛑 未达标'}`);
  console.log('  - 14B / 多模态推理调用: 0 calls (严格阻断)');
  console.log('  - L2a 水印与增量指针: 未改动');
  console.log('========================================================================================\n');
}

run().catch(console.error);
