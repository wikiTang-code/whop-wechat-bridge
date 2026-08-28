# 📐 Stage 1: 核心盘口与衍生品指标配方规范 (STAGE1 Indicator Recipes)

> **版本标识**：`STAGE1-RECIPES-V1`  
> **数据基准**：严格基于已落盘的 1,447 条真实教材记录（`data/curriculum/mrzhou/messages.jsonl`）与周哥（`user_HnSG7BJWMTfDz`）纪律配文反编译提取，严禁人工凭空编造未出现的分档。

---

## 一、PCR (Put/Call Ratio) 情绪指标配方

### 1. 计算公式
$$\text{PCR} = \frac{\sum \text{Volume}_{\text{Put}}}{\sum \text{Volume}_{\text{Call}}} \quad \text{或} \quad \text{PCR}_{\text{OI}} = \frac{\sum \text{OI}_{\text{Put}}}{\sum \text{OI}_{\text{Call}}}$$

### 2. 真实分档判定规则（基于教材文本提取）

| PCR 数值区间 | 语义标签 | 市场状态与风控含义 |
| :--- | :--- | :--- |
| $\text{PCR} < 0.85$ | **偏进攻 (Bullish / Risk-On)** | 市场看涨期权占比高，多头情绪活跃 |
| $0.85 \le \text{PCR} \le 1.15$ | **均衡 (Neutral / Balanced)** | 多空力量相当，如教材样本 `PCR 0.98（均衡）` |
| $\text{PCR} > 1.15$ | **偏防守 (Bearish / Risk-Off)** | 市场避险对冲买 Put 激增，防范破位风险 |

---

## 二、期权墙 (Option Wall) 支撑与阻力位算法

### 1. 扫描与候选窗口
- 以标的当前现价 $P_{\text{current}}$ 为基准，限定扫描区间为 **$[0.85 \times P_{\text{current}},\; 1.15 \times P_{\text{current}}]$**（即现价 $\pm 15\%$）；
- 标的到期日筛选：默认取最近活跃交割月（近期主合约）。

### 2. 核心点位提取公式
- **上行 Call 墙 (Call Wall / 强阻力位)**：
  $$\text{Strike}_{\text{CallWall}} = \arg\max_{K \in [P_{\text{current}}, 1.15 P]} \text{OI}_{\text{Call}}(K)$$
  * 含义：上方最大 Call 未平仓行权价，做市商在此位置存在强烈的卖压与 Gamma 压制。
- **下行 Put 墙 (Put Wall / 强支撑位)**：
  $$\text{Strike}_{\text{PutWall}} = \arg\max_{K \in [0.85 P, P_{\text{current}}]} \text{OI}_{\text{Put}}(K)$$
  * 含义：下方最大 Put 未平仓行权价，做市商在此位置存在正 Gamma 护盘支撑。

---

## 三、行情体制分类矩阵 (Market Regime Matrix)

### 1. 两个基础输入变量
1. **大盘趋势动量 (SPY 20d)**：$\text{SPY}_{20d} = \frac{\text{SPY}_{\text{today}} - \text{SPY}_{20\text{d ago}}}{\text{SPY}_{20\text{d ago}}} \times 100\%$
2. **大盘波动率指数 (VIX)**：当前实际读数（如 $18.0$）

### 2. 四象限体制划分与模型适性

| 象限 | 条件组合 | 官方体制名称 | 模型适性与决策原则 |
| :--- | :--- | :--- | :--- |
| **Q1** | $\text{SPY}_{20d} \ge 0\%$ 且 $\text{VIX} < 20$ | **牛市 × 低/中波动** | 🟢 **模型进攻区**：趋势明确，回踩支撑可积极做多 |
| **Q2** | $\text{SPY}_{20d} < 0\%$ 且 $\text{VIX} < 20$ | **震荡市 × 中波动** | 🟡 **模型中性区**：教材样本状态（如 `SPY20d -2.6% · VIX 18.0`），按关键位区间高抛低吸 |
| **Q3** | 任意动量 且 $20 \le \text{VIX} < 30$ | **高波动洗盘市** | ⚠️ **模型观察区 (Watch)**：容易频繁破位与双杀，仓位减半 |
| **Q4** | $\text{VIX} \ge 30$ (极端恐慌) | **高磨损死区 (Death Zone)** | 🔴 **优先观望 (Hold Cash)**：双倍 ETF 磨损极大，系统关闭自动下单 |

---

## 四、分档限价建议 (Price Tiering) 规范

### 1. 字段语义
- **命中价格 (Hit Price)**：信号触发瞬间的即时盘口价；
- **建议价格 (Suggested Price)**：经过买一/卖一与点位缓冲区修正后的挂单限价。

### 2. 三档限价挂单等级规范

| 等级名称 | 挂单逻辑与溢价设计 | 适用场景 |
| :--- | :--- | :--- |
| **中性 (Neutral)** | 挂在当前买一/卖一档位附近（如教材中 `命中 706.70 -> 建议 706.66`） | 默认基准（本快照样本 840/840 均为此档） |
| **保守 (Conservative)** | 挂在更深支撑位 / 缓冲下沿，要求更厚安全垫 | 震荡市或高波动市 Q3/Q4 |
| **激进 (Aggressive)** | 直接贴近现价对价挂单，快速促成成交 | 突破确定性极高的 Q1 牛市 |

---

## 五、周哥策略纪律（来自配文提炼）

1. **运行窗口纪律**：盘中实时计算易受分时假突破噪音干扰，**官方规定核心扫描与生成窗口为夜盘与盘前**；
2. **资金与风险上限**：单笔名义本金 1 万美金，最大并发重叠持仓 $\le 3$ 笔；
3. **定位原则**：本系统作为**客观盘面结构与风控过滤器**，绝非黑盒全自动盲从工具。
