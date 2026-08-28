# 📊 L2a 实盘成交流水对账技术规范 (L2a Reconcile Spec)

## 一、核心原则
本规范定义了从大V广播消息中抽取的订单候选（`l2a_order_candidates`）与券商经纪商（长桥 Longbridge 等）真实成交流水（`broker_fills`）之间的 1:1 自动化精确撮合对账机制。

**铁律：**
1. **只读对账**：对账过程为纯只读分析，严禁回写或修改候选表字段；
2. **严禁造假**：缺少真实长桥成交流水文件或数据库表时立即报错退出，严禁生成虚拟成交假数据；
3. **一对一独占抢单**：单笔 Broker 成交单只能与最贴近的一笔 KOL 指令撮合，不可重复占用。

---

## 二、匹配判定硬指标

### 1. 标的匹配 (Ticker Identity)
- 经过别名归一后必须完全全等：
  - `CFIR` $\rightarrow$ `CIFR`
  - `奈飞双倍` / `NFLX` $\rightarrow$ `NFXL`
  - `特斯拉两倍` $\rightarrow$ `TSLL`
  - `微策略两倍` $\rightarrow$ `MSTX`
  - `COIN两倍` $\rightarrow$ `CONL`

### 2. 价格容差 (Price Tolerance)
- **正股 (Stock)**：
  $$\Delta P \le \max(0.05, P_{\text{broker}} \times 0.8\%)$$
- **期权权利金 (Option)**：
  $$\Delta P \le \max(0.08, P_{\text{broker}} \times 3.0\%)$$
- 若大V指令中 `price == null`（如点名低吸/市价跟进），只要标的与方向在时间窗口内匹配，直接归为点位模糊命中。

### 3. 时间窗口 (Time Window)
- **`status: filled`（明确已成交指令，如加了/出了）**：
  $$t_{\text{broker}} \in [t_{\text{kol}} - 20\text{min},\; t_{\text{kol}} + 4\text{h}]$$
- **`status: planned`（计划挂单/关注提示，如可以挂/回踩吸）**：
  $$t_{\text{broker}} \in [t_{\text{kol}},\; t_{\text{kol}} + 2\text{个交易日收盘}]$$

### 4. 方向对应 (Trade Side)
- KOL `BUY` $\leftrightarrow$ Broker `BUY`
- KOL `SELL` / `STOP_LOSS` / `TAKE_PROFIT` $\leftrightarrow$ Broker `SELL`

---

## 三、五大对账状态机 (Reconciliation States)

| 状态枚举 | 业务含义 | 评估定性 |
| :--- | :--- | :--- |
| `MATCH_FILLED` | KOL 喊已成交，且在 4 小时窗口内找到真实成交记录 | 🟢 **实盘完美吻合 (高置信跟随)** |
| `MATCH_PLANNED_LATER` | KOL 提示计划挂单，随后在 2 个交易日内触发真实成交 | 🟢 **挂单成功触发** |
| `KOL_ONLY` | KOL 喊单但无实盘流水。<br>• 若为 `planned`：正常基线（未达到买点）<br>• 若为 `filled`：**跟单遗漏或撤单** | 🟡 **需人工抽检核实** |
| `BROKER_ONLY` | 实盘有成交记录，但大V广播频道无对应发言 | ⚠️ **自主交易 / 私自操作** |
| `AMBIGUOUS_MULTI` | 存在多笔相近价格/时间的撮合候选，无法唯一归因 | 🔍 **进入待人工仲裁池** |

---

## 四、对账统计指标定义

1. **大V喊单跟单率 (Follow-Through Rate)**：
   $$\text{Follow-Through} = \frac{\text{MATCH\_FILLED}}{\text{Total KOL FILLED Actions}}$$
2. **挂单成交率 (Planned Trigger Rate)**：
   $$\text{Trigger Rate} = \frac{\text{MATCH\_PLANNED\_LATER}}{\text{Total KOL PLANNED Actions}}$$
3. **自主交易比例 (Discretionary Rate)**：
   $$\text{Discretionary Rate} = \frac{\text{BROKER\_ONLY}}{\text{Total Broker Fills}}$$
