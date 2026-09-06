/**
 * @file monitoring/news-freshness.js
 * @description T3: 交易日 News 期望窗口判定（北京时间 SLA；禁止全天 isOffMarketHours 豁免）
 */
import {
  getBeijingTimeParts,
  getEasternTimeParts,
  US_MARKET_HOLIDAYS_2026,
} from './market-calendar.js';

/**
 * News 是否处于「休市空窗免检」
 * - 周日全天、法定节假日（美东日）、周六北京 09:30 之后 → 免
 * - 周六北京 09:30 之前仍监控周五收盘回顾 SLA
 */
export function isNewsMarketClosed(date = new Date(), override = null) {
  if (typeof override === 'boolean') return override;

  const et = getEasternTimeParts(date);
  if (US_MARKET_HOLIDAYS_2026.has(et.etDateStr)) return true;

  const bj = getBeijingTimeParts(date);
  if (bj.weekday === 'Sun') return true;
  if (bj.weekday === 'Sat' && bj.minutesOfDay >= 9 * 60 + 30) return true;
  return false;
}

/**
 * @returns {{ status: 'ok'|'warn', marketClosed: boolean, description: string, lagHours: number|null, maxAllowedLagHours: number|null }}
 */
export function evaluateNewsFreshness({
  latestNewsTs = null,
  nowMs = Date.now(),
  isMarketClosed = null,
} = {}) {
  const now = new Date(nowMs);
  const marketClosed = isNewsMarketClosed(now, isMarketClosed);
  const lagHours = latestNewsTs != null
    ? Math.round(((nowMs - Number(latestNewsTs)) / (1000 * 3600)) * 10) / 10
    : null;

  if (marketClosed) {
    return {
      status: 'ok',
      marketClosed: true,
      lagHours,
      maxAllowedLagHours: null,
      description: latestNewsTs
        ? `已滞后 ${lagHours} 小时（休市空窗免检）`
        : '休市空窗免检（未生成）',
    };
  }

  if (latestNewsTs == null) {
    return {
      status: 'warn',
      marketClosed: false,
      lagHours: null,
      maxAllowedLagHours: null,
      description: '未生成（交易日缺失资讯报告）',
    };
  }

  const bj = getBeijingTimeParts(now);

  // 周一 18:00 前：容忍上周五/六产物（至多 72h）
  if (bj.weekday === 'Mon' && bj.hour < 18) {
    if (lagHours <= 72) {
      return {
        status: 'ok',
        marketClosed: false,
        lagHours,
        maxAllowedLagHours: 72,
        description: `已滞后 ${lagHours} 小时（周一开盘前平稳期）`,
      };
    }
    return {
      status: 'warn',
      marketClosed: false,
      lagHours,
      maxAllowedLagHours: 72,
      description: `已滞后 ${lagHours} 小时（超出周一平稳期 72h）`,
    };
  }

  // 北京时间动态 SLA（对齐 Auto News 触发点）
  // 00:00–02:00 过渡；02:00 后应有盘中；09:00 后应有收盘；18:00 后应有盘前
  let maxAllowedLagHours = 14;
  if (bj.minutesOfDay >= 18 * 60) maxAllowedLagHours = 9;
  else if (bj.minutesOfDay >= 9 * 60) maxAllowedLagHours = 11;
  else if (bj.minutesOfDay >= 2 * 60) maxAllowedLagHours = 10;
  else maxAllowedLagHours = 14;

  if (lagHours > maxAllowedLagHours) {
    return {
      status: 'warn',
      marketClosed: false,
      lagHours,
      maxAllowedLagHours,
      description: `已滞后 ${lagHours} 小时（超出时段 SLA 阈值 ${maxAllowedLagHours}h）`,
    };
  }

  return {
    status: 'ok',
    marketClosed: false,
    lagHours,
    maxAllowedLagHours,
    description: `已滞后 ${lagHours} 小时（正常窗口内）`,
  };
}
