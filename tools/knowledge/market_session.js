/**
 * tools/knowledge/market_session.js
 * 美股市场交易时段与时区感知工具 (Market Session Awareness)
 *
 * 时区标准: America/New_York (自动适配夏令时 EDT 与冬令时 EST)
 * 时段定义:
 * - 周末 (周六、周日): CLOSED_WEEKEND
 * - 盘前交易 (Pre-Market): 周一至周五 04:00 - 09:30 ET
 * - 常规交易 (Regular / RTH): 周一至周五 09:30 - 16:00 ET
 *   - 黄金强平窗口 (Power Hour): 15:30 - 16:00 ET (赵哥核心低吸/大单扫盘窗口)
 * - 盘后交易 (After-Hours): 周一至周五 16:00 - 20:00 ET
 * - 夜间休市 (Overnight Closed): 20:00 - 次日 04:00 ET
 */

export function getEasternTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[map.weekday] ?? 0;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const second = parseInt(map.second, 10);
  const timeNum = hour * 100 + minute; // 比如 9:30 -> 930, 15:35 -> 1535

  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    weekday,
    weekdayName: map.weekday,
    hour,
    minute,
    second,
    timeNum,
    timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
  };
}

/**
 * 判断当前美股市场状态
 */
export function getUsMarketSession(date = new Date()) {
  const et = getEasternTimeParts(date);

  // 周末判断
  if (et.weekday === 0 || et.weekday === 6) {
    return {
      session: 'CLOSED_WEEKEND',
      isOpen: false,
      isRth: false,
      isPowerHour: false,
      description: `周末休市 (${et.weekdayName} ET ${et.timeStr})`,
      et,
    };
  }

  // 工作日判定 (周一至周五)
  if (et.timeNum >= 930 && et.timeNum < 1600) {
    const isPowerHour = et.timeNum >= 1530;
    return {
      session: isPowerHour ? 'REGULAR_POWER_HOUR' : 'REGULAR_TRADING',
      isOpen: true,
      isRth: true,
      isPowerHour,
      description: isPowerHour
        ? `常规盘中 · 尾盘强平扫单黄金窗口 (${et.timeStr} ET)`
        : `常规盘中交易时段 (${et.timeStr} ET)`,
      et,
    };
  }

  if (et.timeNum >= 400 && et.timeNum < 930) {
    return {
      session: 'PRE_MARKET',
      isOpen: true,
      isRth: false,
      isPowerHour: false,
      description: `盘前时段 (${et.timeStr} ET)`,
      et,
    };
  }

  if (et.timeNum >= 1600 && et.timeNum < 2000) {
    return {
      session: 'POST_MARKET',
      isOpen: true,
      isRth: false,
      isPowerHour: false,
      description: `盘后时段 (${et.timeStr} ET)`,
      et,
    };
  }

  return {
    session: 'CLOSED_OVERNIGHT',
    isOpen: false,
    isRth: false,
    isPowerHour: false,
    description: `夜间休市 (${et.timeStr} ET)`,
    et,
  };
}

/**
 * 计算休市期间距离下一次可能开盘时段（通常是 04:00 盘前或 09:30 开盘）的推荐休眠毫秒数
 */
export function getNextActiveWaitMs(date = new Date(), options = { preMarketActive: true }) {
  const session = getUsMarketSession(date);
  if (session.isOpen) return 0; // 已经在开市交易时段

  const et = session.et;
  const targetHour = options.preMarketActive ? 4 : 9;
  const targetMin = options.preMarketActive ? 0 : 30;

  // 默认休眠兜底：若夜间休市休眠 10 分钟重测；周末休眠 30 分钟重测
  if (session.session === 'CLOSED_WEEKEND') {
    return 30 * 60 * 1000; // 30 分钟
  }
  return 10 * 60 * 1000; // 10 分钟
}
