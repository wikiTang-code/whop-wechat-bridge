/**
 * tools/knowledge/market_session.js
 * 美股市场交易时段与时区感知工具 (Market Session Awareness)
 *
 * 时区标准: America/New_York (自动适配夏令时 EDT 与冬令时 EST)
 * 时段定义 (全面覆盖 24H 美股工作日与夜盘):
 * - 周末休市 (Weekend Closed): 周五 20:00 ET 至 周日 20:00 ET
 * - 夜盘交易 (Overnight Trading): 20:00 - 次日 04:00 ET (含周日夜盘美东 20:00 开市)
 * - 盘前交易 (Pre-Market): 周一至周五 04:00 - 09:30 ET
 * - 常规交易 (Regular / RTH): 周一至周五 09:30 - 16:00 ET
 *   - 早盘回踩捡漏窗口 (Opening Dip): 09:30 - 10:30 ET (开盘剧烈博弈、急跌回踩捡漏窗口，15s高频)
 *   - 盘中常规观察时段: 10:30 - 15:00 ET (30s巡检)
 *   - 尾盘强平扫单窗口 (Power Hour): 15:00 - 16:00 ET (三点到四点机构强平扫盘与抢跑窗口，15s高频)
 * - 盘后交易 (After-Hours / Post-Market): 周一至周五 16:00 - 20:00 ET
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
  const timeNum = hour * 100 + minute; // 比如 9:30 -> 930, 15:35 -> 1535, 20:15 -> 2015

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
 * 判断当前美股市场状态 (全天候工作日+夜盘覆盖)
 */
export function getUsMarketSession(date = new Date()) {
  const et = getEasternTimeParts(date);

  // 1. 周六全天休市
  if (et.weekday === 6) {
    return {
      session: 'CLOSED_WEEKEND',
      isOpen: false,
      isRth: false,
      isPowerHour: false,
      isPreMarket: false,
      isPostMarket: false,
      isOvernight: false,
      description: `周末休市 (${et.weekdayName} ET ${et.timeStr})`,
      et,
    };
  }

  // 2. 周日白天休市；周日夜盘美东 20:00 起开市
  if (et.weekday === 0) {
    if (et.timeNum < 2000) {
      return {
        session: 'CLOSED_WEEKEND',
        isOpen: false,
        isRth: false,
        isPowerHour: false,
        isPreMarket: false,
        isPostMarket: false,
        isOvernight: false,
        description: `周末休市 (${et.weekdayName} ET ${et.timeStr}，美东20:00迎周日夜盘)`,
        et,
      };
    }
    // 周日 20:00 之后进入夜盘交易
    return {
      session: 'OVERNIGHT_TRADING',
      isOpen: true,
      isRth: false,
      isPowerHour: false,
      isPreMarket: false,
      isPostMarket: false,
      isOvernight: true,
      description: `周日夜盘开启交易时段 (${et.timeStr} ET)`,
      et,
    };
  }

  // 3. 周五夜间 20:00 之后进入周末休市
  if (et.weekday === 5 && et.timeNum >= 2000) {
    return {
      session: 'CLOSED_WEEKEND',
      isOpen: false,
      isRth: false,
      isPowerHour: false,
      isPreMarket: false,
      isPostMarket: false,
      isOvernight: false,
      description: `周末休市 (周五收市后 ET ${et.timeStr})`,
      et,
    };
  }

  // 4. 工作日 常规盘中时段 (09:30 - 16:00 ET)
  if (et.timeNum >= 930 && et.timeNum < 1600) {
    const isOpeningHour = et.timeNum >= 930 && et.timeNum < 1030; // 09:30 - 10:30 开盘回踩捡漏黄金窗口
    const isPowerHour = et.timeNum >= 1500;                       // 15:00 - 16:00 尾盘强平扫单黄金窗口 (三点到四点)
    let sessionName = 'REGULAR_TRADING';
    let desc = `常规盘中交易时段 (${et.timeStr} ET)`;

    if (isOpeningHour) {
      sessionName = 'REGULAR_OPENING_HOUR';
      desc = `常规盘中 · 早盘回踩捡漏黄金窗口 (${et.timeStr} ET)`;
    } else if (isPowerHour) {
      sessionName = 'REGULAR_POWER_HOUR';
      desc = `常规盘中 · 尾盘强平扫单黄金窗口 (${et.timeStr} ET)`;
    }

    return {
      session: sessionName,
      isOpen: true,
      isRth: true,
      isOpeningHour,
      isPowerHour,
      isPreMarket: false,
      isPostMarket: false,
      isOvernight: false,
      description: desc,
      et,
    };
  }

  // 5. 工作日 盘前交易时段 (04:00 - 09:30 ET)
  if (et.timeNum >= 400 && et.timeNum < 930) {
    return {
      session: 'PRE_MARKET',
      isOpen: true,
      isRth: false,
      isPowerHour: false,
      isPreMarket: true,
      isPostMarket: false,
      isOvernight: false,
      description: `盘前交易时段 (${et.timeStr} ET)`,
      et,
    };
  }

  // 6. 工作日 盘后交易时段 (16:00 - 20:00 ET)
  if (et.timeNum >= 1600 && et.timeNum < 2000) {
    return {
      session: 'POST_MARKET',
      isOpen: true,
      isRth: false,
      isPowerHour: false,
      isPreMarket: false,
      isPostMarket: true,
      isOvernight: false,
      description: `盘后交易时段 (${et.timeStr} ET)`,
      et,
    };
  }

  // 7. 工作日 夜盘交易时段 (20:00 - 24:00 或 00:00 - 04:00 ET)
  return {
    session: 'OVERNIGHT_TRADING',
    isOpen: true,
    isRth: false,
    isPowerHour: false,
    isPreMarket: false,
    isPostMarket: false,
    isOvernight: true,
    description: `夜盘交易时段 (${et.timeStr} ET)`,
    et,
  };
}

/**
 * 根据交易时段动态获取推荐感知轮询间隔 (毫秒)
 */
export function getRecommendedPollIntervalMs(session) {
  if (!session || !session.isOpen) {
    return 15 * 60 * 1000; // 休市时段 15 分钟
  }
  // 开盘首小时 (09:30-10:30 回踩抢筹) 与 尾盘半小时 (15:30-16:00 强平扫盘) 均为 15 秒极速高频
  if (session.isOpeningHour || session.isPowerHour) {
    return 15 * 1000;
  }
  if (session.isRth) {
    return 30 * 1000;      // 盘中常规 30 秒
  }
  if (session.isPreMarket || session.isPostMarket) {
    return 45 * 1000;      // 盘前盘后 45 秒
  }
  if (session.isOvernight) {
    return 60 * 1000;      // 夜盘交易 60 秒平稳
  }
  return 30 * 1000;
}

/**
 * 计算休市期间距离下一次可能开市时段的推荐休眠毫秒数
 */
export function getNextActiveWaitMs(date = new Date(), options = { preMarketActive: true }) {
  const session = getUsMarketSession(date);
  if (session.isOpen) return 0; // 已经在开市交易时段

  // 若为周末休市，推荐休眠 15 分钟后重新感知
  return 15 * 60 * 1000;
}
