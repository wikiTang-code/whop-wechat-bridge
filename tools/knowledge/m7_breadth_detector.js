/**
 * tools/knowledge/m7_breadth_detector.js
 * 赵哥核心战法：美股科技「七姐妹」(M7) 开盘广度与单边下跌模式探测器
 *
 * 经典战法出处 (赵哥历史原单 post_1CVX4DWL2PiXoXG51a4vES):
 * 「回调段就是 盘前把夜盘涨幅吃掉 盘中每隔半小时七姐妹价格一直跌 单边下跌到尾盘 收盘买股票 夜盘量化反弹出」
 *
 * 核心逻辑:
 * 1. 监控美股科技巨头七姐妹: NVDA, TSLA, AAPL, MSFT, GOOGL, AMZN, META;
 * 2. 在开盘首小时 (09:30 - 10:30 ET) 计算七姐妹下跌比例 (down_count / 7);
 * 3. 若七姐妹普遍下跌 (>= 5 支飘绿)，判定为 UNILATERAL_DOWNTREND (单边下跌模式);
 * 4. 战法指导: 早盘严禁盲目接飞刀，做多策略推迟至尾盘 (15:00 - 16:00 尾盘强平扫单时段) 再买，夜盘量化反弹出。
 */

export const MAGNIFICENT_SEVEN = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'];

export const ZHAO_M7_PLAYBOOK_EVIDENCE = {
  post_id: 'post_1CVX4DWL2PiXoXG51a4vES',
  speaker: 'xiaozhaolucky',
  original_quote: '回调段就是 盘前把夜盘涨幅吃掉 盘中每隔半小时七姐妹价格一直跌 单边下跌到尾盘 收盘买股票 夜盘量化反弹出',
};

/**
 * 评估七姐妹盘面广度与单边下跌模式
 * @param {Array|Map} quotes - 标的行情列表或 Map
 * @param {object} options - { marketSession, thresholdCount }
 * @returns {object} - M7 广度分析结果与战法指引
 */
export function evaluateM7Breadth(quotes, options = {}) {
  const quoteMap = quotes instanceof Map ? quotes : new Map();
  if (Array.isArray(quotes)) {
    for (const q of quotes) {
      if (q && q.ticker) {
        quoteMap.set(q.ticker.toUpperCase(), q);
      }
    }
  }

  const thresholdCount = options.thresholdCount || 5; // 7 支中有 5 支及以上下跌触发
  const items = [];
  let downCount = 0;
  let upCount = 0;
  let totalChg = 0;
  let counted = 0;

  for (const ticker of MAGNIFICENT_SEVEN) {
    const q = quoteMap.get(ticker);
    if (!q) {
      items.push({ ticker, status: 'MISSING', change_pct: 0, last_price: null });
      continue;
    }

    const last = Number(q.last_price || q.lastDone || 0);
    const prev = Number(q.prev_close || q.prevClose || 0);
    let chgPct = 0;
    if (typeof q.change_pct === 'number') {
      chgPct = q.change_pct;
    } else if (prev > 0) {
      chgPct = ((last - prev) / prev) * 100;
    }

    const isDown = chgPct < 0;
    if (isDown) downCount += 1;
    else upCount += 1;

    totalChg += chgPct;
    counted += 1;

    items.push({
      ticker,
      status: isDown ? 'DOWN' : 'UP',
      change_pct: parseFloat(chgPct.toFixed(2)),
      last_price: last,
    });
  }

  const avgChangePct = counted > 0 ? parseFloat((totalChg / counted).toFixed(2)) : 0;
  const isOpeningHour = options.marketSession?.isOpeningHour ?? true;
  const isPowerHour = options.marketSession?.isPowerHour ?? false;

  // 判定是否触发单边下跌形态
  const isUnilateralDowntrend = downCount >= thresholdCount;

  let playbookAdvice = null;
  if (isUnilateralDowntrend) {
    if (isPowerHour) {
      playbookAdvice = '⏱️【尾盘黄金买点触发】已单边下跌至美东 15:00~16:00 尾盘强平时段，符合赵哥战法“收盘买/捡漏，夜盘量化反弹出”！';
    } else if (isOpeningHour) {
      playbookAdvice = `🚨【赵哥战法警示 · 开盘首小时七姐妹普跌 (${downCount}/7)】触发单边下跌模式！盘中大概率每半小时持续走弱，早盘严禁接飞刀，耐住性子推迟至尾盘三点强平时段再买！`;
    } else {
      playbookAdvice = `⚠️【单边下跌模式延续中 (${downCount}/7 飘绿)】全天单边压制未解除，严禁过早加仓，等待尾盘 15:00~16:00 强平窗口。`;
    }
  }

  return {
    regime: isUnilateralDowntrend ? 'UNILATERAL_DOWNTREND' : (upCount >= thresholdCount ? 'TECH_RALLY' : 'BALANCED'),
    is_unilateral_downtrend: isUnilateralDowntrend,
    down_count: downCount,
    up_count: upCount,
    total_tracked: counted,
    avg_change_pct: avgChangePct,
    items,
    playbook_advice: playbookAdvice,
    evidence: ZHAO_M7_PLAYBOOK_EVIDENCE,
  };
}
