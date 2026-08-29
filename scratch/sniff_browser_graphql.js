import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

async function sniff() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log('Listening to network traffic on page:', await page.title());

  page.on('request', req => {
    const u = req.url();
    if (u.includes('graphql') || u.includes('messages') || u.includes('posts')) {
      console.log('📡 [Request Captured]:', req.method(), u);
      try {
        console.log('   Data:', req.postData()?.slice(0, 200));
      } catch (e) {}
    }
  });

  // 在页面内触发一次向下滚动
  await page.evaluate(() => {
    window.scrollBy(0, 500);
  });

  await new Promise(r => setTimeout(r, 6000));
  await browser.disconnect();
}

sniff().catch(console.error);
