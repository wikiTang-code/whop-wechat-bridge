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

## 4. 全量历史切片微观回测实测报告 (All 1,512 Events · 零粉饰)

针对本地数据库中现存的全部 **1,512 组切片事件**（共 **28,295 根 15m K 线**），运行严格因果的无未来函数滑动窗口检测（`detectSpikeTurnDown` 与 `detectPlungeTurnUp`），回测结果已落盘至 `data/runtime/backtest_turning_all_results.json`。

> **口径钉死（CHG-050 Grok）**：下表 87.9% / 78.8% 是**已知赵哥买卖窗口内的形态检出率**（detection in labeled windows），**不是** precision，禁止与 §6 30m 对账混读。

| 指标维度 | 真实买单切片 (107 笔) | 真实卖单切片 (165 笔) | 业务结论与量化洞察 |
|---|---|---|---|
| **形态有效检出率**（≠ precision） | **87.9%** (94/107) 检出急跌反抽拐点 | **78.8%** (130/165) 检出直线冲高回落拐点 | 只说明「赵哥单附近常能挖到拐点形态」，**不是**算法打点命中赵哥的 precision。假阳性行见下。 |
| **平均冲动段幅度** | 急跌平均幅度 **-14.60%** | 冲高脉冲平均 **+11.59%** | 大V入场标的微观弹性极高，并非 1%~2% 窄幅震荡。 |
| **平均确认段幅度** | 探底反抽确认 **+10.46%** | 见顶回落确认 **-5.64%** | 拐头后的微观回撤/反抽幅度显著，具备明确的移动止盈/右侧确认空间。 |
| **时延对齐情况 (Lead/Lag)** | 提前于喊单: **0 笔**<br>同一根 K 线: **18 笔 (19.1%)**<br>喊单后确认: **76 笔 (80.9%)** | 提前于卖单: **0 笔**<br>同一根 K 线: **10 笔 (7.7%)**<br>卖单后确认: **120 笔 (92.3%)** | **实战核心盲区**：赵哥往往在跳水最深处的左侧（或踩稳当根）即发声，纯算法等待右侧反抽确认，**天然存在 1~2 根 K 线的时滞（Lag）**。 |
| **反向假阳性风险 (False Positives)** | 买单窗口出现见顶信号: **84 次** | 卖单窗口出现见底信号: **132 次** | **高假阳性警示**：若不结合大盘宏观趋势（QQQ）与周哥多空参谋，仅凭单纯微观拐点算法极易被震荡假摔/假突破反复洗盘！ |

---

## 5. 统计与实战对账坦白 (Strategic Gap Audit · 严禁口径虚高)

依据审阅意见，严格纠偏统计口径，坦白样本内局限：

| 维度 | 审阅批评与原始差距 | 当前整改事实 | 科学结论与边界 |
|---|---|---|---|
| **统计背书口径** | 严禁无定义引用样本内 PF 36 或宣称策略就绪 | **已全量回测 1,512 组切片**：形态检出率 87.9% / 78.8%，但**时延上 80%+ 滞后于赵哥，且假阳性高** | 拐点检测适合作为「右侧确认 Evidence 与移动止盈触发器」，**绝对不可脱离 HITL 独立当开仓机器**。 |
| **模块解耦** | 仓位机固定比例与回落触发混装 | **已彻底拆分**：仓位规则标明为 `heuristic`；转弯检测拆为独立模块 `turning_detector.js` | 规则引擎 `hard_rules_engine.js` 仅对执行安全行使 REJECT。 |
| **QQQ 领先规律** | 68% 领先可能存在时间对齐与未来函数风险 | **降级为假设**：仅作为上下文记录入 `index_context`，不作为自动加权或硬阻断条件 | 待分钟级常驻采集后，做严格的无未来函数因果滞后回归检验。 |
| **分钟级抄底/梯子** | 日线抄底不可直接搬到 1m 上当作交易信号 | **明确角色为确认特征**：在分钟级上仅用于解释「为何这里像转弯」、丰富 Evidence | 不充当主开仓信号，继续受控于 HITL。 |

---

## 6. Exploratory IS/OOS holdout（CHG-050 · 不是 Walk-Forward，不是 alpha）

Grok 终审：上一轮把「±2h = 79% 共振」戳破，方向对；但源码仍是**根数比例切一刀 + 写死规则**，禁止称 Walk-Forward / 工业级。数字按 **exploratory** 记账。

本轮补丁引擎：[`scripts/knowledge/backtest_walk_forward_rigorous.js`](../../scripts/knowledge/backtest_walk_forward_rigorous.js) + [`scripts/knowledge/lib/exploratory_is_oos.js`](../../scripts/knowledge/lib/exploratory_is_oos.js)。

