import { getDb } from './database.js';

/**
 * 从 Yahoo Finance 获取特定时间戳附近的指数收盘价与涨跌幅
 * @param {string} ticker - 'SPY' | '^VIX'
 * @param {number} timestampMs - Unix 毫秒时间戳
 */
export async function fetchIndexPriceForDate(ticker, timestampMs) {
  const symbol = ticker.toUpperCase();
  // 取时间戳前后的 3 天窗口，防止遇到周末/闭市日
  const startSec = Math.floor(timestampMs / 1000) - 86400 * 3;
  const endSec = Math.floor(timestampMs / 1000) + 86400 * 3;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startSec}&period2=${endSec}&interval=1d`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status}`);
    }

    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const opens = quote.open || [];

    // 寻找距离目标时间戳最近的交易日
    let minDiff = Infinity;
    let closestIdx = -1;

    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] === null || closes[i] === undefined) continue;
      const diff = Math.abs(timestamps[i] * 1000 - timestampMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    if (closestIdx !== -1) {
      const close = closes[closestIdx];
      
      let changePercent = 0;
      // 优先采用 Close-to-Close（收盘对前收盘）标准，以捕获由于盘前经济指标（如 CPI 8:30 AM）公布带来的跳空高开/低开
      if (closestIdx > 0 && closes[closestIdx - 1] !== null && closes[closestIdx - 1] !== undefined) {
        const prevClose = closes[closestIdx - 1];
        changePercent = prevClose ? ((close - prevClose) / prevClose * 100) : 0;
      } else {
        const open = opens[closestIdx] || close; // 防御空开盘价
        changePercent = open ? ((close - open) / open * 100) : 0;
      }

      return {
        price: close,
        changePercent,
        timestamp: timestamps[closestIdx] * 1000
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[Market Data] 抓取指数 ${symbol} 行情失败:`, err.message);
  }
  return null;
}

/**
 * 向数据库注册一个宏观经济事件，并自动匹配行情表现
 */
export async function addMacroEvent({ eventTimestamp, dateStr, eventType, eventName, description, actualValue = '', expectedValue = '', source = 'auto' }) {
  const db = getDb();

  // 1. 检查是否已经存在同名同时间事件
  const existing = db.prepare(`
    SELECT id FROM macro_events 
    WHERE event_name = ? AND date_str = ?
  `).get(eventName, dateStr);

  if (existing) {
    return existing.id;
  }

  console.log(`[Market Data] 正在为事件 [${eventName}] 匹配 SPY/VIX 市场行情 (日期: ${dateStr})...`);
  
  // 2. 爬取行情
  const spyData = await fetchIndexPriceForDate('SPY', eventTimestamp);
  const vixData = await fetchIndexPriceForDate('^VIX', eventTimestamp);

  const spyChange = spyData ? parseFloat(spyData.changePercent.toFixed(2)) : null;
  const vixClose = vixData ? parseFloat(vixData.price.toFixed(2)) : null;

  // 3. 判定市场 regime
  let regime = 'VOLATILE';
  if (spyChange !== null) {
    if (spyChange > 0.4) regime = 'BULLISH';
    else if (spyChange < -0.4) regime = 'BEARISH';
  }

  // 4. 插入数据库
  const stmt = db.prepare(`
    INSERT INTO macro_events (event_timestamp, date_str, event_type, event_name, description, actual_value, expected_value, market_regime, spy_change, vix_close, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    eventTimestamp,
    dateStr,
    eventType,
    eventName,
    description,
    actualValue,
    expectedValue,
    regime,
    spyChange,
    vixClose,
    source
  );

  console.log(`[Market Data] 宏观事件 [${eventName}] 已成功存入数据库。SPY: ${spyChange !== null ? spyChange + '%' : 'N/A'}, VIX: ${vixClose || 'N/A'}`);
  return info.lastInsertRowid;
}

/**
 * 种子数据：静默预分配 2026 年主要宏观事件表 (FOMC 与 CPI)
 */
export async function seed2026MacroEvents() {
  const events = [
    // FOMC 会议时间 (美东 14:00 发布决议，冬令时为 UTC 19:00, 夏令时为 UTC 18:00)
    {
      dateStr: '2026-01-28',
      eventTimestamp: new Date('2026-01-28T14:00:00-05:00').getTime(),
      eventType: 'FOMC',
      eventName: 'FOMC 利率决议 (1月)',
      description: '美联储2026年第一次议息会议利率决议',
      expectedValue: '不变'
    },
    {
      dateStr: '2026-03-18',
      eventTimestamp: new Date('2026-03-18T14:00:00-04:00').getTime(),
      eventType: 'FOMC',
      eventName: 'FOMC 利率决议 (3月)',
      description: '美联储3月议息会议利率决议与经济预测摘要',
      expectedValue: '-25BP'
    },
    {
      dateStr: '2026-05-06',
      eventTimestamp: new Date('2026-05-06T14:00:00-04:00').getTime(),
      eventType: 'FOMC',
      eventName: 'FOMC 利率决议 (5月)',
      description: '美联储5月议息会议利率决议',
      expectedValue: '不变'
    },
    {
      dateStr: '2026-06-17',
      eventTimestamp: new Date('2026-06-17T14:00:00-04:00').getTime(),
      eventType: 'FOMC',
      eventName: 'FOMC 利率决议 (6月)',
      description: '美联储6月议息会议利率决议与点阵图更新',
      expectedValue: '-25BP'
    },

    // CPI 公布时间 (美东 08:30 分公布，冬令时为 UTC 13:30, 夏令时为 UTC 12:30)
    {
      dateStr: '2026-01-13',
      eventTimestamp: new Date('2026-01-13T08:30:00-05:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 12 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '3.0%'
    },
    {
      dateStr: '2026-02-11',
      eventTimestamp: new Date('2026-02-11T08:30:00-05:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 1 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '2.9%'
    },
    {
      dateStr: '2026-03-11',
      eventTimestamp: new Date('2026-03-11T08:30:00-04:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 2 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '2.8%'
    },
    {
      dateStr: '2026-04-10',
      eventTimestamp: new Date('2026-04-10T08:30:00-04:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 3 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '2.8%'
    },
    {
      dateStr: '2026-05-13',
      eventTimestamp: new Date('2026-05-13T08:30:00-04:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 4 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '2.7%'
    },
    {
      dateStr: '2026-06-10',
      eventTimestamp: new Date('2026-06-10T08:30:00-04:00').getTime(),
      eventType: 'CPI',
      eventName: '美国 5 月 CPI 通胀数据',
      description: '美国劳工部公布消费者物价指数',
      expectedValue: '2.6%'
    }
  ];

  console.log('[Market Data] 正在预分配 2026 种子宏观事件列表...');
  for (const ev of events) {
    try {
      await addMacroEvent(ev);
    } catch (err) {
      console.error(`[Market Data] 种子事件 [${ev.eventName}] 分配失败:`, err.message);
    }
  }
}
