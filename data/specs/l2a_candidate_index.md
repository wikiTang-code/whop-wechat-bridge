# 🗄️ L2a 扁平候选订单表与索引设计规范 (Candidate Index)

## 一、候选存储架构
为了支撑毫秒级高频对账与跨窗检索，L2a 输出采用两级存储：
1. **原始 CU 级 JSONL**：`data/runs/l2a_broadcast_candidates_1195.jsonl`（保留完整 raw_text、claims、latency 等）；
2. **扁平 Action 关系表**：`l2a_order_candidates`（在 SQLite 中支持按标的、时间窗口、买卖方向索引）。

---

## 二、扁平索引结构定义 (SQLite / Postgres)

```sql
-- 扁平候选动作表
CREATE TABLE IF NOT EXISTS l2a_order_actions_flat (
  action_id TEXT PRIMARY KEY,       -- 例如: cu_trade_00001_act_1
  cu_id TEXT NOT NULL,              -- 关联源 CU
  ticker TEXT NOT NULL,             -- 标准化交易代码 (大写)
  action TEXT NOT NULL,             -- BUY, SELL, STOP_LOSS, TAKE_PROFIT
  status TEXT NOT NULL,             -- filled, planned
  price REAL,                       -- 目标/成交价 (可为空)
  instrument_type TEXT NOT NULL,    -- stock, option
  timestamp_ms INTEGER NOT NULL,    -- 毫秒 UTC 时间戳
  et_date TEXT NOT NULL,            -- 美东日期 (YYYY-MM-DD)
  created_at INTEGER NOT NULL
);

-- 高频对账复合索引
CREATE INDEX IF NOT EXISTS idx_l2a_reconcile ON l2a_order_actions_flat (ticker, timestamp_ms, action);
CREATE INDEX IF NOT EXISTS idx_l2a_date_ticker ON l2a_order_actions_flat (et_date, ticker);
```
