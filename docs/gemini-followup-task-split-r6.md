# R5 复核结论 + Round 6（Cursor，`ecac0a8`）

> 日期：2026-09-05。本地 T20/T21 相关单测 PASS。生产仍为单体，**未批准灰度**。

## 总评

| 任务 | 判定 | 说明 |
|---|---|---|
| T20 前端契约形状 | **通过（形状层）** | config.data / messages 过滤 / proxy-image / context / quant / gpu.data / monitor 键名已对齐 |
| T21 Runbook / mock / Tunnel 说明 | **通过** | §6 已修；ingest 单测默认 mock；Tunnel 前置说明有 |
| T22 Basic Auth | **保留通过** | `dashboard-basic-auth` 仍挂在 `web_runner` |
| **只读铁律（架构）** | **未通过（阻断）** | 见下 |

**结论：T20 契约「看起来像现网」，但 Web 进程已退化为对 `whop_archive.db` 的可写连接使用者。双进程灰度会破坏「ingest 单写 / web 只读」铁律。未关闭 T23 前禁止切灰。**

---

## 阻断：T23 — 恢复真正的 `{ readonly: true }` 读面

### 证据

`monitoring/readonly-api-router.js` 现：

- `import { getDb, getMessages, getMessageContext, … } from '../database.js'`
- 多处直接 `const db = getDb()`（speakers / news status / persona status / system monitor）
- `getMessages` / `getReports` / `getMessageContext` / `getLastSyncTime` 内部一律 `getDb()`

而 `database.js` 的 `getDb()` → `initDb()`：

- 以**默认可写**打开 SQLite
- 启动路径含大量 `CREATE TABLE IF NOT EXISTS` / index（schema 写）

这与设计文档及 T12 铁律冲突：

> Web 必须通过 `getReadOnlyArchiveDb()`（`readonly: true`）读主库；禁止打开第二写者。

后果（切双进程后）：

1. Web + Ingest **双连接可写**同一 `whop_archive.db` → 锁竞争 / `SQLITE_BUSY` / 偶发写入风险  
2. Web 启动可能跑 `initDb` schema 语句（与 ingest 抢写）  
3. 单测只验 HTTP 形状与 403，**未验** web 路由句柄是否 `readonly`

### 要求（验收）

1. `readonly-api-router.js` **禁止**调用裸 `getDb()`。  
2. 给 `getMessages` / `getMessageContext` / `getReports` / `getDistinctChannels` / `getNewsSummaries` / `getLastSyncTime` / `getOrders` / `getLatest*` 增加可选 `dbInstance`（默认仍 `getDb()`，兼容 ingest/单体）。  
3. 只读路由一律传入 `getReadOnlyArchiveDb()`；若 UDF（`has_image` 等）缺失，在 `db-readonly.js` 打开时注册只读安全 UDF（不写库）。  
4. `getUnifiedPortfolio` / `getUnifiedPositions`：mock 模式走只读库查询；或抽只读包装，禁止为看板打开写连接。  
5. 新增单测：启动 web 路由打 `/api/messages` 后，断言所用 archive 句柄对 `INSERT` 抛 `SQLITE_READONLY`（或断言 `readonly-api-router` 源码不含 `getDb(`）。  
6. `test_web_runner` 瘦入口自检：禁止 `readonly-api-router` 依赖可写 `getDb` 路径（可扫 import/调用）。

---

## 次要（可与 T23 同轮）

| 项 | 说明 |
|---|---|
| Runbook | 切灰验收补：`DASHBOARD_USERNAME/PASSWORD` 已配置；无 Auth + `ENABLE_TUNNEL=1` 禁止上线 |
| 内存 | web 拉入 `database.js` + `trading.js` 增大 RSS；958MB 机上观察双进程合计是否仍 ≤200MB |
| `news-summaries/status` | 现网有 `success` 字段；只读仅 `{status}`（frontend 目前只用 status，低优） |

---

## 给 Gemini 顺序

**T23（P0）→ 可选文档/Runbook 补 Auth 检查 → 提灰度申请。**

T22 Auth **不要回滚**。生产 `ecosystem.config.cjs` 仍禁止替换。
