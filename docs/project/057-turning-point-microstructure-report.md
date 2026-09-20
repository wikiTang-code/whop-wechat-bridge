# REQ-057: 赵哥「异动直线回落卖」与「急跌拐头买」微观转弯战法量化研究与策略落地报告

> **需求编号**：REQ-057  
> **审阅对齐**：全面吸纳专业审阅意见，严格执行**特征检测器与执行安全彻底解耦**。  
> **工程落地**：  
> 1. 独立微观转弯特征检测器：[`tools/trade/turning_detector.js`](file:///c:/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge/tools/trade/turning_detector.js) (`turning_v1`)；  
> 2. 执行安全与启发式参谋引擎：[`tools/trade/hard_rules_engine.js`](file:///c:/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge/tools/trade/hard_rules_engine.js)；  
> 3. 初版微观转弯证据库：[`data/runtime/turning_events_v0.jsonl`](file:///c:/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge/data/runtime/turning_events_v0.jsonl) (150 条样本)；  
> 4. 单测全绿：43 套单元测试 100% 绿灯通过。

---

## 1. 架构解耦与对象分工（纠偏混装）

本次重构彻底消除了“把启发式固定仓位与转弯微观触发混装为硬规则”的设计缺陷，建立四级清晰分工：

| 分层 | 模块载体 | 职责与判定性质 | 动作后果 |
|---|---|---|---|
| **执行安全门禁**<br>(Execution Safety) | `paper_risk_guard.js`<br>`hard_rules_engine.js` | 期权拦截、**卖单底仓硬守卫**、单笔 $5,000 上限、10% 偏离度截断、账户日内千刀亏损熔断 | 违例直接 **硬拦截 (REJECT)**，严禁越权报送柜台 |
| **微观转弯特征**<br>(Turning Features) | `turning_detector.js`<br>(`turning_v1`) | 冲动段（急跌/直线）与确认段（反抽/回落）状态提取，输出结构化 `TurningEvent` | **仅作为特征与 Evidence 打标**，绝不单独自动下单 |
| **客观参谋提示**<br>(Advisory Context) | `hard_rules_engine.js`<br>(RULE-008) | 周哥「美股工具箱」多空分歧、GEX Put Wall 破位预警 | **仅提示 (WARN)**，严禁代码越权硬拦，决断权在人工 |
| **仓位管理建议**<br>(Position Heuristics) | `hard_rules_engine.js`<br>(RULE-001~005) | 早盘 1/6 试探建议、尾盘防追高、脉冲阶梯减半仓、2%做T加回、保本损防守 | **显式标注 `heuristic`**，作为上下文提示，不充当伪铁律 |

---

## 2. 赵哥实战口诀原录（原话确凿实证）

在社群发言库中（发送者硬锁 `user_4yeplXgbguTu4`），完全印证了用户与审阅的核心语义：

1. **急跌吃止损 + 拐头转弯卖（2026/8/26 21:23:31）**：
   > “就像昨天的 riot 开盘那么多人说怎么那么弱，**直线+7%** 就又变成强势股。操作决定了股票强弱：**急跌吃散户止损时候买入，大单开始止盈就看转弯卖出**。”
2. **异动分批挂触发卖（2026/9/11 22:18:14）**：
   > “**突然直线就可以分批出**。”
3. **设置跌破多少（回落触发）移动止盈（2026/8/4 23:30:35）**：
   > “高很多的都是**设跌破多少止盈**，20-30% 就是要减持和止盈，**设置跌破多少都出**。”
4. **大盘 QQQ 转弯联动（2026/8/20 19:45:09）**：
   > “强势股主要看 **qqq 的转弯去低吸**。”
5. **盘口微观节奏闭环（2026/9/3 02:33:30）**：
   > “盯着盘口，**有大单有转弯**，是不是往下回踩最低点大于前一天最低了吸。看大盘是不是 V，大盘 V 了，手里股价涨了就**异动出一半，再涨一个直线异动再出一半**；出了再看看哪些**急跌的吸**，都没急跌在收盘 3 点附近强平 V 了再吸股价接近第一个回踩的。”

---

## 3. 标准化 `TurningEvent` Schema 规范

在 `turning_detector.js` 中确立了严格的事件契约：

```json
{
  "version": "turning_v1",
  "type": "spike_turn_down | plunge_turn_up",
  "symbol": "TSLA",
  "t_anchor": 1789900000000,
  "path_window": [1789899000000, 1789900000000],
  "impulse": {
    "ret": 0.058,
    "duration_bars": 4,
    "extreme_price": 220.0
  },
  "confirm": {
    "retrace_from_extreme": 0.012,
    "bars_after_extreme": 2,
    "structure": "lower_high | rebound_hook",
    "is_confirmed": true
  },
  "index_context": {
    "qqq_ret": 0.003,
    "qqq_turn_lag_minutes": 5,
    "spx_ret": null
  },
  "source": "zhao_quote | audited_fill | detected_only",
  "evidence_notes": [
    "冲动段短线脉冲 +5.8% (峰值 $220)",
    "自峰值回撤 1.2% (经 2 根 bar 确认拐头向下)"
  ]
}
```

---

## 4. 统计与实战对账坦白 (Strategic Gap Audit · 严禁口径虚高)

依据审阅意见，严格纠偏统计口径，坦白样本内局限：

| 维度 | 审阅批评与原始差距 | 当前整改事实 | 科学结论与边界 |
|---|---|---|---|
| **统计背书口径** | 严禁无定义引用样本内 PF 36 或宣称策略就绪 | **已全面纠偏**：明确前述统计为近 60 天样本内（In-Sample）描述性观察，未扣滑点未做空头对称，**禁止充当 Alpha 就绪背书** | 仅作为候选参数初值参考（脉冲 $+3.5\%$、回落 $0.8\% \sim 1.5\%$；急跌 $-2.5\%$、反抽 $0.8\% \sim 1.2\%$），待滚动样本外检验。 |
| **模块解耦** | 仓位机固定比例与回落触发混装 | **已彻底拆分**：仓位规则标明为 `heuristic`；转弯检测拆为独立模块 `turning_detector.js` | 规则引擎 `hard_rules_engine.js` 仅对执行安全行使 REJECT。 |
| **QQQ 领先规律** | 68% 领先可能存在时间对齐与未来函数风险 | **降级为假设**：仅作为上下文记录入 `index_context`，不作为自动加权或硬阻断条件 | 待分钟级常驻采集后，做严格的无未来函数因果滞后回归检验。 |
| **分钟级抄底/梯子** | 日线抄底不可直接搬到 1m 上当作交易信号 | **明确角色为确认特征**：在分钟级上仅用于解释「为何这里像转弯」、丰富 Evidence | 不充当主开仓信号，继续受控于 HITL。 |

---

## 5. 下一步工作顺序 (Roadmap)

1. **周一 08:00 CST (P0 点火)**：运行 `night_market_kickoff.js` 点亮首笔 TSLA 真实 `FILLED` 与持仓真源，完成执行域真实闭环；
2. **证据库滚动扩充 (P1)**：基于 `data/runtime/turning_events_v0.jsonl`（150条），增加 1m / 5m 梯子收回与超卖特征打标；
3. **样本外交叉对比 (P2)**：以按月滚动方式评估转弯特征的假阳性率与方向一致性，收敛为稳定的 `turning_v1` 生产参数。
