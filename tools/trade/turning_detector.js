/**
 * tools/trade/turning_detector.js
 * 
 * [微观形态特征引擎 · turning_v1]
 * 
 * 核心定位 (遵守专业审阅意见):
 * 1. 纯特征检测器 (Feature Detector)，只负责输出结构化事件与上下文证据 (Evidence)，
 *    严禁越权直接触发下单或硬拦截！
 * 2. 彻底区分: 形态确认特征 (Turning Event) vs 执行安全 (Risk Guards) vs 仓位管理 (Position Heuristics);
 * 3. 严格因果时间戳 (t <= t_anchor)，杜绝任何未来函数;
 * 4. 大盘指数 (QQQ / SPX) 作为上下文对照，不搞单方面硬锁。
 */

export const TURNING_DETECTOR_VERSION = 'turning_v1';

export const TurningEventType = {
  SPIKE_TURN_DOWN: 'spike_turn_down',   // 异动直线拉升后见顶转弯回落 (卖出/减仓候选)
  PLUNGE_TURN_UP: 'plunge_turn_up'      // 急跌跳水后探底转弯企稳拉起 (买入/低吸候选)
};

export const TurningSourceType = {
  ZHAO_QUOTE: 'zhao_quote',             // 来自大V口播/原话明确提及
  AUDITED_FILL: 'audited_fill',         // 来自人工已审核成交前后路径
  DETECTED_ONLY: 'detected_only'        // 算法在历史/实时行情中自动检测
};

/**
 * TurningEvent 标准结构工厂
 * @param {Object} params
 * @returns {Object} 符合规范的 TurningEvent 对象
 */
export function createTurningEvent({
  type,
  symbol,
  tAnchor,
  pathWindow = [],
  impulse = {},
  confirm = {},
  indexContext = {},
  source = TurningSourceType.DETECTED_ONLY,
  evidenceNotes = []
}) {
  return {
    version: TURNING_DETECTOR_VERSION,
    type,
    symbol: String(symbol).toUpperCase(),
    t_anchor: tAnchor || Date.now(),
    path_window: pathWindow, // [t0 - L, t0 + H]
    impulse: {
      ret: impulse.ret || 0,                 // 冲动段涨跌幅 (如 +0.052 代表 +5.2%)
      duration_bars: impulse.duration_bars || 0,
      extreme_price: impulse.extreme_price || 0, // 脉冲最高价或跳水最低价
      ...impulse
    },
    confirm: {
      retrace_from_extreme: confirm.retrace_from_extreme || 0, // 自极值点回撤/反抽幅度
      bars_after_extreme: confirm.bars_after_extreme || 0,
      structure: confirm.structure || 'unknown',               // 'lower_high' | 'higher_low' | 'rebound_hook'
      is_confirmed: Boolean(confirm.is_confirmed),
      ...confirm
    },
    index_context: {
      qqq_ret: indexContext.qqq_ret ?? null,
      qqq_turn_lag_minutes: indexContext.qqq_turn_lag_minutes ?? null,
      spx_ret: indexContext.spx_ret ?? null,
      ...indexContext
    },
    source,
    evidence_notes: evidenceNotes,
    created_at: Date.now()
  };
}

/**
 * 候选算法 A: 检测「异动直线拉升后见顶转弯回落」 (Spike -> Peak -> Turn Down)
 * 语义: 不是涨到固定百分比就卖，而是冲高过程中挂「高点回落 X」类移动触发语义
 * 
 * @param {Array<{open: number, high: number, low: number, close: number, time?: number}>} bars 连续分时K线
 * @param {Object} [options]
 * @param {number} [options.minSpikeRatio=0.035] 脉冲拉升门槛 (默认 +3.5%)
 * @param {number} [options.minRetraceRatio=0.008] 见顶回落触发门槛 (默认 -0.8% ~ -1.5%)
 * @param {Object} [options.indexBars] 对应时刻的 QQQ 分时 K 线 (可选)
 * @returns {Object} { detected: boolean, event: TurningEvent|null }
 */
