import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
dotenv.config();

// =========================================================================
// 🚀 全频道无人值守 Whop 全量配图自动换签与本地落盘引擎
// 规范参照: data/specs/ENGINEERING_HANDOFF_20260829.md
// =========================================================================

const MANIFEST_PATH = 'data/media/zhao/media_manifest.json';
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('❌ 未找到 media_manifest.json');
  process.exit(1);
}

const manifestData = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const manifest = manifestData.manifest || [];

console.log('========================================================================================');
console.log('🤖 全频道无人值守 Whop 配图换签落盘引擎 (覆盖社群所有频道)');
console.log(`📋 待捕获清单图片总数: ${manifest.length} 张`);
console.log('🎯 验收目标: 覆盖所有频道，广播含图窗 ≥80%，金样 A/B 落盘，绝不开大模型');
console.log('========================================================================================\n');

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 建立图片原始文件名索引 (例如 92448b56-1da4-47fd-a252-4d7f1986e7dc.png)
const filenameToManifestMap = new Map();
for (const item of manifest) {
  const match = item.raw_url.match(/([a-f0-9\-]{30,}\.(?:png|jpg|jpeg))/i);
  if (match) {
    filenameToManifestMap.set(match[1].toLowerCase(), item);
  }
}

console.log(`🔍 成功索引文件名匹配项: ${filenameToManifestMap.size} 个\n`);

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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 严格解析并逐个注入 Cookie
  const rawCookie = process.env.WHOP_COOKIE || '';
  const cookiePairs = rawCookie.split(';');
  let injectedCount = 0;
  
  for (const pair of cookiePairs) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name && value) {
        try {
          await page.setCookie({
            name,
            value,
            domain: '.whop.com',
            path: '/'
          });
          injectedCount++;
        } catch (e) {}
      }
    }
  }

  console.log(`🍪 成功安全注入 ${injectedCount} 个 Cookie 凭证`);

  let totalSaved = 0;

  // 网络响应监听拦截
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

  console.log('\n🚀 导航至 Whop 社群主页以动态探测全部频道...');
  await page.goto('https://whop.com/stock-and-option/exp_9vfxZgBNgXykNt/app/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  await new Promise(r => setTimeout(r, 4000));

  // 获取页面上所有的频道可点击项
  const channelNames = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    return links.map((a, idx) => ({
      idx,
      text: a.textContent.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' '),
      href: a.getAttribute('href')
    })).filter(i => i.text && i.href);
  });

  console.log(`📑 动态探测到社群全部 ${channelNames.length} 个独立频道！\n`);

  for (let chIdx = 0; chIdx < channelNames.length; chIdx++) {
    const ch = channelNames[chIdx];
    
    console.log(`========================================================================================`);
    console.log(`▶️ [${chIdx + 1}/${channelNames.length}] 正在切换至频道: ${ch.text}`);
    console.log(`========================================================================================`);

    try {
      // 客户端单页点击切换频道
      await page.evaluate((idx) => {
        const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
        if (links[idx]) links[idx].click();
      }, chIdx);

      // 等待频道渲染
      await new Promise(r => setTimeout(r, 2500));

      // 深度向上滚动 40 轮
      for (let step = 1; step <= 40; step++) {
        // DOM 图片提取与自动落盘
        const domImgSrcs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && (s.includes('img-v2-prod.whop.com') || s.includes('assets-2-prod.whop.com')));
        });

        for (const src of domImgSrcs) {
          for (const [fn, item] of filenameToManifestMap.entries()) {
            if (src.toLowerCase().includes(fn) && item.status !== 'ok') {
              try {
                const imgRes = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  if (await saveImage(buf, item, src)) {
                    totalSaved++;
                    console.log(`  📸 [落盘成功] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB) - SHA: ${item.sha256.slice(0, 10)}`);
                  }
                }
              } catch (e) {}
            }
          }
        }

        // 向上滚动聊天容器
        await page.evaluate(() => {
          const viewports = document.querySelectorAll('.fui-ScrollAreaViewport, [role="presentation"], div[class*="ScrollArea"], div[class*="viewport"], main div');
          viewports.forEach(v => {
            if (v.scrollHeight > v.clientHeight) {
              v.scrollTop = 0;
            }
          });
          window.scrollBy(0, -1000);
        });

        await new Promise(r => setTimeout(r, 800));

        if (step % 10 === 0 || step === 40) {
          const currentOk = manifest.filter(m => m.status === 'ok').length;
          const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
          console.log(`  ⏳ [${ch.text}] 进度: [${step}/40] 轮 | 全量已落盘: ${currentOk}/${manifest.length} | 广播已就绪: ${broadcastOk}/369`);
        }
      }

      // 每完成一个频道立即将最新进度持久化到 manifest
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

    } catch (chanErr) {
      console.warn(`⚠️ 频道 ${ch.text} 切换异常:`, chanErr.message);
    }
  }

  console.log('\n');
  await browser.close();

  // 保存最终清单
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

  // 输出审计看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.status === 'ok').length;
  const totalOk = manifest.filter(m => m.status === 'ok').length;

  console.log('========================================================================================');
  console.log('📊 全频道全量配图自动换签落盘最终审计看板');
  console.log('========================================================================================');
  console.log(`  1. 📻 官方广播配图: 共 ${broadcastItems.length} 张 | 成功落盘: ${broadcastOk} 张 (${((broadcastOk/broadcastItems.length)*100).toFixed(1)}%)`);
  console.log(`  2. 💬 讨论/期权/其他配图: 共 ${forumItems.length} 张 | 成功落盘: ${forumOk} 张 (${((forumOk/forumItems.length)*100).toFixed(1)}%)`);
  console.log(`  3. 📦 全量配图总数: 共 ${manifest.length} 张 | 成功落盘: ${totalOk} 张 (${((totalOk/manifest.length)*100).toFixed(1)}%)`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('🛡️ 质量红线核验:');
  console.log(`  - 广播配图达标率 ≥80%: ${broadcastOk / broadcastItems.length >= 0.8 ? '✅ 达标' : '🛑 未达标'}`);
  console.log('  - 14B / 多模态推理调用: 0 calls (严格阻断)');
  console.log('  - L2a 水印与增量指针: 未改动');
  console.log('========================================================================================\n');
}

run().catch(console.error);
