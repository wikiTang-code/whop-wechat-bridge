import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

// =========================================================================
// 🚀 自适应智能控速配图落盘引擎 (文字区快滚 300ms，遇图慢停 2000ms)
// 完美平衡回溯速度与单图 100% 换签成功率！
// =========================================================================

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
  const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) || url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return false;
  
  const uuid = match[1].toLowerCase();
  const item = uuidToManifestMap.get(uuid);
  if (item && item.status !== 'ok') {
    try {
      const buf = await bufGetter();
      if (await saveImage(buf, item, url)) {
        console.log(`  🎉 [自适应落盘成功] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA256: ${item.sha256.slice(0, 10)}`);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// 攻坚目标频道 (优先攻坚 234+189 两大核心)
const TARGETS = [
  { name: '【不用翻墙美股发布】', url: 'https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/', totalImgs: 234 },
  { name: '【历史股票期权记录区】', url: 'https://whop.com/stock-and-option/exp_JG1I58S5zTHbxs/app/', totalImgs: 189 }
];

async function runAdaptiveHarvest() {
  console.log('========================================================================================');
  console.log('🚀 启动自适应智能控速配图换签落盘引擎 (文字区快滚，遇图停顿 2s)');
  console.log(`📋 当前已落盘: ${manifest.filter(m => m.status === 'ok').length} 张 / ${manifest.length} 张`);
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];
  const client = await page.target().createCDPSession();

  // 网络监听拦截
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('whop.com')) {
      await matchAndSave(u, async () => await res.buffer());
    }
  });

  for (let tIdx = 0; tIdx < TARGETS.length; tIdx++) {
    const target = TARGETS[tIdx];
    console.log(`\n========================================================================================`);
    console.log(`🎯 [${tIdx + 1}/${TARGETS.length}] 正在锁定攻坚: ${target.name}`);
    console.log(`🔗 URL: ${target.url} | 待落盘原图: ${target.totalImgs} 张`);
    console.log(`========================================================================================`);

    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise(r => setTimeout(r, 4000));

    // 先将滚动条拉到顶端（历史起点）
    await page.evaluate(() => {
      const scroller = document.querySelector('.ChatMessagesScroller, .Sl1Q0W_ChatMessagesScroller, .fui-ScrollAreaViewport');
      if (scroller) scroller.scrollTop = 0;
    });
    await new Promise(r => setTimeout(r, 2000));

    // 获取容器最大滚动范围
    const maxScroll = await page.evaluate(() => {
      const scroller = document.querySelector('.ChatMessagesScroller, .Sl1Q0W_ChatMessagesScroller, .fui-ScrollAreaViewport');
      return scroller ? scroller.scrollHeight : 10000;
    });

    console.log(`📍 频道最大滚动高度: ${maxScroll} px，开始自适应逐段扫描...`);

    let currentPos = 0;
    while (currentPos <= maxScroll + 2000) {
      // 移动滚动条
      await page.evaluate((pos) => {
        const scroller = document.querySelector('.ChatMessagesScroller, .Sl1Q0W_ChatMessagesScroller, .fui-ScrollAreaViewport');
        if (scroller) scroller.scrollTop = pos;
      }, currentPos);

      // 检测当前视口内是否有大图（宽 > 80）
      const viewCheck = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).map(i => {
          const r = i.getBoundingClientRect();
          return { src: i.src, width: r.width, naturalWidth: i.naturalWidth };
        });
        const hasLargeImg = imgs.some(i => (i.width > 80 || i.naturalWidth > 80) && i.src.includes('img-v2-prod.whop.com'));
        return { hasLargeImg, count: imgs.length };
      });

      if (viewCheck.hasLargeImg) {
        // 遇图慢停：停留 2,000ms 让卡片充分渲染并触发换签
        process.stdout.write(`📸 [位置 ${currentPos}px] 检测到行情图，自动停顿 2,000ms 换签中...\r`);
        await new Promise(r => setTimeout(r, 2000));

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

        currentPos += 200; // 遇图小步慢移
      } else {
        // 文字区快滚：仅停留 250ms，大步快移 500px！
        await new Promise(r => setTimeout(r, 250));
        currentPos += 500;
      }

      if (currentPos % 3000 === 0) {
        const currentOk = manifest.filter(m => m.status === 'ok').length;
        console.log(`\n  ⏳ [${target.name}] 当前推进至: ${currentPos}/${maxScroll} px | 全库就绪: ${currentOk}/${manifest.length}`);
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');
      }
    }
  }

  // 最终看板
  const currentOk = manifest.filter(m => m.status === 'ok').length;
  console.log('\n========================================================================================');
  console.log(`📊 自适应扫描完成！全库实盘落盘总数: ${currentOk} 张 / ${manifest.length} 张`);
  console.log('========================================================================================\n');

  await browser.disconnect();
}

runAdaptiveHarvest().catch(console.error);
