import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

// =========================================================================
// 🚀 【不用翻墙美股发布】死循环向上回溯与实质配图落盘引擎
// 绝不设定虚假轮次上限！持续死磕向上回溯直到 2025 年 10 月历史起点！
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
        console.log(`  🎉 [实质落盘成功] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA256: ${item.sha256.slice(0, 10)}`);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function runInfiniteDrain() {
  console.log('========================================================================================');
  console.log('🚀 启动【不用翻墙美股发布】无限向上死磕落盘引擎 (直到历史起点)');
  console.log(`📋 当前已落盘: ${manifest.filter(m => m.status === 'ok').length} 张 / ${manifest.length} 张`);
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];
  const client = await page.target().createCDPSession();

  // 网络监听拦截
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('whop.com')) {
      await matchAndSave(u, async () => await res.buffer());
    }
  });

  console.log('🎯 直达进入【不用翻墙美股发布】...');
  await page.goto('https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await new Promise(r => setTimeout(r, 4000));

  // 获取真实滚动容器坐标
  const container = await page.evaluate(() => {
    const scroller = document.querySelector('.Sl1Q0W_ChatMessagesScroller, .ChatMessagesScroller, .fui-ScrollAreaViewport') || document.body;
    const r = scroller.getBoundingClientRect();
    
    let badge = document.getElementById('antigravity-active-badge');
    if (badge) badge.innerHTML = `⚡ 正在无限死磕向上回溯: 【不用翻墙美股发布】`;
    
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

  let step = 0;
  let noProgressRounds = 0;
  let lastOkCount = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;

  while (true) {
    step++;

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

    // 强力向上物理滚轮
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: container.x,
      y: container.y,
      deltaX: 0,
      deltaY: -1500
    });

    await new Promise(r => setTimeout(r, 400));

    if (step % 20 === 0) {
      const currentOk = manifest.filter(m => m.status === 'ok').length;
      const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
      
      // 读取页面最顶端的一条消息文本以评估当前回溯到的日期
      const topMsgText = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.ChatMessageRoot, div[class*="Message"]');
        return msgs.length > 0 ? msgs[0].textContent.slice(0, 40) : '未检测到消息';
      });

      console.log(`  ⚡ [【不用翻墙美股发布】] 向上回溯第 [${step}] 步 | 最顶端消息: "${topMsgText.trim().replace(/\s+/g, ' ')}" | 广播落盘: ${broadcastOk}/234 (${((broadcastOk/234)*100).toFixed(1)}%) | 全库落盘: ${currentOk}/1289`);
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

      if (broadcastOk >= 234 * 0.8) {
        console.log(`\n🎉 【不用翻墙美股发布】配图达标率已达到 80% (${broadcastOk}/234)，达成硬交付红线！`);
        break;
      }
    }
  }
}

runInfiniteDrain().catch(console.error);
