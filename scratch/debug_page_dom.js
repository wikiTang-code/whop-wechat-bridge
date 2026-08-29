import fs from 'fs';
import dotenv from 'dotenv';
import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
dotenv.config();

async function debug() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

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

  console.log('Navigating to Whop app page...');
  await page.goto('https://whop.com/stock-and-option/exp_9vfxZgBNgXykNt/app/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 4000));

  // 截取当前页面截图
  await page.screenshot({ path: 'data/media/zhao/debug_page_view.png' });
  console.log('Saved screenshot to data/media/zhao/debug_page_view.png');

  // 获取页面上所有的可点击频道按钮和文字
  const channelElements = await page.evaluate(() => {
    const nodes = document.querySelectorAll('a, button, [role="button"], span');
    const items = [];
    nodes.forEach(n => {
      const txt = (n.innerText || '').trim();
      if (txt && (txt.includes('讨论') || txt.includes('发布') || txt.includes('期权') || txt.includes('记录'))) {
        items.push({ tag: n.tagName, text: txt, href: n.href || null });
      }
    });
    return items;
  });

  console.log('Detected channel elements on page:', JSON.stringify(channelElements, null, 2));

  await browser.close();
}

debug().catch(console.error);
