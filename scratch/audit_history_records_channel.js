import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { getDb } from '../database.js';

const db = getDb();

async function auditRealHistoryChannel() {
  console.log('========================================================================================');
  console.log('🔍 1. 连接真实 Chrome 深度探查【历史股票期权记录区】(exp_JG1I58S5zTHbxs)');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  const targetUrl = 'https://whop.com/stock-and-option/exp_JG1I58S5zTHbxs/app/';
  console.log(`🚀 正在直达导航至真实【历史股票期权记录区】: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // 抓取该页面当前的真实标题、侧边栏信息和消息样本
  const liveInfo = await page.evaluate(() => {
    const title = document.title;
    const msgs = Array.from(document.querySelectorAll('div[class*="Message"], div[class*="ChatMessage"], article')).map(m => m.textContent.trim()).filter(Boolean);
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]')).map(a => ({
      text: a.textContent.trim().replace(/\s+/g, ' '),
      href: a.getAttribute('href')
    }));

    return {
      title,
      msgCount: msgs.length,
      sampleMsgs: msgs.slice(0, 5),
      sidebarLinks: links
    };
  });

  console.log(`📑 当前页面真实 Title: "${liveInfo.title}"`);
  console.log(`📋 页面已渲染消息数: ${liveInfo.msgCount}`);
  console.log('前 3 条消息内容样例:');
  liveInfo.sampleMsgs.slice(0, 3).forEach((m, i) => {
    console.log(`  [${i+1}] ${m.slice(0, 100).replace(/\n/g, ' ')}`);
  });

  console.log('\n========================================================================================');
  console.log('🔍 2. 数据库中所有频道的真实对应分析与消息量对比');
  console.log('========================================================================================\n');

  const dbChannels = db.prepare(`
    SELECT channel_id, COUNT(*) as count, MIN(created_at) as min_t, MAX(created_at) as max_t
    FROM messages
    GROUP BY channel_id
  `).all();

  for (const c of dbChannels) {
    const sample = db.prepare(`SELECT sender_name, content FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1`).get(c.channel_id);
    console.log(`📡 频道 ID: ${c.channel_id}`);
    console.log(`   总条数: ${c.count} 条 | 时间: ${new Date(c.min_t).toISOString().slice(0,10)} ~ ${new Date(c.max_t).toISOString().slice(0,10)}`);
    console.log(`   最新发言: [${sample?.sender_name}]: ${sample?.content.slice(0, 80).replace(/\n/g, ' ')}`);
    console.log('------------------------------------------------------------');
  }

  await browser.disconnect();
}

auditRealHistoryChannel().catch(console.error);
