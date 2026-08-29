import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

async function snap() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log('Capturing current live page screenshot:', await page.title());
  await page.screenshot({ path: 'data/media/zhao/live_broadcast_current.png' });
  console.log('Saved to data/media/zhao/live_broadcast_current.png');

  // 获取页面上所有的图片元素和背景图
  const imgDetails = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src,
      alt: i.alt,
      width: i.width,
      height: i.height
    }));
  });

  console.log('Total img elements on screen:', imgDetails.length);
  imgDetails.forEach((d, i) => {
    if (d.src.includes('whop.com')) console.log(`  [${i+1}] ${d.src.slice(0, 100)}...`);
  });

  await browser.disconnect();
}

snap().catch(console.error);