**方法（已冻结，OOS 只读）**

| 项 | 本轮事实 |
|---|---|
| 切分 | 5m：ET 交易日 **前 40 / 后 20**（2026-06-25→08-20 / 08-21→09-18），不是 `floor(len*40/60)` |
| 1m | Yahoo 免费只覆盖约 7 个会话，走 `short_window_proportional`（4/3），**不得冒充 40/20** |
| IS 网格 | 预先登记 `atrPctile ∈ {0.70,0.80,0.90}` × `volMult ∈ {1.0,1.2,1.5}`；目标函数 = ExitA 均净（min n=8），平手看 30m precision |
| k | 过去 100 根 ATR/C **分位数**；下轨 / ATR / EMA 用 **i-1** |
| 确认约定 | 收盘确认、次根 open 成交、来回 10 bps。不宣称「极值只用前前根」 |
| 赵哥口径 | `speaker_id` 硬锁 + `action='BUY'`；最近邻一条；Recall = 去重覆盖 / 赵哥单；单位混用即 `exit≠0` |
| 置换 | 赵哥时点随机落到 bar.time，B=200；报 30m precision 的零假设 p |
| 复现 | `node scripts/knowledge/backtest_walk_forward_rigorous.js --perm-b=200`；输入 sha256 在 `data/runtime/chg050_is_oos_summary.json`；jsonl 本地 gitignored |

### 6.1 5m 主表（calendar 40/20 · ExitA 固定 2h 扣费）

| 标的 | 冻结 (k分位, 量倍) | IS n / 均净% / 30m P / unique R | OOS n / 均净% / 30m P / unique R | OOS 置换 p | 赵哥 BUY |
|---|---|---|---|---|---|
| IREN | 0.80, 1.2 | 12 / +1.55 / 16.7% / 4.8% | 7 / **-0.79** / 28.6% / 9.1% | 0.25 | 65 |
| SOXL | 0.80, 1.0 | 18 / +2.69 / 5.6% / 6.7% | 7 / +1.87 / 42.9% / 13.6% | **0.0796** | 40 |
| MU | 0.80, 1.2 | 8 / +0.38 / 37.5% / 4.8% | 3 / +1.10 / 0% / 0% | n/a（OOS 无赵哥 BUY） | 62 |
| CRWV | 0.70, 1.0 | 27 / +1.25 / 7.4% / 5.7% | **16** / **-0.64** / 18.8% / 18.8% | 0.29 | 52 |
| COHR | 0.90, 1.2 | 9 / +0.38 / 0% / 0% | 4 / **-0.95** / 25% / 3.4% | 0.60 | 34 |

ExitB（38.2% 回吐）只作假说对照，完整 n/盈亏笔/均盈/均亏/MaxDD 见 summary，**禁止把 PF 当规则**。SOXL OOS ExitB n=7、4 盈 3 亏、均净 +1.51%、MaxDD 2.0%，PF 5.45 仍是小样本代数。

### 6.2 1m 附页（Yahoo ≈7 会话，不是 60 天）

1m 全是 `short_window_proportional`。IS 固定 2h 在 IREN/SOXL/MU/CRWV 为负期望；OOS n≤7（CRWV/COHR n=1）。置换 p 全部 ≥0.53。**1m 不能支撑任何规则。**

可写入 07 的结论：宽窗 79% 作废；过滤后 5m 30m precision 仍是个位数到四十、unique recall 多 <10%；OOS 固定持有在 IREN/CRWV/COHR 为负；置换未在 α=0.05 拒绝「随机打点也会碰上」。SOXL p=0.0796，五次检验下更不够。

### 6.3 Grok 残留笔记（不挡收口 · 禁止据此再开 C）

1. 每标的单独冻一套参数是 9 格 × 5 票多重选择。IS 全正、OOS 三负，符合过拟合，不是「规则在样本外活了」。
2. 置换把赵哥时点均匀抽到 bar.time，不是保时段结构；对「盘中扎堆」零假设偏松。够用，不要写成严格因果检验。
3. `cooldownBars=12` 在 5m 是 1h、在 1m 是 12min，未按周期折算。
4. 本文件名仍叫 `backtest_walk_forward_rigorous.js`（历史名）。§4 87.9% ≠ §6 precision。
5. 仓内单测只覆盖合成夹具，不证明 OOS 表。

**拍板 B（2026-09-20 Grok）**：P2 到此。§6 当反例。禁止进规则/HUD/`AUTO_SUBMIT`。不要做滚动多折来救期望。

