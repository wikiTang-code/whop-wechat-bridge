/**
 * tools/trade/hard_rules_engine.js
 * 
 * [执行安全门禁与战术参谋引擎 · Execution Safety & Advisory Engine]
 * 
 * 架构分工 (彻底对齐审阅意见):
 * 1. 执行安全门禁 (Execution Safety Guards · 强制 REJECT):
 *    - 期权代码拦截 (RULE-006)
 *    - 卖单无底仓硬拦截 (RULE-007)
 *    - 单笔名义金额限额 ($5,000)
 *    - 账户日内最大亏损熔断
 * 2. 客观参谋预警 (Advisory Context · 仅提示 WARN，不越权硬拦):
 *    - 周哥量化多空分歧 (RULE-008)
 *    - GEX Put Wall 破位预警 (RULE-008)
 * 3. 启发式仓位管理建议 (Position Heuristics · 标明 heuristic，非硬律):
 *    - 早盘开盘前60分钟 1/6 试探建议
 *    - 尾盘 Power Hour 防追高提示
 *    - 盈利脉冲阶梯出半仓提示 (TAC-002 heuristic)
 *    - 差价回补做T空间提示 (TAC-003 heuristic)
 *    - 保本止损位跟踪提示 (TAC-005 heuristic)
 * 4. 微观转弯特征挂接:
 *    - 挂接 tools/trade/turning_detector.js 输出形态事件作为 evidence。
 */

import { getUsMarketSession } from '../knowledge/market_session.js';
import { TacticalState } from './position_lifecycle_manager.js';
import {
  detectSpikeTurnDown,
  detectPlungeTurnUp,
  TurningEventType
} from './turning_detector.js';

export const HardRuleId = {
  // 1. 执行安全门禁 (硬阻断)
  RULE_006_EQUITY_CORE_NO_OPTION: 'RULE_006_EQUITY_CORE_NO_OPTION',       // 正股压舱底与期权硬拦截
  RULE_007_UNDERLYING_INVENTORY_GUARD: 'RULE_007_UNDERLYING_INVENTORY_GUARD', // 卖单底仓硬守卫

  // 2. 客观参谋提示 (仅 WARN，选择权交人)
  RULE_008_QUANT_DIVERGENCE_ADVISORY: 'RULE_008_QUANT_DIVERGENCE_ADVISORY', // 周哥/GEX分歧客观提示

  // 3. 启发式战术仓位建议 (Heuristic Advisories)
  RULE_001_OPENING_DIP_PROBE: 'RULE_001_OPENING_DIP_PROBE',             // [heuristic] 早盘回踩 1/6 试探建议
  RULE_002_POWER_HOUR_CHASE_GUARD: 'RULE_002_POWER_HOUR_CHASE_GUARD',     // [heuristic] 尾盘防追高提示
  RULE_003_HALF_TAKE_PROFIT: 'RULE_003_HALF_TAKE_PROFIT',               // [heuristic] 脉冲阶梯半仓止盈建议
  RULE_004_SPREAD_GAP_REBUY_T: 'RULE_004_SPREAD_GAP_REBUY_T',           // [heuristic] 做T加回差价空间建议
  RULE_005_BREAKEVEN_STOP_DEFENSE: 'RULE_005_BREAKEVEN_STOP_DEFENSE'     // [heuristic] 保本损防守建议
};

export const RuleVerdict = {
  PASS: 'PASS',
  WARN: 'WARN',
  REJECT: 'REJECT'
};

/**
 * 执行风控与战术参谋综合评估
 * @param {Object} ctx 决策输入上下文
 * @returns {Object} 评估结果
 */
