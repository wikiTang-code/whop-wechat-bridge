import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import fs from 'fs';
import crypto from 'crypto';

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function testSingleImageGroundTruth() {
  console.log('========================================================================================');
  console.log('🧪 单图精细测通实验: 锁定真实行情图，单图停留 3 秒充分换签并落地验证');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log(`📑 锁定浏览器标签页: "${await page.title()}"`);

  // 1. 在当前页面查找所有宽度 > 100 的真实大图（过滤头像和小图标）
  const largeImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.src,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      };
    }).filter(i => (i.width > 80 || i.naturalWidth > 80) && i.src.includes('img-v2-prod.whop.com'));
  });

  console.log(`🔍 屏幕上找到真实行情大图: ${largeImages.length} 张`);

  if (largeImages.length === 0) {
    console.log('⚠️ 当前视口暂无大图，微调滚动条使其曝光...');
    await page.evaluate(() => window.scrollBy(0, 400));
    await new Promise(r => setTimeout(r, 2000));
  }

  // 重新获取
  const targetImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.src,
        width: rect.width,
        height: rect.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      };
    }).filter(i => (i.width > 80 || i.naturalWidth > 80) && i.src.includes('img-v2-prod.whop.com'));
  });

  console.log(`📸 目标大图列表 (共 ${targetImages.length} 张):`);
  targetImages.forEach((img, idx) => {
    console.log(`  [${idx+1}] 尺寸: ${img.naturalWidth}x${img.naturalHeight} (渲染: ${img.width.toFixed(0)}x${img.height.toFixed(0)})`);
    console.log(`      URL: ${img.src}`);
  });

  if (targetImages.length > 0) {
    const testImg = targetImages[0];
    console.log('\n========================================================================================');
    console.log(`🎯 开始对第 1 张大图执行单图实测下载与本地落盘验证:`);
    console.log(`🔗 URL: ${testImg.src}`);
    console.log('========================================================================================');

    // 发起带 User-Agent 的下载请求
    const res = await fetch(testImg.src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log(`📡 HTTP 响应状态码: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = computeSha256(buf);
      const testSavePath = 'data/media/zhao/test_ground_truth_single_image.png';
      
      fs.writeFileSync(testSavePath, buf);

      console.log('\n🎉 单图落地实测 100% 成功！');
      console.log(`  - 保存路径: ${testSavePath}`);
      console.log(`  - 真实字节: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`);
      console.log(`  - 文件 SHA256: ${sha}`);
      console.log(`  - 是否有效大图 (size > 1KB): ${buf.length > 1024 ? '✅ 校验通过 (真实有效行情图)' : '❌ 失败'}`);
    } else {
      console.log(`❌ 下载失败，HTTP 返回 ${res.status}`);
    }
  }

  await browser.disconnect();
}

testSingleImageGroundTruth().catch(console.error);