---

## 7. deprecated_wide_window（禁止当主结论）

> **状态：`deprecated_wide_window`。** ±2h 匹配 + 多动作混计（SOXL「78 笔」）是旧叙事。不得与 §6 30m 个位数并列，不得进 HUD / 自动开仓。

旧表（仅考古，来自 `benchmark_top5_micro_alpha.js` 宽窗跑批）：

| 标的 | 5m相对波动率 | 赵哥单数（宽口径） | 买单共振率 (宽窗 ±2h) | 超前发现 (Lead) | 自主买胜率 (2h) | 买端 PF | 平均最大上涨 (MFE) | 卖端移动止盈 PF |
|---|---|---|---|---|---|---|---|---|
| **IREN** | 0.80% | 130 笔 | 86.2% | 21 笔 (提前) | 46.4% | 0.78 | +2.43% | 0.83 |
| **SOXL** | 1.12% | 78 笔 | 75.0% | 12 笔 (提前) | 51.3% | 0.80 | +3.62% | 0.91 |
| **MU** | 0.61% | 117 笔 | 74.2% | 12 笔 (提前) | 54.5% | 1.00 | +1.88% | 1.57 |
| **CRWV** | 0.66% | 97 笔 | 73.1% | 17 笔 (提前) | 44.0% | 0.70 | +1.84% | 0.68 |
| **COHR** | 0.70% | 65 笔 | 88.2% | 7 笔 (提前) | 46.6% | 0.80 | +1.98% | 1.20 |
| **均值** | 0.78% | 487 笔 | 79.3% | 69 笔 (提前) | 48.6% | 0.82 | +2.35% | 1.04 |

`optimize_tsla_micro_alpha.js` 明确标注：**不是近 60 天主结果**。

---

## 8. 战略差距对账单 (Strategic Gap Audit · 强制红线)

| 核心维度 | 原始战略诉求与假象 | 真实工程落地与量化实测差距 | 风险隐患与当前系统盲区 | 人工决策拍板项 (Human Gate) |
|---|---|---|---|---|
| **自主 Alpha** | 「工业级 Walk-Forward 已过关 / 可独立开仓」 | 本轮只是 **单次日历 holdout + 预登记网格**。5m OOS 在 IREN/CRWV/COHR ExitA 为负；最大 OOS n=16。置换未过 0.05。 | 把 IS 正均净或 ExitB PF 写进 HUD 会立刻回潮虚假精确。 | **维持 Layer1 evidence**；禁止 `AUTO_SUBMIT`；禁止雷达自动加权。 |
| **跟单对齐** | 「算法与赵哥 79% 共振」 | BUY-only + 最近邻 + 30m：precision 个位到四十，unique recall 多 <10%。SOXL 宽窗 78 笔 ≠ BUY 40 笔。 | 无 `t_arrive/px_zhao/px_arrive/delta/exec_policy`，口播价成交仍是空话。 | 到达价 A/B/C 决策仍待 Intent 字段。 |
| **出场神话** | 「38.2% 移动止盈是防御核心 / OOS PF 22」 | 旧 PF 22 来自 n=12 的 11/1。本轮 SOXL OOS ExitB n=7 PF 5.45，同样不可当规则。 | 止损已改跳空用 open 成交，但 trail 仍看收盘；未做空头对称。 | ExitB 保持假说，不出规则表。 |
| **1m / TSLA** | 「Top5 × 1m 已全覆盖」 | 1m 只有约 7 个 Yahoo 会话；TSLA 优化器已降级为非主结果。 | 60 天 1m 需券商/前瞻切片，不能靠免费 Yahoo。 | 接受 1m 短窗为附页。 |
| **柜台真源** | 「回测通过 = Paper 已通」 | 回测与柜台正交。Grok 拍板 B：P2 停在反例。 | 无 FILLED 则无持仓 SoR。 | **P0**：夜盘 20:00 ET `night_market_kickoff.js` 1 股 TSLA。 |

---

## 9. 下一步工作顺序 (Roadmap)

次序见 [`dual-track-operating-contract.md`](./dual-track-operating-contract.md)（CHG-051）。

1. **P0**：夜盘 20:00 ET `night_market_kickoff.js`，限价必须是当时盘口而非口播/默认 390，1 股 TSLA，等 `FILLED`；
2. **P1 Intent**：`t_arrive`, `px_zhao`, `px_arrive`, `delta`, `exec_policy∈{A,B,C}`；
3. **P3 参考轨**：现成检测器只播 `REFERENCE_ONLY`；禁止 C 救期望，禁止发令枪。