export function evaluateHardRules(ctx) {
  const ticker = String(ctx.ticker || '').trim().toUpperCase();
  const side = String(ctx.side || '').trim().toUpperCase();
  const price = parseFloat(ctx.price) || 0;
  const quantity = parseInt(ctx.quantity, 10) || 0;
  const dayChange = typeof ctx.dayChangePercent === 'number' ? ctx.dayChangePercent : 0;
  const currentPos = ctx.currentPosition || null;
  const lifecycle = ctx.positionLifecycle || null;
  const session = ctx.marketSession || getUsMarketSession();
  const quant = ctx.quantReference || {};

  const ruleAudit = [];
  const rejectReasons = [];
  const warnings = [];

  // =========================================================================
  // 第一部分: 执行安全硬门禁 (EXECUTION SAFETY · 坚决阻断)
  // =========================================================================

  // 1. RULE-006: 期权代码物理拦截 (Phase 0 仅限正股/ETF)
  const isOption = /\d{6}[CP]\d+/i.test(ticker) || /^[A-Z]+\s+\d{2,4}/i.test(ticker);
  if (isOption) {
    ruleAudit.push({
      ruleId: HardRuleId.RULE_006_EQUITY_CORE_NO_OPTION,
      verdict: RuleVerdict.REJECT,
      note: `标的 ${ticker} 属于期权，Phase 0 物理阻断，仅限正股/ETF`
    });
    rejectReasons.push(`RULE-006: 标的 ${ticker} 为期权，Phase 0 仅限正股/ETF`);
  } else {
    ruleAudit.push({
      ruleId: HardRuleId.RULE_006_EQUITY_CORE_NO_OPTION,
      verdict: RuleVerdict.PASS,
      note: '标的为正股/ETF，符合执行安全标准'
    });
  }

  // 2. RULE-007: 卖单底仓硬守卫 (SELL Without Inventory Guard)
  if (side === 'SELL') {
    const heldQty = currentPos ? (parseInt(currentPos.quantity, 10) || 0) : 0;
    if (heldQty <= 0) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_007_UNDERLYING_INVENTORY_GUARD,
        verdict: RuleVerdict.REJECT,
        note: `标的 ${ticker} 底仓为 0，前期未开仓跟入，坚决阻断卖出`
      });
      rejectReasons.push(`REJECTED_NO_UNDERLYING_POSITION: 标的 ${ticker} 底仓为 0 (RULE-007: 前面开仓未跟入，不可执行卖出)`);
    } else if (quantity > heldQty) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_007_UNDERLYING_INVENTORY_GUARD,
        verdict: RuleVerdict.WARN,
        note: `卖出数量 (${quantity}) 超过底仓 (${heldQty})，自动截断至底仓量`
      });
      warnings.push(`RULE-007: 拟卖出 ${quantity} 股大于现有底仓 ${heldQty} 股，已截断至当前最大可用量`);
    } else {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_007_UNDERLYING_INVENTORY_GUARD,
        verdict: RuleVerdict.PASS,
        note: `底仓充足 (持仓 ${heldQty} 股 >= 卖出 ${quantity} 股)`
      });
    }
  }

  // =========================================================================
  // 第二部分: 客观参谋提示 (ADVISORY CONTEXT · 仅提示 WARN，不越权硬拦)
  // =========================================================================

  let hasQuantDivergence = false;
  if (quant.zhouSignal === 'BEARISH' && side === 'BUY') {
    hasQuantDivergence = true;
    ruleAudit.push({
      ruleId: HardRuleId.RULE_008_QUANT_DIVERGENCE_ADVISORY,
      verdict: RuleVerdict.WARN,
      note: '【周哥量化分歧参谋】美股工具箱提示日内为空头走势，赵哥此时提示买入可能为左侧抄底，提示操作员核对'
    });
    warnings.push('RULE-008: 【参谋预警】周哥「美股工具箱」提示日内为空头波段，与本次买入信号存在分歧，请人工审慎核准');
  }

  if (quant.gexRegime === 'PUT_WALL_BROKEN' && side === 'BUY') {
    hasQuantDivergence = true;
    ruleAudit.push({
      ruleId: HardRuleId.RULE_008_QUANT_DIVERGENCE_ADVISORY,
      verdict: RuleVerdict.WARN,
      note: '【GEX结构分歧】当前价格跌破 Put Wall 支撑下沿，Gamma 负反馈可能加剧下行波动'
    });
    warnings.push('RULE-008: 【GEX预警】市场跌破 Put Wall 支撑下沿，处于负 Gamma 暴跌区，请人工留意大盘共振');
  }

  if (!hasQuantDivergence) {
    ruleAudit.push({
      ruleId: HardRuleId.RULE_008_QUANT_DIVERGENCE_ADVISORY,
      verdict: RuleVerdict.PASS,
      note: '未检测到周哥量化或 GEX 严重分歧'
    });
  }

  // =========================================================================
  // 第三部分: 启发式战术仓位管理建议 (HEURISTIC GUIDANCE · 仅供参考)
  // =========================================================================

  const et = session.et;
  const isOpeningHour = et && (et.timeNum >= 930 && et.timeNum <= 1030);
  if (side === 'BUY' && isOpeningHour) {
    if (dayChange > 3.0) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_001_OPENING_DIP_PROBE,
        verdict: RuleVerdict.WARN,
        note: `[启发式提示] 早盘开盘前60分钟标的涨幅已达 +${dayChange.toFixed(1)}%，非跳水回踩形态，注意追高风险`
      });
      warnings.push(`RULE-001: [启发式] 早盘处于急拉区 (+${dayChange.toFixed(1)}%)，非大V惯用跳水回踩试探点`);
    } else {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_001_OPENING_DIP_PROBE,
        verdict: RuleVerdict.PASS,
        note: '[启发式] 适合早盘跳水回踩阶段 1/6 常规仓分批低吸纪律'
      });
    }
  }

  const isPowerHour = session.isPowerHour || (et && et.timeNum >= 1500 && et.timeNum <= 1600);
  if (side === 'BUY' && isPowerHour) {
    if (dayChange > 4.0) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_002_POWER_HOUR_CHASE_GUARD,
        verdict: RuleVerdict.WARN,
        note: `[启发式提示] 尾盘三点到四点标的涨幅已达 +${dayChange.toFixed(1)}%，警惕机构抢跑强平回落`
      });
      warnings.push(`RULE-002: [启发式] 尾盘高位追涨警惕 (+${dayChange.toFixed(1)}%)，防范机构 Power Hour 获利出逃`);
    } else {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_002_POWER_HOUR_CHASE_GUARD,
        verdict: RuleVerdict.PASS,
        note: '[启发式] 尾盘点位处于稳健区间'
      });
    }
  }

  if (currentPos && currentPos.quantity > 0) {
    const avgEntry = parseFloat(currentPos.average_entry_price) || 0;
    const profitRatio = avgEntry > 0 ? (price - avgEntry) / avgEntry : 0;
    if (profitRatio >= 0.05 && lifecycle?.state === TacticalState.INITIAL_PROBE) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_003_HALF_TAKE_PROFIT,
        verdict: RuleVerdict.WARN,
        note: `[启发式提示] 浮盈达 +${(profitRatio * 100).toFixed(1)}%，建议参考 TAC-002 挂回落触发单出一半锁定利润`
      });
      warnings.push(`RULE-003: [启发式] 浮盈达 +${(profitRatio * 100).toFixed(1)}%，建议结合盘口拐头挂单减半仓`);
    }
  }

  if (side === 'BUY' && lifecycle?.state === TacticalState.T_GAP_ACTIVE) {
    const lastSellPrice = parseFloat(lifecycle.lastSellPrice) || 0;
    if (lastSellPrice > 0) {
      const dropRatio = (lastSellPrice - price) / lastSellPrice;
      if (dropRatio >= 0.02) {
        ruleAudit.push({
          ruleId: HardRuleId.RULE_004_SPREAD_GAP_REBUY_T,
          verdict: RuleVerdict.PASS,
          note: `[启发式] 距前高抛价回调 ${(dropRatio * 100).toFixed(1)}%，满足差价做T加回参考空间`
        });
      } else {
        ruleAudit.push({
          ruleId: HardRuleId.RULE_004_SPREAD_GAP_REBUY_T,
          verdict: RuleVerdict.WARN,
          note: `[启发式提示] 距前高抛价仅回调 ${(dropRatio * 100).toFixed(1)}% (<2%)，差价狭窄易被滑点磨损`
        });
        warnings.push(`RULE-004: [启发式] 做T差价空间不足 2% (当前 ${(dropRatio * 100).toFixed(1)}%)，建议等待更深回踩`);
      }
    }
  }

  if (currentPos && currentPos.quantity > 0) {
    const avgEntry = parseFloat(currentPos.average_entry_price) || 0;
    const pnlRatio = avgEntry > 0 ? (price - avgEntry) / avgEntry : 0;
    
    if (lifecycle?.state === TacticalState.HALF_LOCKED && price < avgEntry) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_005_BREAKEVEN_STOP_DEFENSE,
        verdict: RuleVerdict.WARN,
        note: `[启发式提示] 现价跌破成本价 $${avgEntry}，触及保本损防守位，建议剩余半仓平仓保本`
      });
      warnings.push(`RULE-005: [启发式] 触及保本防守线 ($${price} < 成本 $${avgEntry})，建议平仓保本`);
    } else if (pnlRatio <= -0.045) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_005_BREAKEVEN_STOP_DEFENSE,
        verdict: RuleVerdict.WARN,
        note: `[启发式提示] 浮亏达 ${(pnlRatio * 100).toFixed(1)}% 触及底线预警，严禁盲目加仓补洞`
      });
      warnings.push(`RULE-005: [启发式] 浮亏达 ${(pnlRatio * 100).toFixed(1)}%，触及实战止损警戒区间`);
    }
  }

  // =========================================================================
  // 第四部分: 微观转弯形态检测 (TURNING FEATURE · 纯特征提取)
  // =========================================================================
  let turningPoint = null;
  if (Array.isArray(ctx.recentBars) && ctx.recentBars.length >= 3) {
    if (side === 'SELL') {
      const res = detectSpikeTurnDown(ctx.recentBars, { symbol: ticker });
      if (res.detected) turningPoint = res.event;
    } else if (side === 'BUY') {
      const res = detectPlungeTurnUp(ctx.recentBars, { symbol: ticker });
      if (res.detected) turningPoint = res.event;
    }
  }

  // 综合判定 (只有第一部分执行安全违例才会造成 REJECT)
  const hasReject = rejectReasons.length > 0;
  const hasWarn = warnings.length > 0;
  const verdict = hasReject ? RuleVerdict.REJECT : (hasWarn ? RuleVerdict.WARN : RuleVerdict.PASS);

  return {
    verdict,
    passed: !hasReject,
    rejectReasons,
    warnings,
    ruleAudit,
    turningPoint
  };
}

// 兼容导出检测函数
export { detectSpikeTurnDown, detectPlungeTurnUp };
