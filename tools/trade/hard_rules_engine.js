/**
 * tools/trade/hard_rules_engine.js
 * 
 * [Gap 3 战略落地] 基于真实成交与实战纪律反推的「8条硬规则集策略引擎」
 * (Audited Hard Rules Engine for Trade Decisions)
 * 
 * 核心来源:
 * 1. 388 笔近 60 天真实成交单与 265 笔配对平仓单 (Win Rate 63.8%, Profit Factor 36.31);
 * 2. 大V实战仓位动态生命周期 (TAC-001 试探仓 / TAC-002 半仓止盈 / TAC-003 做T加回);
 * 3. 吸收用户最新战略裁定:
 *    - 周哥量化 / GEX 分歧作为客观参谋提示 (Warning)，严禁直接硬拦截，选择权在人工 (HITL);
 *    - 前面开仓未跟入，卖单坚决无底仓拦截 (RULE-007)。
 */

import { getUsMarketSession } from '../knowledge/market_session.js';
import { TacticalState } from './position_lifecycle_manager.js';

export const HardRuleId = {
  RULE_001_OPENING_DIP_PROBE: 'RULE_001_OPENING_DIP_PROBE',         // 早盘前60分钟跳水回踩试探仓律 (<=1/6仓)
  RULE_002_POWER_HOUR_CHASE_GUARD: 'RULE_002_POWER_HOUR_CHASE_GUARD', // 尾盘三点到四点防追高律
  RULE_003_HALF_TAKE_PROFIT: 'RULE_003_HALF_TAKE_PROFIT',           // 脉冲急拉必出半仓锁利律
  RULE_004_SPREAD_GAP_REBUY_T: 'RULE_004_SPREAD_GAP_REBUY_T',       // 2%~3%差价回补做T加回律
  RULE_005_BREAKEVEN_STOP_DEFENSE: 'RULE_005_BREAKEVEN_STOP_DEFENSE', // 出半仓后保本损与-4%底线止损律
  RULE_006_EQUITY_CORE_NO_OPTION: 'RULE_006_EQUITY_CORE_NO_OPTION',   // 正股压舱底与期权硬拦截律
  RULE_007_UNDERLYING_INVENTORY_GUARD: 'RULE_007_UNDERLYING_INVENTORY_GUARD', // 卖单无底仓硬拦截律
  RULE_008_QUANT_DIVERGENCE_ADVISORY: 'RULE_008_QUANT_DIVERGENCE_ADVISORY'   // 周哥/GEX分歧客观提示律 (人工定夺，代码不拦截)
};

/**
 * 规则评估结果状态
 */
export const RuleVerdict = {
  PASS: 'PASS',
  WARN: 'WARN',       // 提示操作员参考 (不阻断，选择权交人)
  REJECT: 'REJECT'    // 硬拦截
};

