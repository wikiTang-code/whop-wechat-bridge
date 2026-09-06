/**
 * @file test/test_news_freshness.js
 * @description T3: News 期望窗口纯函数单测（不依赖主库）
 */
import { evaluateNewsFreshness, isNewsMarketClosed } from '../monitoring/news-freshness.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`[AssertionFailed] ${msg}`);
}

/** 构造指定 Asia/Shanghai 墙钟的瞬时（用 UTC 偏移近似：CST=UTC+8） */
function bjInstant({ y, m, d, h, min = 0 }) {
  return Date.UTC(y, m - 1, d, h - 8, min, 0);
}

function run() {
  console.log('--- test_news_freshness ---');

  // 周日免检
  const sun = bjInstant({ y: 2026, m: 9, d: 6, h: 12 }); // Sun
  assert(isNewsMarketClosed(new Date(sun)) === true, 'Sunday closed');
  const sunEval = evaluateNewsFreshness({ latestNewsTs: null, nowMs: sun });
  assert(sunEval.status === 'ok' && sunEval.marketClosed, 'Sunday missing news ok');
  assert(sunEval.description.includes('休市空窗免检'), 'Sunday exemption text');

  // 周六 10:00 免检；周六 08:00 仍监控
  const satAm = bjInstant({ y: 2026, m: 9, d: 5, h: 8 }); // Sat
  const satPm = bjInstant({ y: 2026, m: 9, d: 5, h: 10 });
  assert(isNewsMarketClosed(new Date(satAm)) === false, 'Sat morning still monitored');
  assert(isNewsMarketClosed(new Date(satPm)) === true, 'Sat after 09:30 closed');
  const satAmMissing = evaluateNewsFreshness({ latestNewsTs: null, nowMs: satAm });
  assert(satAmMissing.status === 'warn', 'Sat morning missing → warn');

  // 周一 10:00：72h 内 ok
  const mon = bjInstant({ y: 2026, m: 9, d: 7, h: 10 });
  const friNews = mon - 48 * 3600 * 1000;
  const monOk = evaluateNewsFreshness({ latestNewsTs: friNews, nowMs: mon });
  assert(monOk.status === 'ok', 'Monday calm window ok');
  assert(String(monOk.description).includes('周一开盘前平稳期'), 'Monday calm text');

  // 周三 12:00：滞后 20h → warn
  const wed = bjInstant({ y: 2026, m: 9, d: 9, h: 12 });
  const stale = wed - 20 * 3600 * 1000;
  const wedWarn = evaluateNewsFreshness({ latestNewsTs: stale, nowMs: wed });
  assert(wedWarn.status === 'warn', 'weekday SLA warn');
  assert(String(wedWarn.description).includes('SLA'), 'SLA text');

  // 注入 override 休市
  const forced = evaluateNewsFreshness({
    latestNewsTs: null,
    nowMs: wed,
    isMarketClosed: true,
  });
  assert(forced.status === 'ok' && forced.marketClosed, 'override closed');

  console.log('🎉 ALL test_news_freshness PASSED\n');
}

run();
