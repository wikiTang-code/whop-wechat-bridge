/**
 * @file monitoring/market-calendar.js
 * @description 美股交易日历与休市时段感知模块 (含周末与美股法定节假日)
 */

// 2026 美股官方休市法定节假日 (按美东 ET 日期 YYYY-MM-DD 索引)
export const US_MARKET_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King, Jr. Day
  '2026-02-16', // Washington's Birthday (Presidents' Day)
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth National Independence Day
  '2026-07-03', // Independence Day (Observed, since July 4 is Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
]);

/**
 * 获取当前美东时间 (ET) 的年月日与时分信息
 */
export function getEasternTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });

  const parts = {};
  for (const p of formatter.formatToParts(date)) {
    parts[p.type] = p.value;
  }

  const etDateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = (parseInt(parts.hour, 10) || 0) % 24;
  const minute = parseInt(parts.minute, 10) || 0;
  const weekday = parts.weekday; // Sun, Mon, Tue, Wed, Thu, Fri, Sat

  return {
    etDateStr,
    weekday,
    hour,
    minute,
  };
}

/**
 * 获取当前北京时间 (Asia/Shanghai) 的年月日与时分信息
 */
export function getBeijingTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });

  const parts = {};
  for (const p of formatter.formatToParts(date)) {
    parts[p.type] = p.value;
  }

  const hour = (parseInt(parts.hour, 10) || 0) % 24;
  const minute = parseInt(parts.minute, 10) || 0;

  return {
    bjDateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday, // Sun, Mon, ...
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * 判断当前是否处于周末或美股法定节假日休市时段
 */
export function isWeekendOrHoliday(date = new Date()) {
  const { etDateStr, weekday } = getEasternTimeParts(date);

  // 1. 周六与周日全天休市
  if (weekday === 'Sat' || weekday === 'Sun') {
    return true;
  }

  // 2. 美股法定节假日全天休市
  if (US_MARKET_HOLIDAYS_2026.has(etDateStr)) {
    return true;
  }

  return false;
}

/**
 * 判断当前是否处于非主盘交易时段 (即常规盘 09:30-16:00 ET 之外，包含夜盘、周末和节假日)
 * 可作为离线大模型批处理与战法手册生成的静默黄金窗口
 */
export function isOffMarketHours(date = new Date()) {
  if (isWeekendOrHoliday(date)) {
    return true;
  }

  const { hour, minute } = getEasternTimeParts(date);
  const timeInMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 09:30 ET
  const marketClose = 16 * 60;    // 16:00 ET

  // 常规交易时间外均属于静默离线处理窗口
  return timeInMinutes < marketOpen || timeInMinutes >= marketClose;
}