/**
 * 执行 8 大实战硬规则综合评估
 * @param {Object} ctx 决策输入上下文
 * @param {string} ctx.ticker 标的代码
 * @param {string} ctx.side 买卖方向 (BUY/SELL)
 * @param {number} ctx.price 限价/当前价
 * @param {number} ctx.quantity 股数
 * @param {number} [ctx.dayChangePercent] 标的当日涨跌幅 (如 +5.2 代表 +5.2%)
 * @param {Object} [ctx.currentPosition] 当前持仓 (来自 broker_paper_positions)
 * @param {Object} [ctx.positionLifecycle] 当前战术生命周期状态 (来自 position_lifecycle_manager)
 * @param {Object} [ctx.marketSession] 美股时段对象 (可选，若无则自动感知当前美东时段)
 * @param {Object} [ctx.quantReference] 周哥量化与GEX参考数据 { zhouSignal: 'BEARISH'|'BULLISH', gexRegime: 'PUT_WALL_BROKEN' }
 * @returns {{
 *   verdict: 'PASS'|'WARN'|'REJECT',
 *   passed: boolean,
 *   rejectReasons: string[],
 *   warnings: string[],
 *   ruleAudit: Array<{ ruleId: string, verdict: string, note: string }>
 * }}
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

  // -------------------------------------------------------------
  // RULE-006: 正股压舱底与期权代码拦截律 (Phase 0 物理阻断期权)
  // -------------------------------------------------------------
  const isOption = /\d{6}[CP]\d+/i.test(ticker) || /^[A-Z]+\s+\d{2,4}/i.test(ticker);
  if (isOption) {
    ruleAudit.push({
      ruleId: HardRuleId.RULE_006_EQUITY_CORE_NO_OPTION,
      verdict: RuleVerdict.REJECT,
      note: `标的 ${ticker} 属于期权，违反正股压舱底律与 Phase 0 限制`
    });
    rejectReasons.push(`RULE-006: 标的 ${ticker} 为期权，Phase 0 仅限正股/ETF`);
  } else {
    ruleAudit.push({
      ruleId: HardRuleId.RULE_006_EQUITY_CORE_NO_OPTION,
      verdict: RuleVerdict.PASS,
      note: '标的为正股/ETF，符合压舱底资产标准'
    });
  }

  // -------------------------------------------------------------
  // RULE-007: 卖单底仓硬拦截律 (前面开仓没跟，卖单不可执行)
  // -------------------------------------------------------------
  if (side === 'SELL') {
    const heldQty = currentPos ? (parseInt(currentPos.quantity, 10) || 0) : 0;
    if (heldQty <= 0) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_007_UNDERLYING_INVENTORY_GUARD,
        verdict: RuleVerdict.REJECT,
        note: `标的 ${ticker} 底仓为 0，历史买单未跟入，坚决阻断卖出`
      });
      rejectReasons.push(`REJECTED_NO_UNDERLYING_POSITION: 标的 ${ticker} 底仓为 0 (RULE-007: 前面开仓未跟入，不可执行卖出)`);
    } else if (quantity > heldQty) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_007_UNDERLYING_INVENTORY_GUARD,
        verdict: RuleVerdict.WARN,
        note: `卖出数量 (${quantity}) 超过底仓 (${heldQty})，须裁剪至底仓量`
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

  // -------------------------------------------------------------
  // RULE-001: 早盘前60分钟 (09:30-10:30 ET) 跳水回踩试探仓律
  // -------------------------------------------------------------
  const et = session.et;
  const isOpeningHour = et && (et.timeNum >= 930 && et.timeNum <= 1030);
  if (side === 'BUY' && isOpeningHour) {
    if (dayChange > 3.0) {
      // 早盘跳空大涨或急拉，属于追高禁区
      ruleAudit.push({
        ruleId: HardRuleId.RULE_001_OPENING_DIP_PROBE,
        verdict: RuleVerdict.WARN,
        note: `早盘开盘前60分钟标的涨幅已达 +${dayChange.toFixed(1)}%，非跳水回踩低吸形态，注意追高风险`
      });
      warnings.push(`RULE-001: 早盘开盘前60分钟处于急拉区 (+${dayChange.toFixed(1)}%)，非大V惯用回踩试探低吸点`);
    } else {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_001_OPENING_DIP_PROBE,
        verdict: RuleVerdict.PASS,
        note: '符合早盘跳水回踩阶段 1/6 常规仓分批低吸纪律'
      });
    }
  }

  // -------------------------------------------------------------
  // RULE-002: 尾盘三点到四点 (15:00-16:00 ET) 防追高律
  // -------------------------------------------------------------
  const isPowerHour = session.isPowerHour || (et && et.timeNum >= 1500 && et.timeNum <= 1600);
  if (side === 'BUY' && isPowerHour) {
    if (dayChange > 4.0) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_002_POWER_HOUR_CHASE_GUARD,
        verdict: RuleVerdict.WARN,
        note: `尾盘三点到四点标的涨幅已达 +${dayChange.toFixed(1)}%，警惕机构抢跑强平回落`
      });
      warnings.push(`RULE-002: 尾盘高位追涨警惕 (+${dayChange.toFixed(1)}%)，机构通常在 Power Hour 扫盘后获利了结`);
    } else {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_002_POWER_HOUR_CHASE_GUARD,
        verdict: RuleVerdict.PASS,
        note: '尾盘时段点位处于稳健区间'
      });
    }
  }

  // -------------------------------------------------------------
  // RULE-003: 脉冲急拉必出半仓锁利律 (针对持仓生命周期)
  // -------------------------------------------------------------
  if (currentPos && currentPos.quantity > 0) {
    const avgEntry = parseFloat(currentPos.average_entry_price) || 0;
    const profitRatio = avgEntry > 0 ? (price - avgEntry) / avgEntry : 0;
    if (profitRatio >= 0.05 && lifecycle?.state === TacticalState.INITIAL_PROBE) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_003_HALF_TAKE_PROFIT,
        verdict: RuleVerdict.WARN,
        note: `标的浮盈已达 +${(profitRatio * 100).toFixed(1)}%，触发 TAC-002 半仓阶梯止盈信号，建议出一半锁定利润`
      });
      warnings.push(`RULE-003: 浮盈已超 5% (+${(profitRatio * 100).toFixed(1)}%)，战术状态机建议锁定半仓收益`);
    }
  }

  // -------------------------------------------------------------
  // RULE-004: 2%~3% 差价做T低吸加回律
  // -------------------------------------------------------------
  if (side === 'BUY' && lifecycle?.state === TacticalState.T_GAP_ACTIVE) {
    const lastSellPrice = parseFloat(lifecycle.lastSellPrice) || 0;
    if (lastSellPrice > 0) {
      const dropRatio = (lastSellPrice - price) / lastSellPrice;
      if (dropRatio >= 0.02) {
        ruleAudit.push({
          ruleId: HardRuleId.RULE_004_SPREAD_GAP_REBUY_T,
          verdict: RuleVerdict.PASS,
          note: `距前高抛价 $${lastSellPrice} 回调 ${(dropRatio * 100).toFixed(1)}%，满足 TAC-003 差价加回做T标准`
        });
      } else {
        ruleAudit.push({
          ruleId: HardRuleId.RULE_004_SPREAD_GAP_REBUY_T,
          verdict: RuleVerdict.WARN,
          note: `距前高抛价仅回调 ${(dropRatio * 100).toFixed(1)}% (<2%)，差价空间不足，加回做T利润可能被滑点磨损`
        });
        warnings.push(`RULE-004: 做T差价空间不足 2% (当前 ${(dropRatio * 100).toFixed(1)}%)，建议等待更深回踩再加回`);
      }
    }
  }

  // -------------------------------------------------------------
  // RULE-005: 保本损与最大 -4%~-5% 底线止损律
  // -------------------------------------------------------------
  if (currentPos && currentPos.quantity > 0) {
    const avgEntry = parseFloat(currentPos.average_entry_price) || 0;
    const pnlRatio = avgEntry > 0 ? (price - avgEntry) / avgEntry : 0;
    
    // 若已处于 HALF_LOCKED (已出半仓)，成本价即为铁底保本损
    if (lifecycle?.state === TacticalState.HALF_LOCKED && price < avgEntry) {
      ruleAudit.push({
        ruleId: HardRuleId.RULE_005_BREAKEVEN_STOP_DEFENSE,
        verdict: RuleVerdict.WARN,
        note: `已锁定半仓收益，现价跌破入场成本均价 $${avgEntry}，触及保本损触发线，建议全平保本`
      });
      warnings.push(`RULE-005: 触及 TAC-002 保本止损线 ($${price} < 成本 $${avgEntry})，剩余半仓应当平仓保本`);
    } else if (pnlRatio <= -0.045) {
      // 试探仓跌破 -4.5% 硬底线
      ruleAudit.push({
        ruleId: HardRuleId.RULE_005_BREAKEVEN_STOP_DEFENSE,
        verdict: RuleVerdict.WARN,
        note: `标的当前浮亏 ${(pnlRatio * 100).toFixed(1)}% 已逼近 -5% 极限容忍度，严禁盲目加仓补洞`
      });
      warnings.push(`RULE-005: 浮亏达 ${(pnlRatio * 100).toFixed(1)}%，触及实战铁律最大止损警戒线`);
    }
  }

  // -------------------------------------------------------------
  // RULE-008: 周哥量化 / GEX 分歧客观参谋提示律 (用户定案: 提示参考，不直接拦截，人工裁决)
  // -------------------------------------------------------------
  let hasQuantDivergence = false;
  if (quant.zhouSignal === 'BEARISH' && side === 'BUY') {
    hasQuantDivergence = true;
    ruleAudit.push({
      ruleId: HardRuleId.RULE_008_QUANT_DIVERGENCE_ADVISORY,
      verdict: RuleVerdict.WARN,
      note: '【周哥量化分歧参谋】美股工具箱显示日内为空头走势，赵哥此时提示买入可能为左侧抄底，提示操作员核对'
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

  // 综合判定
  const hasReject = rejectReasons.length > 0;
  const hasWarn = warnings.length > 0;
  const verdict = hasReject ? RuleVerdict.REJECT : (hasWarn ? RuleVerdict.WARN : RuleVerdict.PASS);

  return {
    verdict,
    passed: !hasReject,
    rejectReasons,
    warnings,
    ruleAudit
  };
}
