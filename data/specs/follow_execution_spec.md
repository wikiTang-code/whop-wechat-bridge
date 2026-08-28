# 🛡️ 智能跟单执行层技术规范与风控闸门 (Follow Execution Spec)

## 一、三层体系与责任边界 (Three-Layer Architecture)

```
[Layer 1: L2a 语义抽取] 
       │ 识别大V口头动作 (ticker, action, price, status: filled/planned)
       ▼ 只写候选库
[Layer 2: 事后对账审计] 
       │ 0.8% 宽容差，用于事后认领真实流水，纯只读
       ▼ 独立审计报告
[Layer 3: 实时跟单执行] (本规范所辖)
       │ 严格滑点带 (40bp) + TTL (90s) + 账户隔离
       ▼
  ┌───────────────────────┬────────────────────────┐
  ▼                       ▼                        ▼
[模拟仓 (Paper)]    [真仓确认卡片 (Real)]     [回放回测 (Backtest)]
 自动限价跟单        90s 人工超时放弃          1195 历史候选盘口回放
```

---

## 二、五大跟单执行状态机 (Execution States)

| 状态代码 | 触发条件 | 动作与风控 |
| :--- | :--- | :--- |
| `FIRE` | 消息到达时间 $\le \text{TTL}$ 且现价滑点 $\le 20\text{bp}$ | 🟢 **全额限价下单**（以喊单价或喊单价+带边挂单，严禁市价追单） |
| `SIZE_DOWN` | 现价滑点在 $(20\text{bp}, 40\text{bp}]$ 之间，或方向略有不利 | 🟡 **仓位减半 (1/2)** 或仅平已有仓位，不开新仓 |
| `SLIP_REJECT` | 现价滑点 $> 40\text{bp}$ (0.4%) 或突破安全边界 | 🔴 **坚决拒单**，放弃本笔交易，不追高/杀跌 |
| `EXPIRED` | 消息接收时距离大V发言时间 $> 90\text{秒}$ (现价单) | ⏱️ **超时失效**，判定为陈旧消息，直接废弃 |
| `SKIP_NO_POS` | 大V发出减仓/清仓指令，但当前账户中并无该标的持仓 | ⚪ **直接跳过**，无底仓可出 |

---

## 三、双账户物理隔离与准入红线 (Account Isolation & Gates)

### 1. 模拟账户 (Paper Account)
* **执行方式**：过 TTL 与滑点带后自动限价委托；
* **准入评估**：必须连续运行 $\ge 20$ 个交易日，统计真实跟踪误差；
* **合格指标**：抽取方向准确率 $\ge 97\%$，标的代码准确率 $\ge 99\%$，模拟成交方向与大V一致。

### 2. 真实账户 (Real Account)
* **执行方式**：**严禁全自动下单通道，严禁“一键全跟”开关**；
* **卡片交互**：向客户端推送「待确认交易卡片」：
  * 显示：代码、方向、喊单价、当前市价、滑点 bp、TTL 倒计时 (90s)；
  * 操作：人工点击「确认下单」或「放弃」；
  * **默认超时**：90 秒无操作自动判定为 `SKIP_MANUAL_TIMEOUT` 并销毁卡片；
* **权限安全**：真实券商 API Key 绝不挂载至大模型推理进程，真仓 Client 默认配置 `dry_run=true`。

---

## 四、独立数据表结构 (follow_decisions)

```sql
CREATE TABLE IF NOT EXISTS follow_decisions (
  decision_id TEXT PRIMARY KEY,       -- 决策唯一编号 (如 dec_cu_001_1)
  action_id TEXT NOT NULL,           -- 关联的 L2a 候选 Action
  cu_id TEXT NOT NULL,               -- 关联的 Context Unit
  account_type TEXT NOT NULL,        -- paper (模拟) / real (真仓)
  decision_state TEXT NOT NULL,      -- FIRE / SIZE_DOWN / SLIP_REJECT / EXPIRED / SKIP_NO_POS
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,                -- BUY / SELL
  call_price REAL,                   -- 大V喊单价
  arrival_price REAL,                -- 收到消息时的盘口现价
  slip_bps REAL,                     -- 滑点基点 (bp)
  ttl_remaining_sec REAL,            -- 剩余有效时间 (秒)
  executed_qty INTEGER,              -- 实际跟单股数
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_follow_action ON follow_decisions (action_id);
CREATE INDEX IF NOT EXISTS idx_follow_state ON follow_decisions (decision_state);
```
