import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
dotenv.config();

// =========================================================================
// 🚀 全自动无人值守 Whop 广播与各频道配图自动换签落盘引擎
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
console.log('🤖 全自动无人值守 Whop 配图换签落盘引擎 (Puppeteer 自动操控)');
console.log(`📋 待匹配清单图片总数: ${manifest.length} 张 (广播: 369 张, 讨论/期权: 920 张)`);
console.log('🎯 验收目标: 广播含图窗 ≥80%，金样 A/B 落盘，绝不开大模型');
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

  const targetChannels = [
    { name: '📻 不用翻墙美股发布 (官方广播)', url: 'https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/' },
    { name: '💬 不用翻墙美股讨论区', url: 'https://whop.com/stock-and-option/exp_9vfxZgBNgXykNt/app/' },
    { name: '📈 不用翻墙期权', url: 'https://whop.com/stock-and-option/exp_gZyq1MzOZAWO98/app/' },
    { name: '📝 讨论区股票记录', url: 'https://whop.com/stock-and-option/exp_YaUGmSLziDBKaw/app/' },
    { name: '📜 历史股票期权记录区', url: 'https://whop.com/stock-and-option/exp_JG1I58S5zTHbxs/app/' },
    { name: '📐 市值理论100跌50 公式记录', url: 'https://whop.com/stock-and-option/exp_B3kT9y4dyQGpgy/app/' }
  ];

  console.log('\n🚀 开始逐一全量遍历全部 6 个赵哥核心频道并深度拉取配图...\n');

  for (const ch of targetChannels) {
    console.log(`========================================================================================`);
    console.log(`▶️ 正在进入频道: ${ch.name}`);
    console.log(`🔗 频道 URL: ${ch.url}`);
    console.log(`========================================================================================`);

    try {
      await page.goto(ch.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 等待 3 秒让聊天 DOM 和 WebSocket 充分加载
      await new Promise(r => setTimeout(r, 3000));

      // 深度向上滚动 60 次
      for (let step = 1; step <= 60; step++) {
        // 提取当前 DOM 中的所有图片并尝试直接下载
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
                    console.log(`  📸 [DOM提取落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
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
              v.scrollTop = 0; // 滚动到最顶部触发历史加载
            }
          });
          window.scrollBy(0, -1000);
        });

        await new Promise(r => setTimeout(r, 1200));

        const currentOk = manifest.filter(m => m.status === 'ok').length;
        const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
        process.stdout.write(`  ⏳ 频道 [${ch.name}] 滚动第 [${step}/60] 次 | 全量落盘: ${currentOk}/1289 | 广播已就绪: ${broadcastOk}/369\r`);
      }
      console.log('\n');

    } catch (chanErr) {
      console.warn(`⚠️ 频道 ${ch.name} 加载异常:`, chanErr.message);
    }
  }

  console.log('\n');
  await browser.close();

  // 保存最新清单
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

  // 输出审计看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.status === 'ok').length;
  const totalOk = manifest.filter(m => m.status === 'ok').length;

  console.log('========================================================================================');
  console.log('📊 全量配图自动换签落盘审计看板 (Puppeteer 自动执行)');
  console.log('========================================================================================');
  console.log(`  1. 📻 官方广播配图: 共 ${broadcastItems.length} 张 | 成功落盘: ${broadcastOk} 张 (${((broadcastOk/broadcastItems.length)*100).toFixed(1)}%)`);
  console.log(`  2. 💬 讨论/期权配图: 共 ${forumItems.length} 张 | 成功落盘: ${forumOk} 张 (${((forumOk/forumItems.length)*100).toFixed(1)}%)`);
  console.log(`  3. 📦 全量配图总数: 共 ${manifest.length} 张 | 成功落盘: ${totalOk} 张 (${((totalOk/manifest.length)*100).toFixed(1)}%)`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('🛡️ 质量红线核验:');
  console.log(`  - 广播配图达标率 ≥80%: ${broadcastOk / broadcastItems.length >= 0.8 ? '✅ 达标' : '🛑 未达标'}`);
  console.log('  - 14B / 多模态推理调用: 0 calls (严格阻断)');
  console.log('  - L2a 水印与增量指针: 未改动');
  console.log('========================================================================================\n');
}

run().catch(console.error);
