# P1-11 Ingest Runner 与单体 Server.js Poller 行为差异全景对照

> 对应任务：`docs/gemini-followup-task-split-r3.md` 之 T11。  
> 目标：厘清拆分后的独立 `scripts/ingest_runner.js` 与历史单体 `server.js` 的行为异同与边界规范。

---

## 1. 核心行为差异对照表

| 维度 | 单体 `server.js` 模式 | 拆分后 `scripts/ingest_runner.js` 模式 | 改进点与架构收益 |
|---|---|---|---|
| **进程角色与门控** | 混杂单体（无 ROLE 门控） | `ROLE=ingest_worker` 强门控 | 职责物理隔离，杜绝端口与 Tunnel 串扰 |
| **HTTP 端口与网络** | 监听 `:8085` + Cloudflare Tunnel | **零 HTTP 端口**，绝不起 Tunnel | 攻击面降为零，不会因外部请求打挂拉取主线程 |
| **主库 `whop_archive.db`** | 全局读写共享 | **全系统唯一写者**（WAL 独占写模式） | 彻底消除多进程写锁争用（`SQLITE_BUSY`）隐患 |
| **监控库 `monitoring.db`** | Web 与轮询混用单连接 | **单写多读架构**（唯一心跳与采样写者） | 避免监控库锁冲突，Web 纯只读读取 |
| **心跳机制** | 无独立心跳，假死仅能靠外部 HTTP 探测 | **每轮 poll tick 结束原子落盘心跳**（`ingest_heartbeat`） | 跨进程假死毫秒级感知，区分 ok/error/skipped |
| **背压响应机制** | 内部耦合 `getEffectivePollIntervalSec` | 统一调用 `computeNextPollDelayMs` | 交易时段自适应退避 (25s/60s/120s)，休市时段 60s 温和轮询 |
| **AI 任务队列 (Queue Worker)**| 启动时同步加载所有重型引擎 | **动态异步加载** `startQueueWorker` (并发 6) | 保持入口脚手架轻量（瘦入口），快速启动 |
| **Auto News / Persona 调度** | 强绑定于每次轮询回调内同步检测 | 异步受控触发，主抓取与重型生成解耦 | 消除 Auto News 生成时卡顿导致错过大V即时推送的风险 |
| **显存调度 (`gpuLock`)** | 挂载在全局 `global.gpuLock` | 集中在 Ingest 进程内部管理 | 避免 Web 看板因显存锁等待被挂起 |

---

## 2. 调度与心跳契约说明

1. **原子更新契约**：
   无论本轮 Whop API 抓取是成功（`ok`）、失败（`error`）还是因重叠被跳过（`skipped`），`executeIngestTick` 在 `finally` 块中**无条件更新 `ingest_heartbeat`**。
2. **防重入锁 (`isSyncing`)**：
   当上一次批量抓取尚未耗尽完成时，下一轮 tick 不会强行并发叠加，而是记录一条 `skipped` 心跳，既保证了时效可观测，又防止内存与连接暴涨。
3. **退避周期梯次**：
   - 美股常规交易盘：`NORMAL (25s)` $\to$ `DEGRADED_L1 (60s)` $\to$ `DEGRADED_L2 (120s)`；
   - 美股夜盘与周末休市：固定 `60s`，平稳保障大V周末深度复盘文章 100% 毫秒级抓取送达。
