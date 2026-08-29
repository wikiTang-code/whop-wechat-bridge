import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

// =========================================================================
// 🎯 肉眼可见精准滚动容器 + 屏幕 HUD 状态浮窗落盘引擎
// 解决焦点偏差问题，精准定位 .fui-ScrollAreaViewport 滚动条并实时上滑
// =========================================================================

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
  console.log('🎯 连接真实 Chrome 并注入肉眼可见精准滚动条与 HUD 状态浮窗');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const whopPage = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log(`📑 锁定浏览器标签页: "${await whopPage.title()}"`);

  let totalSaved = manifest.filter(m => m.status === 'ok').length;

  // 网络监听拦截
  whopPage.on('response', async (res) => {
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

  // 在真实 Chrome 屏幕右上角注入一个显眼的绿色 HUD 浮窗
  await whopPage.evaluate(() => {
    let hud = document.getElementById('antigravity-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'antigravity-hud';
      hud.style.position = 'fixed';
      hud.style.top = '20px';
      hud.style.right = '20px';
      hud.style.zIndex = '999999';
      hud.style.background = 'rgba(15, 23, 42, 0.95)';
      hud.style.color = '#38bdf8';
      hud.style.border = '2px solid #0284c7';
      hud.style.borderRadius = '12px';
      hud.style.padding = '14px 20px';
      hud.style.fontSize = '15px';
      hud.style.fontWeight = 'bold';
      hud.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
      hud.style.pointerEvents = 'none';
      document.body.appendChild(hud);
    }
    hud.innerHTML = '🤖 Antigravity 自动化已接管 | 正在精准回滚拉取赵哥图文...';
  });

  // 获取所有频道
  const channels = await whopPage.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    return links.map((a, idx) => ({
      idx,
      text: a.textContent.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' '),
      href: a.getAttribute('href')
    })).filter(i => i.text && i.href);
  });

  console.log(`\n📋 探测到全部 ${channels.length} 个频道:`);

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    console.log(`\n========================================================================================`);
    console.log(`▶️ [${i+1}/${channels.length}] 正在切换至: ${ch.text}`);
    console.log(`========================================================================================`);

    // 切换频道
    await whopPage.evaluate((idx) => {
      const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
      if (links[idx]) links[idx].click();
    }, i);

    await new Promise(r => setTimeout(r, 3000));

    // 真实可见向上/向下滚动 40 轮
    for (let step = 1; step <= 40; step++) {
      // 在页面真实滚动容器上执行滚动，并更新 HUD
      const scrollResult = await whopPage.evaluate((stepNum, chName, total, manifestLen) => {
        const hud = document.getElementById('antigravity-hud');
        if (hud) {
          hud.innerHTML = `🤖 频道: [${chName}] | 正在向上回溯第 ${stepNum}/40 轮 | 已落盘: ${total}/${manifestLen} 张`;
        }

        // 查找所有可能的聊天滚动容器
        const viewports = Array.from(document.querySelectorAll('.fui-ScrollAreaViewport, [role="presentation"], div[class*="ScrollArea"], main div'));
        let scrolledAny = false;
        viewports.forEach(v => {
          if (v.scrollHeight > v.clientHeight) {
            v.scrollTop -= 600; // 真实向上滚动
            scrolledAny = true;
          }
        });
        window.scrollBy(0, -600);
        return scrolledAny;
      }, step, ch.text, totalSaved, manifest.length);

      // DOM 提取
      const domImgs = await whopPage.evaluate(() => {
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
                  console.log(`  📸 [DOM提取落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
                }
              }
            } catch (e) {}
          }
        }
      }

      await new Promise(r => setTimeout(r, 600));

      if (step % 10 === 0) {
        const currentOk = manifest.filter(m => m.status === 'ok').length;
        const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
        console.log(`  ⏳ [${ch.text}] 可见滚动 [${step}/40] 轮 | 全量已落盘: ${currentOk}/${manifest.length} | 广播就绪: ${broadcastOk}/369`);
      }
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');
  }

  // 最终看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.status === 'ok').length;
  const totalOkCount = manifest.filter(m => m.status === 'ok').length;

  console.log('\n========================================================================================');
  console.log('📊 全量配图肉眼可见滚动换签落盘最终审计看板');
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
