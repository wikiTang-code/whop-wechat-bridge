# ⚙️ Stage 3: 执行层技术规格规范 (STAGE3 Execution Specification)

> **版本标识**：`STAGE3-EXEC-SPEC-V1`  
> **数据基准**：严格基于 QQQ 2026-01～03 回测表四列执行开关与周哥 4 条已接受纪律构建。  
> **红线铁律**：本层只定义执行风控与回测统计边界，严禁将群友提示词作为自动下单指令接入 L2a 候选表。

---

## 一、资金与仓位管理规则 (Capital & Position Sizing)

1. **单笔名义仓位 (Nominal Sizing)**：
   - 默认每笔分配固定 **\$10,000 (1 万美金)** 名义本金；
2. **最大并发持仓限制 (Max Overlapping Positions)**：
   - 同一标的最大并发持仓笔数 **$\le 3$ 仓 (Max 3 Lots)**；
   - 当已有 3 笔未平仓 lot 时，系统自动抑制后续任何新的 `LONG_HINT` 买方信号；
3. **持仓隔离**：
   - 每一笔成交作为独立的 `Lot` 进行追踪，独立记录开仓时间、开仓价格、出场时间、出场价格与盈亏 R 值。

---

## 二、绩效统计与回测口径 (Performance Accounting)

1. **已平仓结算原则 (Closed Lot Basis)**：
   - 胜率、盈亏比与期望值计算严格基于 **已平仓 Lot (Closed Positions)**，浮动盈亏不计入统计 KPI；
2. **核心指标公式**：
   - **单笔收益 R 值**：$R = \frac{P_{\text{exit}} - P_{\text{entry}}}{\text{Risk Unit}}$
   - **平均期望 (Expectancy)**：$E = (\text{Win Rate} \times \text{Avg Win R}) - (\text{Loss Rate} \times \text{Avg Loss R})$
   - **止损率 (Stopout Rate)**：被动触发到期无条件平仓或硬止损的比例。

---

## 三、四列开关对照体系 (Four-Column Benchmark Matrix)

> 基于 QQQ 回测表定义四组对照执行环境，主路径候选为 `A_v2_24h`（作为择时研究对照，不强制 24h 下单）：

| 开关方案名称 | 交易时段限制 | 信号过滤规则 | 回测定位与用途 |
| :--- | :--- | :--- | :--- |
| **RTH·locked** | 仅常规交易时段 (09:30–16:00 ET) | 严格锁定基准过滤 | 传统美股主交易时段基准线 |
| **全关 (All Off)** | 全时段放开 | 无任何过滤，原始信号直通 | 原始信号裸跑对照组 |
| **旧全开 (Legacy All On)**| 全时段放开 | 叠加旧版全部技术过滤器 | 历史逻辑对比基线 |
| **`A_v2_24h` (主候选)**| 允许盘前/盘后/夜盘扫描 | 启用最新 A_v2 优化过滤闸门 | **当前择时与风控主对照方案** |

---

## 四、扫描时段与限价挂单纪律 (Timing & Order Type)

1. **核心扫描窗口**：
   - **夜盘与盘前窗口 (Overnight / Pre-Market)**：盘后静止数据避免了日内分时未收盘假突破的干扰，为批量扫描与体制计算的唯一规定窗口；
2. **限价挂单模式 (Limit Order Policy)**：
   - **中性贴盘限价 (Neutral Limit)**：严格以买一/卖一档位挂单等待被动成交；
   - **严禁市价追单 (Market Orders Prohibited)**：严禁以市价单扫盘，防范极端滑点。

---

## 五、系统定位与红线隔离 (System Boundary)

1. **定位**：本套系统作为**盘面结构参考与风控过滤器**，绝非黑盒全自动交易买卖系统；
2. **物理隔离**：本模块产出的所有状态与指标，独立写入 `data/runs/mrzhou_strategy/`，严禁回写 `l2a_order_candidates` 或直接推入券商实盘交易链路！
