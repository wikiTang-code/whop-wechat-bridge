import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

async function capture() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log('Listening to exact network requests on page:', await page.title());

  let captured = false;
  page.on('request', req => {
    const url = req.url();
    if (url.includes('graphql') || url.includes('api.whop.com') || url.includes('/api/')) {
      if (!captured && req.method() === 'POST') {
        captured = true;
        console.log('\n🎯 [Captured Real API Request]:');
        console.log('URL:', url);
        console.log('Headers:', JSON.stringify(req.headers(), null, 2));
        console.log('PostData:', req.postData()?.slice(0, 300));
      }
    }
  });

  // 在页面内触发一次向下/向上微滚
  await page.evaluate(() => {
    window.scrollBy(0, 300);
  });

  await new Promise(r => setTimeout(r, 6000));
  await browser.disconnect();
}

capture().catch(console.error);
