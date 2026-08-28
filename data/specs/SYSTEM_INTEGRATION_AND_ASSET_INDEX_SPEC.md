# 🏛️ 系统全局资产主索引与前后端架构重构规范 (V1.1 严格勘误版)

> **版本标识**：`SYS-INTEGRATION-V1.1-ERRATA`  
> **核心纠偏**：
> 1. **解耦资产血缘与交易阶段**：资产展示层正式更名为 `view`（禁止叫 L3），另立 `exec` 策略融合执行层；
> 2. **L2a 降级为候选动作**：明确为 `候选动作 (Candidate Actions)`，默认不可下单，须经 `exec` 放行；
> 3. **枚举对齐**：`parse_status` 统一复用 envelope 的 `ok | failed | human_verified`；
> 4. **风控标注**：90s TTL / 40bp 滑点带标注为 `unverified_default` 工程默认值。

---

## 一、资产血缘与交易执行分层解耦 (Hierarchy & Execution Separation)

### 1. 资产血缘分层 (Asset Lineage: raw -> cu -> envelope -> atom -> view)

| 资产层级 (Layer) | 存储载体 | 核心角色与唯一定位 | 是否为真理源 | 复用与引用规则 |
| :--- | :--- | :--- | :---: | :--- |
| **`raw` (L0)** | SQLite `messages` | 唯一不可变原始文本资产 | **唯一真理** | 必须带有 `message_id`, `speaker`, `ts_utc`, `ts_et` |
| **`cu` (L1)** | `context_units_*.jsonl` | 离散化对话抽取单元 (CU) | **真理切片** | 拥有唯一 `cu_id`，保留对 `message_ids` 映射 |
| **`envelope` (L2a)** | `l2a_order_candidates` 表 | 提取自对话的**候选动作 (Candidate Actions)** | **待审候选** | 默认不可下单，回指 `cu_id`，`parse_status` 为 `ok/failed/human_verified` |
| **`atom` (L2b)** | `gold_knowledge_atoms` / `data/l2b/*` | 剥离价格后仍成立的战法与纪律 | **风控/看盘闸门** | 必须回指 `kid`，大V为 `k_*`，群友为 `regime_*/combo_*` (hint_only) |
| **`view` (展示物)** | 企微卡片 / Dashboard 视图 / 日报 | 基于主索引的只读即时渲染物 | **纯展示货架** | **禁止充当新数据源与策略定义**，纯前端模板填充 |

---

### 2. 交易执行阶段 (Trading Pipeline: envelope + atom + FIFO -> exec -> fill)

```
       ┌─────────────────┐       ┌─────────────────┐
       │ L2a 候选动作    │       │ L2b 战法/纪律   │
       │ (envelope)      │       │ (atom)          │
       └────────┬────────┘       └────────┬────────┘
                │                         │
                └───────────┬─────────────┘
                            │ 注入账户实时状态
                            ▼
                ┌─────────────────────────────────────────────────────────────┐
                │ 【exec 策略融合执行层 (Strategy Execution)】                  │
                │  • 输入: L2a candidate + L2b atom + FIFO 账户持仓与可用资金    │
                │  • 机制: 90s TTL / 40bp 滑点带 (标记为 unverified_default)  │
                │  • 输出: 待确认卡片池 (默认人点确认) / 拒单原因 / 模拟仓放行    │
                └─────────────────────────────┬───────────────────────────────┘
                                              │
                                              ▼
                ┌─────────────────────────────────────────────────────────────┐
                │ 【fill 成交与对账层】                                         │
                │  • 券商实盘成交认领 (无流水 exit 2 阻断)                     │
                └─────────────────────────────────────────────────────────────┘
```

---

## 二、统一资产主索引表设计 (Asset Index Schema)

在 SQLite 中维护统一索引表 `asset_index` 与标的辅助索引表 `asset_index_ticker`：

```sql
-- 1. 主资产索引表
CREATE TABLE IF NOT EXISTS asset_index (
    asset_id TEXT PRIMARY KEY,               -- 全局唯一资产 ID
    layer TEXT NOT NULL,                     -- raw | cu | envelope | atom | view
    speaker TEXT NOT NULL,                   -- 赵哥 | Mrzhoulucky | 其他
    cu_id TEXT,                              -- 所属 Context Unit ID
    message_ids TEXT,                        -- 关联合并的原始消息 IDs
    kids TEXT,                               -- 命中的 L2b 知识原子 IDs
    tickers TEXT,                            -- 关联标的列表 (JSON 数组)
    created_at_utc TEXT NOT NULL,            -- ISO 标准时间
    created_at_et TEXT NOT NULL,             -- 美东交易时间
    parse_status TEXT NOT NULL,              -- ok | failed | human_verified
    action_count INTEGER DEFAULT 0,          -- 提取出的动作数量
    file_path TEXT,                          -- 物理落盘路径
    extra_meta TEXT                          -- 扩展元数据 (JSON)
);

-- 2. 标的辅助索引表（解决 JSON TEXT 无法高效检索单个 Ticker 的问题）
CREATE TABLE IF NOT EXISTS asset_index_ticker (
    asset_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    PRIMARY KEY (asset_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_asset_cu ON asset_index(cu_id);
CREATE INDEX IF NOT EXISTS idx_asset_layer ON asset_index(layer);
CREATE INDEX IF NOT EXISTS idx_asset_speaker ON asset_index(speaker);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_index(parse_status);
CREATE INDEX IF NOT EXISTS idx_ticker_lookup ON asset_index_ticker(ticker);
```

---

## 三、前端 Dashboard 决策流主路径收敛

UI 严格按照**交易决策流**由上至下排列：

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 账户持仓与现金 (FIFO 后的真实账户状态与收益看板)           │
├─────────────────────────────────────────────────────────────┤
│ 2. 今日 L2a 候选动作 (filled 实盘色 / planned 计划色 / 异常红条)│
├─────────────────────────────────────────────────────────────┤
│ 3. exec 待确认池 (90s TTL 倒计时 / 人工一键确认 / 滑点拦截)    │
├─────────────────────────────────────────────────────────────┤
│ 4. 命中的 L2b 闸门 (周五尾盘/急跌反弹/死区提示, 仅作风控徽章)  │
├─────────────────────────────────────────────────────────────┤
│ 5. 原文对话切窗 (折叠展示，点击展开核对原始发言)              │
├─────────────────────────────────────────────────────────────┤
│ 6. view 简报区 (最底部折叠区，默认关闭，纯前端即时渲染)        │
└─────────────────────────────────────────────────────────────┘
```

* **红线要求**：模型结构化抽取失败必须在第二栏显式展示红色警报（`parse_status=failed`），**严禁用 view 散文掩盖抽取失败**！

---

## 四、在线生产与离线研究物理硬隔离

1. **进程隔离**：`server.js` 仅处理在线轮询、Web UI 与交易跟单，研究批处理（如 1,195 组夜跑）运行在独立 Worker 进程中；
2. **数据库锁保护**：离线研究任务禁止向 `orders`、`follow_decisions` 等实盘交易表写入任何虚拟数据；
3. **风控参数属性**：`90s TTL` 与 `40bp 滑点拒单` 属于 `exec` 层的 **工程默认安全参数 (unverified_default)**，绝不混淆为大V原语。
