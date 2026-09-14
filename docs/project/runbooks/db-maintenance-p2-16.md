# Runbook: P2-16 主库增长治理与定期维护 SOP (REQ-008)

> **对应需求**：`REQ-008`（P2-16 主库增长治理 ~867MB/VACUUM/清理策略）  
> **关联模块**：[`db-maintenance.js`](../../db-maintenance.js) · [`database.js`](../../database.js)  
> **关联规程**：[`docs/project/06-process.md`](../06-process.md) · [`docs/local-ops-mcp-skill-plan.md`](../../docs/local-ops-mcp-skill-plan.md)

---

## 1. 治理目标与现状背景

生产环境长期运行后，SQLite 主库文件 `whop_archive.db` 增长至近 ~867MB。经存储结构下钻分析，空间主要分布为：
1. **向量 BLOB 与图邻接表**（`message_embeddings`, `message_adjacency`）：占全库 60% 以上空间；
2. **消息历史与 FTS 全文索引**（`messages`, `messages_fts_*`）：随历史累积；
3. **临时产线与异步任务积压**（`task_queue`, `pipeline_tasks`, `ingest_events`）：包含大量已完成（`done`/`completed`）或失败（`failed`）的历史大 JSON payload，长期未做 TTL 淘汰；
4. **SQLite 碎片空间**（`freelist`）与 **WAL 缓冲积压**：SQLite 默认 `auto_vacuum = 0`，删除记录后页进入 freelist 而不会自动收缩物理文件；高频并发写也会导致 WAL 膨胀。

---

## 2. 数据生命周期保留策略（Retention Policy）

| 数据分类 | 表名 | 默认保留期 | 终态定义与清理规则 | 保护与例外约束 |
|----------|------|:----------:|-------------------|----------------|
| **AI 任务队列** | `task_queue` | 14 天 | 仅清理 `status IN ('done', 'completed', 'failed', 'cancelled')` | **严禁**清理 `pending`, `running`, `retry` |
| **ISR 产线任务** | `pipeline_tasks` | 14 天 | 仅清理 `status IN ('ok', 'done', 'completed', 'skipped', 'failed')` | **严禁**清理 `queue_name = 'l2b_cut'` 与 `status = 'paused'` |
| **入库事件日志** | `ingest_events` | 14 天 | 按 `created_ts` 清理超过 14 天历史事件 | 仅纯流水日志，不影响消息实体 |
| **孤儿向量/邻接**| `message_embeddings` / `message_adjacency` | 立即 | 清理外键关联失效（`messages.id` 不存在）的孤立记录 | 仅清理孤儿，合法记录 100% 保留 |
| **核心业务资产** | `messages`, `orders`, `positions`, `zhao_positions`, `follow_decisions`, `trade_review_pool` | **终身保留** | **坚决不删除** | **系统免疫红线**：脚本内置执行前/后行数断言，少一行即刻 Panic 回滚 |

---

## 3. 运维安全红线（不可侵犯）

1. **写锁避让**：线上繁忙（盘中开市时段）**禁止**直接执行全库阻塞式的 `VACUUM`。
2. **只读优先**：日常监控与状态诊断必须走 `readonly: true` 句柄或 `npm run db:stats`，严禁探查本身引发写锁争用。
3. **预演先行**：任何执行清理必须先走 `--dry-run` 打印拟清理行数，经核实后方可落地。
4. **业务账本零容忍**：赵哥持仓账本（`zhao_positions`）、个人跟单决策表（`follow_decisions`）、订单表（`orders`）严禁被任何维护脚本触碰。

---

## 4. 标准维护操作流程（SOP）

### Step 1: 存储状况只读审计（可在任意时段执行）

```bash
# 打印数据库物理体积、WAL 体积、Freelist 碎片、孤儿记录与 Top 表行数
npm run db:stats
```

预期输出示例：
```text
=================== DB STORAGE STATS ===================
Path: .../whop_archive.db
DB File Size: 268.42 MB
WAL File Size: 0 MB
Freelist: 15 pages (0.06 MB)
Journal Mode: wal | Auto Vacuum: 0
Orphans: 0 embeddings, 0 adjacency
...
```

### Step 2: 清理预演（Dry-Run 模式）

```bash
# 预演清理 14 天前的终态任务与孤儿记录（不修改数据库）
node db-maintenance.js --prune --days 14 --dry-run
```

- 确认 `pruned.task_queue`、`pruned.pipeline_tasks` 符合预期。
- 确认业务表受保护行数未报警。

### Step 3: 执行保留期修剪（Prune）与 WAL 截断

在系统低峰期（如非美股交易时间，周末或盘后）执行：

```bash
# 真实执行清理并截断 WAL
node db-maintenance.js --prune --days 14
```

### Step 4: 物理空间整理（可选，低峰期/维护窗口）

如果经 Step 3 后，`Freelist` 碎片达数十甚至数百 MB，且需将物理磁盘空间归还操作系统：

```bash
# 离线或低峰期执行 VACUUM（独占写锁约 1~5 秒）
node db-maintenance.js --vacuum
```

---

## 5. 故障排查与应急预案

- **SQLite Busy / Locked**：
  若在执行清理或 Checkpoint 时报错 `database is locked`，说明有未释放的长事务：
  1. 检查是否有未关闭的开发脚本或挂起的后台 worker；
  2. 脚本自带 15000ms `busy_timeout`，若仍超时则退出重试；
- **回滚保障**：
  清理动作仅针对终态日志表；核心账本有独立保护与只读视图。若有任何意外，依 `docs/project/runbooks/incident-rollback.md` 恢复最近一次本地或云端 SQLite 备份快照。
