# P1-11: Web 看板与 Ingest 物理多进程隔离方案设计稿

> **设计性质**：架构设计审定稿（**禁止直接改 `ecosystem.config.cjs` 上生产，须经评审通过后另开分支落地**）。  
> **基线环境**：GCP VM (958MB RAM, 1 vCPU, PM2, SQLite WAL)  
> **修订**：2026-09-05 Cursor 评审后修订（心跳落点 / tick 心跳 / monitoring 单写 / 瘦入口 / 回滚命令）。  
> **配套基线**：`docs/p1-11-split-inventory-baseline.md`

---

## 1. 架构拆分动机与收益

### 1.1 现状隐患（单进程痛点）
当前 `server.js` 是一个重型单一进程（单 Event Loop）：
- **事件循环串扰**：Whop 轮询、入库切片、媒体下载、AI 与 Express `/health` 同线程。
- **故障蔓延**：ingest 阻塞 → 看板与看门狗同时失明。
- **内存限额粗**：单体 `max_memory_restart: 500M` 靠近 OOM 边缘（主机仅 958MB）。

### 1.2 拆分后收益
1. Ingest 阻塞不拖死 Web `/health` 与看板。
2. SQLite WAL 单写多读。
3. 两进程稳态合计目标 **≤ 200MB**（硬上限建议 **&lt; 220MB**）。

---

## 2. 进程清单与职责所有权矩阵

| 职责维度 | `whop-ingest-worker` | `whop-web-dashboard` |
|---|---|---|
| **入口** | `scripts/ingest_runner.js`（**瘦入口，禁止整树 import server.js**） | `scripts/web_runner.js` 或裁剪后的 `server.js`（`ROLE=web_dashboard`） |
| Whop 轮询 / 推送 / 跟单 | ✅ 独占 | ❌ |
| `task_queue` worker | ✅ 独占 | ❌ 只读查状态 |
| 主库 `whop_archive.db` | ✅ 唯一写者 | 🔒 `{ readonly: true }` |
| Express `:8085` + Tunnel | ❌ | ✅ 独占 |
| event-loop / AI tunnel / Supervisor | ✅ ingest 侧体征 | Web 只聚合对外 `/health` |
| `gpuLock` | ✅ 仍挂 ingest（内存态；跨进程需求另议，958MB 不引入 Redis） | ❌ |
| Cloudflare Tunnel | ❌ | ✅ |
| `monitoring.db` | ✅ **唯一写者**（采样 + 心跳 + 边沿事件） | 🔒 **只读** |

---

## 3. 958MB 内存预算

```
应用合计硬目标: ≤ 200MB（警戒 220MB）
  ├── ingest: 稳态 90–120MB；PM2 max_memory_restart 180M（内存熔断重启属既有模式，告警看门狗仍不自动 restart）
  └── web:    稳态目标 50–80MB；PM2 max_memory_restart 130M
OS + PM2 + logrotate + page cache: 其余
```

### 3.1 瘦入口硬约束（评审必达）
- **禁止** web 进程顶层 `import` `persona-engine` / `news-engine` 重型路径；用动态 import 或拆 `routes/*` + `db-readonly.js`。
- ingest 入口只拉：`monitor.syncAndAnalyze`、`task-queue`、推送/跟单、monitoring 写侧。
- 灰度验收：两进程 RSS 合计连续 1h **&lt; 220MB**，否则回滚。

### 3.2 降级砍刀（ingest &gt; 140MB）
挂起次要媒体深处理 / 降低 worker 并发；**不**在看门狗里 `pm2 restart`。

---

## 4. SQLite WAL 与 monitoring 单写

### 4.1 主库
- 仅 ingest 读写打开；web `readonly: true` + `busy_timeout`。
- `PRAGMA journal_mode=WAL; synchronous=NORMAL;`

### 4.2 `monitoring.db`（修订）
- **单写多读**：只有 ingest（或唯一 Supervisor 宿主）写入 `metric_samples` / `health_events` / **ingest 心跳**。
- web **只读**聚合进 `/health` 与未来看板 API。
- 禁止两进程同时写 monitoring.db（避免写锁互啄）。

---

## 5. 看门狗与跨进程假死感知（修订）

### 5.1 心跳落点（禁止写业务水位表）
**不要**写入 `pipeline_watermarks`（避免污染 `wm_*` 语义）。

任选其一（实现优先 A）：
- **A. `monitoring.db` 表 `ingest_heartbeat(key PRIMARY, updated_at_ms, detail_json)`**
- **B. 本机文件** `data/ingest_heartbeat.json`（atomic rename）

### 5.2 心跳时机（修订）
在 **每一轮 poll tick 结束** 更新（成功 / 失败 / `isSyncing` 跳过均更新），字段区分：
```json
{ "at": 169..., "outcome": "ok|error|skipped", "pollMs": 1234 }
```
禁止「仅 sync 成功才跳表」——否则失败风暴会误 503。

### 5.3 Web `/health` 状态机
读取只读心跳：
- `delay < 90s` → ingest `ok`（覆盖 60s 温和轮询 + 抖动）
- `90s ≤ delay < 180s` → `warn`（覆盖背压 120s 档）
- `delay ≥ 180s` → ingest `critical`，整体 `/health` **HTTP 503**

外部 bash 看门狗仍打 8085；**只告警、不 restart**（R1/R2）。

---

## 6. ecosystem 样例（落地分支再用，本文不改生产文件）

```javascript
module.exports = {
  apps: [
    {
      name: 'whop-ingest-worker',
      script: 'scripts/ingest_runner.js',
      max_memory_restart: '180M',
      env: { NODE_ENV: 'production', ROLE: 'ingest_worker' },
      error_file: './logs/ingest_error.log',
      out_file: './logs/ingest_out.log',
    },
    {
      name: 'whop-web-dashboard',
      script: 'scripts/web_runner.js',
      max_memory_restart: '130M',
      env: { NODE_ENV: 'production', ROLE: 'web_dashboard', PORT: '8085', READONLY_MODE: '1' },
      error_file: './logs/web_error.log',
      out_file: './logs/web_out.log',
    },
  ],
};
```

启动顺序：先 ingest，再 web。

---

## 7. 回滚 Runbook（修订：禁止 `pm2 delete all`）

```bash
# 只拆目标 app，保留 pm2-logrotate 等模块
pm2 delete whop-ingest-worker whop-web-dashboard
pm2 start ecosystem.config.cjs --only whop-wechat-bridge
# 若单体仍用旧 ecosystem 单 app：
# pm2 start server.js --name whop-wechat-bridge --max-memory-restart 500M
pm2 save
```

回滚触发：SQLite lock 异常、合计 RSS &gt; 240MB、推送 TTL 恶化。

兼容策略：无 `ROLE` 时行为等于今日单体 `server.js`。

---

## 8. 实施路线

- [x] T2 设计（含本修订）
- [ ] 分支 `feat/p1-11-multiprocess`：瘦入口 + 心跳 + ROLE 门控
- [ ] 本地内存/只读锁测试
- [ ] GCP 文件拷贝灰度 24h，看门狗与推送回归后再切正式 ecosystem
