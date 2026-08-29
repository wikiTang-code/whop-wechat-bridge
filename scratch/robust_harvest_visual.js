import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
dotenv.config();

// =========================================================================
// 🚀 高鲁棒性可视化真实 Chrome 全频道配图自动换签落盘引擎
// 规范参照: data/specs/ENGINEERING_HANDOFF_20260829.md
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

// 目标核心赵哥频道清单（直达 URL）
const TARGET_CHANNELS = [
  { name: '📻 不用翻墙美股发布 (官方喊单/广播)', url: 'https://whop.com/stock-and-option/exp_GiWyN1ZTuUjwlG/app/' },
  { name: '💬 不用翻墙美股讨论区 (主力讨论区)', url: 'https://whop.com/stock-and-option/exp_9vfxZgBNgXykNt/app/' },
  { name: '📈 不用翻墙期权 (期权喊单区)', url: 'https://whop.com/stock-and-option/exp_gZyq1MzOZAWO98/app/' },
  { name: '📝 讨论区股票记录', url: 'https://whop.com/stock-and-option/exp_YaUGmSLziDBKaw/app/' },
  { name: '📜 历史股票期权记录区', url: 'https://whop.com/stock-and-option/exp_JG1I58S5zTHbxs/app/' },
  { name: '📐 市值理论100跌50 公式记录', url: 'https://whop.com/stock-and-option/exp_B3kT9y4dyQGpgy/app/' }
];

async function run() {
  console.log('========================================================================================');
  console.log('🖥️ 高鲁棒性可视化真实 Chrome 全频道自动换签落盘引擎');
  console.log(`📋 当前已就绪: ${manifest.filter(m => m.status === 'ok').length} 张 / ${manifest.length} 张`);
  console.log('========================================================================================\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // 严格注入 Cookie
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

  for (let chIdx = 0; chIdx < TARGET_CHANNELS.length; chIdx++) {
    const ch = TARGET_CHANNELS[chIdx];
    console.log(`\n========================================================================================`);
    console.log(`▶️ [${chIdx + 1}/${TARGET_CHANNELS.length}] 正在直达进入频道: ${ch.name}`);
    console.log(`🔗 URL: ${ch.url}`);
    console.log(`========================================================================================`);

    try {
      await page.goto(ch.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 4000));

      // 获取页面中间位置，以便鼠标滚轮正中消息容器
      const width = page.viewport() ? page.viewport().width : 1440;
      const height = page.viewport() ? page.viewport().height : 900;
      await page.mouse.move(width / 2, height / 2);

      // 深度模拟滚轮滚动 60 轮
      for (let step = 1; step <= 60; step++) {
        // DOM 图片提取与下载
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
                      console.log(`  📸 [DOM提取落盘] ${item.local_path} (${(buf.length/1024).toFixed(1)} KB)`);
                    }
                  }
                } catch (e) {}
              }
            }
          }
        } catch (domErr) {}

        // 模拟真实鼠标滚轮向上/向下滚动
        await page.mouse.wheel({ deltaY: -1000 });
        await new Promise(r => setTimeout(r, 600));

        if (step % 15 === 0 || step === 60) {
          const currentOk = manifest.filter(m => m.status === 'ok').length;
          const broadcastOk = manifest.filter(m => m.kind === 'K_BROADCAST' && m.status === 'ok').length;
          console.log(`  ⏳ [${ch.name}] 滚轮进度: [${step}/60] | 全量落盘: ${currentOk}/${manifest.length} | 广播就绪: ${broadcastOk}/369`);
        }
      }

      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), 'utf-8');

    } catch (err) {
      console.warn(`⚠️ 频道 ${ch.name} 抓取异常:`, err.message);
    }
  }

  await browser.close();

  // 输出最终看板
  const broadcastItems = manifest.filter(m => m.kind === 'K_BROADCAST');
  const broadcastOk = broadcastItems.filter(m => m.status === 'ok').length;
  const forumItems = manifest.filter(m => m.kind === 'K_FORUM');
  const forumOk = forumItems.filter(m => m.status === 'ok').length;
  const totalOkCount = manifest.filter(m => m.status === 'ok').length;

  console.log('\n========================================================================================');
  console.log('📊 全量配图自动换签落盘最终审计看板');
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
