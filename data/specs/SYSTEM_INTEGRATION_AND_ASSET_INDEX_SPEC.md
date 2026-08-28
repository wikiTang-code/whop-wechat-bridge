# 🏛️ 系统全局资产主索引与前后端架构重构规范 (System Integration & Asset Index Specification)

> **版本标识**：`SYS-INTEGRATION-V1`  
> **核心宗旨**：解决资产散落与粗糙重写的痛点——**建立统一主索引（Asset Index），将货架（日报渲染）与库存（L0原文/L1切窗/L2a订单/L2b原子）彻底解耦，收敛前端至“人机跟单”主路径**。

---

## 一、五层资产分层与真理链 (Five-Layer Truth Hierarchy)

| 资产层级 | 存储载体 | 核心角色与唯一定位 | 是否为真理源 | 复用与引用规则 |
| :--- | :--- | :--- | :---: | :--- |
| **L0 原始消息** | SQLite `messages` | 唯一不可变原始文本资产 | **唯一真理** | 必须带有 `message_id`, `speaker`, `ts_utc`, `ts_et` |
| **L1 切窗单元** | `context_units_*.jsonl` | 离散化对话抽取单元 (CU) | **真理切片** | 拥有唯一 `cu_id`，保留对 `message_ids` 映射 |
| **L2a 订单动作** | `l2a_order_candidates` 表 | 带价格、方向、仓位的确定性订单 | **交易候选** | 仅限大V主线，必须回指 `cu_id`，带 `parse_status` |
| **L2b 知识原子** | `gold_knowledge_atoms` / `data/l2b/*` | 剥离价格后仍成立的战法与纪律 | **风控/看盘闸门** | 必须回指 `kid`，大V为 `k_*`，群友为 `regime_*/combo_*` |
| **L3 衍生渲染** | 企微推送 / Dashboard 视图 / 日报 | 基于索引的即时渲染物 | **纯展示货架** | **禁止充当新数据源**，必须通过 `cu_id`/`kid` 查表渲染 |

---

## 二、统一资产主索引表设计 (Asset Index Schema)

在 SQLite 中新增统一索引表 `asset_index`，一条记录对齐全部上下游血缘：

```sql
CREATE TABLE IF NOT EXISTS asset_index (
    asset_id TEXT PRIMARY KEY,               -- 全局唯一资产 ID
    layer TEXT NOT NULL,                     -- L0 | L1 | L2a | L2b | L3
    speaker TEXT NOT NULL,                   -- 赵哥 | Mrzhoulucky | 其他
    cu_id TEXT,                              -- 所属 Context Unit ID
    message_ids TEXT,                        -- 关联合并的原始消息 IDs (逗号分隔)
    kids TEXT,                               -- 命中的 L2b 知识原子 IDs (JSON 数组)
    tickers TEXT,                            -- 关联标的列表 (JSON 数组, 如 ["TSLL"])
    created_at_utc TEXT NOT NULL,            -- ISO 标准时间
    created_at_et TEXT NOT NULL,             -- 美东交易时间
    parse_status TEXT NOT NULL,              -- success | empty_actions | failed | hint_only
    file_path TEXT,                          -- 物理落盘路径
    extra_meta TEXT                          -- 扩展元数据 (JSON)
);

CREATE INDEX IF NOT EXISTS idx_asset_cu ON asset_index(cu_id);
CREATE INDEX IF NOT EXISTS idx_asset_layer ON asset_index(layer);
CREATE INDEX IF NOT EXISTS idx_asset_speaker ON asset_index(speaker);
CREATE INDEX IF NOT EXISTS idx_asset_tickers ON asset_index(tickers);
```

---

## 三、旧 Markdown 报告“降维打标”规范

历史遗留的散落 Markdown 报告不重新调用 35B 重写，通过轻量扫描脚本执行一次性打标：

1. **`linked` (有效关联)**：
   - 能够精准提取出对应的 `message_id`、`cu_id` 或标准 `kid` 的报告，挂载外键入库，正文作为注释附件；
2. **`orphan_commentary` (孤儿评论)**：
   - 无法对齐原文或无复算公式的主观长文（如模糊讨论），统一归档至 `artifacts/commentary/archive/`，**禁止占用主知识库与 Dashboard 页面**。

---

## 四、前端 Dashboard 产品主路径收敛（人机跟单优先）

彻底剥离长文轰炸，UI 严格按照**交易决策流**由上至下排列：

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 账户持仓与可用资金 (FIFO 后的真实账户状态与收益看板)       │
├─────────────────────────────────────────────────────────────┤
│ 2. 今日 L2a 候选动作 (filled 实盘色 / planned 计划色 / 异常红条)│
├─────────────────────────────────────────────────────────────┤
│ 3. 待确认订单卡片池 (90s TTL 倒计时 / 人工一键确认 / 滑点拦截)│
├─────────────────────────────────────────────────────────────┤
│ 4. 命中的 L2b 战法闸门 (周五尾盘/急跌反弹/死区提示, 徽章区分) │
├─────────────────────────────────────────────────────────────┤
│ 5. 原文对话切窗 (折叠展示，点击展开核对原始发言)              │
├─────────────────────────────────────────────────────────────┤
│ 6. AI 深度简报 (最底部折叠区，默认关闭，纯前端即时渲染)       │
└─────────────────────────────────────────────────────────────┘
```

* **红线要求**：结构化抽取失败必须显式展示红色警报（`parse_status=failed`），**严禁用 AI 散文虚饰掩盖抽取失败**！

---

## 五、在线交易引擎 (A+B) 与离线研究底座 (C) 的物理硬隔离

```
  【在线生产链路 (Server A+B)】                 【离线研究链路 (Worker C)】
  Whop 轮询 ──> 写入 SQLite (L0)               历史 CU ──> 7900 XT 单卡
       │                                            │
       ▼                                            ▼
  切窗 (L1) ──> 本地 14B (温度0, JSON Schema)    L2a 夜跑 / L2b 知识重构
       │                                            │
       ▼                                            ▼
  风控闸门 (90s/40bp) ──> 沙盒/实盘确认卡片     产物写入 data/runs/
       │                                            │
       ▼                                            ▼
  企微推送 (极简行动卡片)                        Harness 严格评测报告
```

1. **进程隔离**：`server.js` 仅处理在线轮询、Web UI 与交易跟单，研究批处理（如 1,195 组夜跑）运行在独立 Worker 进程中；
2. **数据库锁保护**：离线研究任务禁止向 `orders`、`follow_decisions` 等实盘交易表写入任何虚拟数据；
3. **模型分工明确**：
   - 生产环境：本地 14B 只输出结构化 JSON，长文日报改为基于 `asset_index` 的纯模板填充，**零额外大模型推理开销**！