export function detectSpikeTurnDown(bars, {
  minSpikeRatio = 0.035,
  minRetraceRatio = 0.008,
  indexBars = null,
  symbol = 'UNKNOWN',
  source = TurningSourceType.DETECTED_ONLY
} = {}) {
  if (!Array.isArray(bars) || bars.length < 3) {
    return { detected: false, event: null };
  }

  // 严格因果: 只分析传入切片，不偷看未来
  const highestIndex = bars.reduce((maxI, b, i, arr) => b.high > arr[maxI].high ? i : maxI, 0);
  const peakBar = bars[highestIndex];
  const startBar = bars[0];

  const spikeRatio = (peakBar.high - startBar.open) / startBar.open;
  const latestBar = bars[bars.length - 1];
  const dropFromPeak = (peakBar.high - latestBar.close) / peakBar.high;
  const barsAfterPeak = bars.length - 1 - highestIndex;

  // 判定条件: 冲动段涨幅达标，且出现自最高点回撤确认 (且最新收盘低于峰值)
  const isSpike = spikeRatio >= minSpikeRatio;
  const isConfirmed = dropFromPeak >= minRetraceRatio && latestBar.close < peakBar.close && barsAfterPeak >= 1;

  if (!isSpike || !isConfirmed) {
    return { detected: false, event: null };
  }

  // 大盘 QQQ 指数上下文提取
  const indexContext = {};
  if (Array.isArray(indexBars) && indexBars.length >= 2) {
    const qStart = indexBars[0].open;
    const qEnd = indexBars[indexBars.length - 1].close;
    indexContext.qqq_ret = Number(((qEnd - qStart) / qStart).toFixed(4));
  }

  const event = createTurningEvent({
    type: TurningEventType.SPIKE_TURN_DOWN,
    symbol,
    tAnchor: latestBar.time || Date.now(),
    pathWindow: [startBar.time, latestBar.time],
    impulse: {
      ret: Number(spikeRatio.toFixed(4)),
      duration_bars: highestIndex + 1,
      extreme_price: peakBar.high
    },
    confirm: {
      retrace_from_extreme: Number(dropFromPeak.toFixed(4)),
      bars_after_extreme: barsAfterPeak,
      structure: latestBar.high < peakBar.high ? 'lower_high' : 'peak_pullback',
      is_confirmed: true
    },
    indexContext,
    source,
    evidenceNotes: [
      `冲动段短线脉冲 +${(spikeRatio * 100).toFixed(1)}% (峰值 $${peakBar.high})`,
      `自峰值回撤 ${(dropFromPeak * 100).toFixed(1)}% (经 ${barsAfterPeak} 根 bar 确认拐头向下)`,
      `大盘 QQQ 对应走势: ${indexContext.qqq_ret ? (indexContext.qqq_ret * 100).toFixed(2) + '%' : '无数据'}`
    ]
  });

  return {
    detected: true,
    event
  };
}

/**
 * 候选算法 B: 检测「急跌跳水后探底转弯企稳拉起」 (Plunge -> Trough -> Turn Up)
 * 语义: 不是徒手接飞刀，而是急跌后出现止跌/反抽确认
 * 
 * @param {Array<{open: number, high: number, low: number, close: number, time?: number}>} bars 连续分时K线
 * @param {Object} [options]
 * @param {number} [options.minPlungeRatio=0.025] 急跌跳水门槛 (默认 -2.5%)
 * @param {number} [options.minReboundRatio=0.008] 止跌反抽确认门槛 (默认 +0.8% ~ +1.2%)
 * @param {Object} [options.indexBars] 对应时刻的 QQQ 分时 K 线 (可选)
 * @returns {Object} { detected: boolean, event: TurningEvent|null }
 */
export function detectPlungeTurnUp(bars, {
  minPlungeRatio = 0.025,
  minReboundRatio = 0.008,
  indexBars = null,
  symbol = 'UNKNOWN',
  source = TurningSourceType.DETECTED_ONLY
} = {}) {
  if (!Array.isArray(bars) || bars.length < 3) {
    return { detected: false, event: null };
  }

  const lowestIndex = bars.reduce((minI, b, i, arr) => b.low < arr[minI].low ? i : minI, 0);
  const troughBar = bars[lowestIndex];
  const startBar = bars[0];

  const plungeRatio = (startBar.open - troughBar.low) / startBar.open;
  const latestBar = bars[bars.length - 1];
  const reboundFromTrough = (latestBar.close - troughBar.low) / troughBar.low;
  const barsAfterTrough = bars.length - 1 - lowestIndex;

  const isPlunge = plungeRatio >= minPlungeRatio;
  const isConfirmed = reboundFromTrough >= minReboundRatio && latestBar.close > troughBar.close && barsAfterTrough >= 1;

  if (!isPlunge || !isConfirmed) {
    return { detected: false, event: null };
  }

  const indexContext = {};
  if (Array.isArray(indexBars) && indexBars.length >= 2) {
    const qStart = indexBars[0].open;
    const qEnd = indexBars[indexBars.length - 1].close;
    indexContext.qqq_ret = Number(((qEnd - qStart) / qStart).toFixed(4));
  }

  const event = createTurningEvent({
    type: TurningEventType.PLUNGE_TURN_UP,
    symbol,
    tAnchor: latestBar.time || Date.now(),
    pathWindow: [startBar.time, latestBar.time],
    impulse: {
      ret: -Number(plungeRatio.toFixed(4)),
      duration_bars: lowestIndex + 1,
      extreme_price: troughBar.low
    },
    confirm: {
      retrace_from_extreme: Number(reboundFromTrough.toFixed(4)),
      bars_after_extreme: barsAfterTrough,
      structure: latestBar.low > troughBar.low ? 'higher_low' : 'rebound_hook',
      is_confirmed: true
    },
    indexContext,
    source,
    evidenceNotes: [
      `急跌跳水幅度 -${(plungeRatio * 100).toFixed(1)}% (探底价 $${troughBar.low})`,
      `自底点止跌拉起 +${(reboundFromTrough * 100).toFixed(1)}% (经 ${barsAfterTrough} 根 bar 确认拐头向上)`,
      `大盘 QQQ 对应走势: ${indexContext.qqq_ret ? (indexContext.qqq_ret * 100).toFixed(2) + '%' : '无数据'}`
    ]
  });

  return {
    detected: true,
    event
  };
}
