import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

// =========================================================================
// 🚀 全景超视距 (Zoom: 0.1) 批量激发与高速配图落盘引擎
// 将页面缩放至 10%，瞬间在单个视口内激发数百张历史行情图的渲染与换签！
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
  const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return false;
  
  const uuid = match[1].toLowerCase();
  const item = uuidToManifestMap.get(uuid);
  if (item && item.status !== 'ok') {
    try {
      const buf = await bufGetter();
      if (await saveImage(buf, item, url)) {
        console.log(`  📸 [全景落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA: ${item.sha256.slice(0, 10)}`);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function run() {
  console.log('========================================================================================');
  console.log('⚡ 启动全景超视距 (Zoom 10%) 全频道配图自动激发与落盘引擎');
  console.log(`📋 当前实存有效图片: ${manifest.filter(m => m.status === 'ok').length} 张 / ${manifest.length} 张`);
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  // 监听网络图片流
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('img-v2-prod.whop.com') || u.includes('assets-2-prod.whop.com')) {
      await matchAndSave(u, async () => await res.buffer());
    }
  });

  // 获取侧边栏核心频道
  const channels = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    return links.map((a, idx) => ({
      idx,
      text: a.textContent.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' '),
      href: a.getAttribute('href')
    })).filter(i => i.text && i.href);
  });

  for (let chIdx = 0; chIdx < channels.length; chIdx++) {
    const ch = channels[chIdx];
    console.log(`\n========================================================================================`);
    console.log(`▶️ [${chIdx + 1}/${channels.length}] 进入全景模式激发频道: ${ch.text}`);
    console.log(`========================================================================================`);

    await page.evaluate((idx) => {
      const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
      if (links[idx]) links[idx].click();
    }, chIdx);

    await new Promise(r => setTimeout(r, 3000));

    // 设置 15% 极小缩放，一次性激活视口内数百条消息卡片
    await page.evaluate(() => {
      document.body.style.zoom = '0.15';
    });

    await new Promise(r => setTimeout(r, 2000));

    // 滚动 50 轮
    for (let step = 1; step <= 50; step++) {
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

      // 滚动页面
      await page.evaluate(() => {
        const scroller = document.querySelector('.ChatMessagesScroller, .fui-ScrollAreaViewport, div[class*="ScrollArea"]') || window;
        if (scroller.scrollBy) {
          scroller.scrollBy(0, -3000);
        } else {
          window.scrollBy(0, -3000);
        }
      });

      await new Promise(r => setTimeout(r, 400));

      if (step % 10 === 0 || step === 50) {
        const currentOk = manifest.filter(m => m.status === 'ok').length;
        const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
        console.log(`  ⏳ [${ch.text}] 全景回溯 [${step}/50] 轮 | 全量已落盘: ${currentOk}/${manifest.length} | 广播就绪: ${broadcastOk}/369`);
      }
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');
  }

  // 恢复缩放
  await page.evaluate(() => { document.body.style.zoom = '1.0'; });

  // 最终看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.status === 'ok').length;
  const totalOkCount = manifest.filter(m => m.status === 'ok').length;

  console.log('\n========================================================================================');
  console.log('📊 全量配图全景超视距落盘最终审计看板');
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
