import puppeteer from '../scripts/discovery/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

async function testPhysicalWheel() {
  console.log('========================================================================================');
  console.log('🧪 正在测试底层原生物理鼠标滚轮与坐标精准注入...');
  console.log('========================================================================================\n');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('whop.com')) || pages[0];

  console.log(`📑 锁定浏览器标签页: "${await page.title()}"`);

  // 1. 查找并高亮显示当前页面上真正的聊天消息容器
  const containerInfo = await page.evaluate(() => {
    // 寻找带有滚动条的容器
    const allDivs = Array.from(document.querySelectorAll('div, main, section, ul'));
    let bestContainer = null;
    let maxArea = 0;

    allDivs.forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll' || el.scrollHeight > el.clientHeight + 50);
      
      if (isScrollable && rect.width > 300 && rect.height > 300) {
        const area = rect.width * rect.height;
        if (area > maxArea) {
          maxArea = area;
          bestContainer = el;
        }
      }
    });

    if (!bestContainer) {
      bestContainer = document.querySelector('.fui-ScrollAreaViewport') || document.body;
    }

    // 给真正找到的容器加上醒目的红色闪烁边框，让用户在屏幕上 100% 亲眼看到
    bestContainer.style.outline = '4px solid #ef4444';
    bestContainer.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.8)';
    
    // 在屏幕正中央放一个醒目的黄色大徽章
    let badge = document.getElementById('antigravity-active-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'antigravity-active-badge';
      badge.style.position = 'fixed';
      badge.style.top = '10px';
      badge.style.left = '50%';
      badge.style.transform = 'translateX(-50%)';
      badge.style.zIndex = '999999';
      badge.style.background = '#facc15';
      badge.style.color = '#000000';
      badge.style.fontWeight = '900';
      badge.style.padding = '12px 24px';
      badge.style.borderRadius = '30px';
      badge.style.fontSize = '16px';
      badge.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
      document.body.appendChild(badge);
    }
    badge.innerHTML = '⚡ Antigravity 物理滚轮操控中...';

    const rect = bestContainer.getBoundingClientRect();
    return {
      tagName: bestContainer.tagName,
      className: bestContainer.className,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      scrollTopBefore: bestContainer.scrollTop,
      scrollHeight: bestContainer.scrollHeight,
      clientHeight: bestContainer.clientHeight
    };
  });

  console.log('🎯 精准定位到的聊天滚动容器:', JSON.stringify(containerInfo, null, 2));

  // 2. 通过 Chrome 原生 CDP 发送 10 次真实的物理鼠标滚轮事件
  const client = await page.target().createCDPSession();
  const centerX = containerInfo.rect.x + containerInfo.rect.width / 2;
  const centerY = containerInfo.rect.y + containerInfo.rect.height / 2;

  console.log(`🖱️ 正在向坐标 (${centerX}, ${centerY}) 发送真实的物理鼠标滚轮向下/向上事件...`);

  for (let i = 1; i <= 10; i++) {
    // 发送鼠标滚轮
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: centerX,
      y: centerY,
      deltaX: 0,
      deltaY: -500 // 向上滚动
    });

    await new Promise(r => setTimeout(r, 400));
  }

  // 3. 检查滚动后的真实数值变化
  const afterInfo = await page.evaluate(() => {
    const el = document.querySelector('[style*="outline: 4px solid"]') || document.body;
    return {
      scrollTopAfter: el.scrollTop,
      scrollHeight: el.scrollHeight
    };
  });

  console.log('\n📊 物理滚轮实测结果:');
  console.log(`  - 滚动前 scrollTop: ${containerInfo.scrollTopBefore}`);
  console.log(`  - 滚动后 scrollTop: ${afterInfo.scrollTopAfter}`);
  console.log(`  - 容器总高度 scrollHeight: ${afterInfo.scrollHeight}`);

  await browser.disconnect();
}

testPhysicalWheel().catch(console.error);
