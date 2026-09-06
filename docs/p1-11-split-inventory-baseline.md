# P1-11 拆分前置：职责清单 + 线上基线（Cursor 采集，供 Gemini T2 设计用）

> **性质**：只读盘点 + 基线，**不是**实现方案，不改 `ecosystem.config.cjs`。  
> **采集时间**：2026-09-05 约 16:35 Asia/Shanghai（GCP 重启后约 4 分钟稳态）。  
> **代码基线**：`feat/p1-attachments-and-ratelimiter`（含 `2075832` News 休市免检）。

---

## 1. 线上内存基线（硬约束输入）

| 指标 | 值 | 备注 |
|---|---|---|
| 主机物理内存 | **958 MB** | 极限小内存 |
| 系统 available | ~403 MB | `free -m` |
| 主进程 PM2 RSS（/health） | **96 → 119 MB** | 重启后爬升；仍远低于 `max_memory_restart=500M` |
| pm2-logrotate | ~18 MB | 另计 |
| 当前会话 | uptime 短（刚重启验证 News 免检）、`unstable_restarts=0` | `restarts=88` 为累计勿误读 |
| `/health` | `ok: true` | News=`休市空窗免检（未生成）` |

**设计红线建议（给 T2）**：两进程稳态 RSS **合计建议 &lt; 220 MB**；若 web 再拉起 Express+static+只读 DB，ingest 仍跑 poller+queue，合计很容易顶到 200MB+，需砍依赖。

---

## 2. 当前单进程启动时序（`server.js` listen 回调）

顺序（同 PID）：

1. `app.listen(PORT)` — Express 看板 + 全部 `/api/*` + `/health`
2. `startPoller()` — 自适应轮询 → `syncAndAnalyze` + Auto News + Auto Persona 触发
3. `startEventLoopProbe`
4. `startAiTunnelCircuit`
5. `startSupervisor` — monitoring.db / 队列 / 资产 / 推送探针
6. `checkEmbeddingApi`
7. `startQueueWorker` — persona_/news_ 任务（并发默认 6）
8. `startCloudflareTunnel`
9. 口头仓位缓存：5s 首次 + 每 15min

另：`global.gpuLock` 与 `/api/gpu/*` 也挂在同一进程。

---

## 3. 建议职责切分草案（供 T2 裁定，非定稿）

| 能力 | 建议归属 | 依据 |
|---|---|---|
| Whop 轮询 `syncAndAnalyze`、企微推送、跟单 | **ingest** | 写库 + 副作用主路径 |
| media DPC / ISR 在线半部 | **ingest** | 与同步同进程 |
| `task_queue` worker（persona/news） | **ingest** | 写 reports / 烧 AI；web 不应跑 |
| Auto News / Auto Persona 调度触发 | **ingest** | 现挂在 poller 后 |
| Express static、`/api/*` 只读查询、L2 workbench 只读 | **web** | 用户可见面 |
| `/health` + Supervisor + event-loop 探针 | **争议点** | 见下节 |
| Cloudflare tunnel | **web 或独立** | 对外入口；若挂 web，ingest 可不暴露公网 |
| `gpuLock` API | **ingest 或保留单点** | 状态在内存，拆分后需文件锁/Redis 级替代，958MB 机不建议引入 Redis |
| 离线 cron（queue worker / asset sync） | **保持系统 cron** | 已守 R4，勿并入 PM2 常驻 |

### `/health` 与看门狗争议（T2 必须拍板）

- 今日看门狗 crontab 探 **8085 `/health`**。
- 若 `/health` 只挂 **web**：看板活 ≠ ingest 活 → 需 ingest 心跳（文件/`/internal/ingest-health` 仅本机）。
- 若 `/health` 挂 **ingest**：看板假死时看门狗仍绿 → 违背「面板无响应要知道」的初衷。
- **较稳妥折中（供讨论）**：web 对外 `/health` 聚合「自身 ok + 读取 ingest 心跳文件/本机端口」；看门狗仍打 web；ingest 假死时 web 报 warn/critical。

---

## 4. 写路径 vs 只读路径（SQLite）

| 写（必须 ingest） | 只读（可 web） |
|---|---|
| `messages` / attachments 回填 | `GET /api/messages*` |
| `pipeline_tasks` / watermarks（在线 media） | reports / news-summaries 查询 |
| `task_queue` claim/complete | campaigns / quant 查询 |
| `is_pushed` / `is_traded` | `/health` 子系统只读快照 |
| `monitoring.db` 采样写 | monitoring.db 读趋势（P2 看板） |
| trading / wechat 副作用 | static `/media/zhao` |

web 进程约束：`better-sqlite3({ readonly: true })`，禁止 `saveMessages` / `addTask` / 推送。

---

## 5. 现有 crontab（拆分后勿破坏）

```
* * * * *     watchdog → 8085 /health
*/15 * * * *  offline_queue_worker.js --cron
0 2 * * 0,6   run_offline_asset_sync.js   # UTC=北京周六日 10:00
```

---

## 6. 建议 Gemini T2 输出格式

1. 最终进程名与端口（web=8085？ingest=内部口？）  
2. 内存预算表（启动 / 盘中 / 跑 persona 时）  
3. `/health` + 看门狗方案（选上节折中或其它）并画边沿告警  
4. `ecosystem.config.cjs` 草稿（**先 PR 文档，勿直接上生产**）  
5. 回滚：单进程 `whop-wechat-bridge` 一键恢复步骤  
6. 本地/云端对称检查清单（gitignore / 脚本白名单）

---

## 7. Cursor 本轮已确认

- News 休市免检已上机，`ok: true`
- `run_offline_asset_sync.js` 已入 git（`2075832`）
- 任务拆分见 `docs/gemini-followup-task-split.md`（T1–T4）
