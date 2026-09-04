# 系统加固 + 监测机制 实施方案（P0 已落地，P1/P2 待做）

> 本文整合两部分内容并给出统一优先级与执行顺序：
> 1. 对现有系统「整体检视」发现的**不合理之处及改法**；
> 2. 用户要求的**中断响应式监测机制**（各子系统异常、抓取/推送/处理流程丢失或卡顿、前端渲染延迟等）。
>
> **状态（2026-09-04 更新）**：第 8 节决策点与第 4 节红线仍有效。**P0-1～P0-4 已实现并 SCP 上机**（PR #7 已合入 `main`，squash `c5b57ae`）；看门狗 crontab 已装；详见文末 **§10 实施状态快照**。本文仍是 P1/P2 的权威工作计划；与 `main` 上的 P0 代码同步维护。

---

## 1. 问题 / 需求背景

### 1.1 需求来源
- 运维中缺乏主动发现问题的手段：**故障往往在事后才被察觉**。典型事件——生产曾出现主线程被同步任务占死，Web 面板（8085）连续约 40 分钟无响应，期间系统无任何自动告警，靠人工介入才发现。
- 希望为**各子系统/模块建立监测机制**，问题能"及时报出、按中断响应方式处理"，覆盖范围不仅是进程崩溃，还包括：
  - 数据**抓取 / 推送 / 处理流程的丢失与卡顿**；
  - **前端数据渲染的延迟与卡顿**；
  - AI 供给、队列积压、资产滞后等业务链路异常。

### 1.2 检视触发的痛点（现状证据）
2026-09-03/04 对生产服务器只读诊断得到的真实数据：

| 观察项 | 现状证据 |
|---|---|
| 事件循环曾被占死 | 主线程持续 99.9% CPU（30 分钟里 25 分钟 CPU），8085 全超时（已修复 ISR 重复分发） |
| 本地 14B 依赖 SSH 隧道 | `news_map` 失败 **1455 次 `ECONNREFUSED 127.0.0.1:8080`**（隧道断即全失败） |
| Gemini 配额/密钥 | `news_reduce` 失败 **694 次 429 配额耗尽 + 351 次 401 密钥失效**（失败率 ~93%） |
| task_queue 被污染 | 表 **28,051 行，其中 22,285 行是 `gemini_api_cloud` 可视化记录（79%）** |
| 附件未回填 | `messages.attachments` 全为 `[]`/`null`；磁盘图片 139 张 vs manifest 126 条 |
| 队列无消费者 | `pipeline_tasks`：`l2a_cut` 295 pending、`timeline` 53 pending 长期无人消费 |
| 水位滞后 | `wm_media` 落后主水位 5.3h；L2a 水位停在 08-31（滞后 ~3.5 天） |
| 离线资产滞后 | Persona 画像最新 08-26（滞后 8.4 天） |
| 资源与日志 | DB 867MB；pm2 日志曾涨到 945MB（已加轮转） |

---

## 2. 系统现状

### 2.1 系统定位与技术栈
- **定位**：作为订阅者轮询监听 Whop Chat 频道，提取大V发言 → AI（本地 14B / Gemini）深度提炼市场策略 → 归档 SQLite → 推送企业微信 → 沙盒/实盘跟单，并提供 Web 管理 Dashboard。
- **技术栈**：Node.js 20（ESM）/ Express / better-sqlite3（**同步** API，867MB 库、WAL、FTS5 全文索引）/ pm2 守护 / Cloudflare 快速隧道 / dotenv。
- **部署**：GCP 单机 Ubuntu 22.04，**内存仅 958MB**；服务监听 `:8085`（HTTP Basic Auth）；`git@github` SSH remote，采用「main 合并 → 服务器 `git reset --hard origin/main`」的部署流程。
- **AI 供给**：本地 LM Studio `qwen2.5-14b-instruct` + `nomic-embed` 经 `ssh -R` 隧道映射到服务器 `127.0.0.1:8080`（服务器本身跑不动 14B）；Gemini 作为云端兜底（免费配额受限，已补充新 Key 并清理失效 Key，双 Key 轮询）。

### 2.2 架构分层（数据流）
```
Whop GraphQL ──(轮询 syncAndAnalyze，交易时段 25s/次)──▶ messages(SQLite)
   │
   ├─ 在线实时路径:
   │    saveMessages ─▶ ISR 上半部 dispatchIngestTopHalf ─▶ pipeline_tasks(media/l2a_cut/timeline/…)
   │                                          │
   │                                          └─ DPC 下半部 runMediaWorker ─▶ 图片落盘 + manifest + wm_media
   │    并行: campaign-engine / 微信推送 / extractAndExecuteTrades 跟单
   │
   ├─ AI Map-Reduce 队列 task_queue ──(startQueueWorker, 并发6)──▶ persona-engine / news-engine
   │                                          └─▶ reports / news_summaries
   │
   └─ 离线批处理(独立进程，读 messages 增量): L2a 切窗/抽取 → L2b 战法 → timeline/ledger（data/runs, data/samples, data/l2b…）
```
- **两套队列**：`pipeline_tasks`（ISR/DPC 产线，仅 `media` 有在线消费者）+ `task_queue`（AI Map-Reduce）。
- **AI 路由**：`ai-router-policy.js` 本地 14B 优先、Gemini 稀疏兜底、上下文超限不 cascade。
- **在线/离线硬隔离**：L2a/L2b 大模型批处理在独立进程，Web 只读指针文件。

### 2.3 运行现状（2026-09-04 复核）
- ✅ **消息实时抓取正常**：最新消息分钟级入库；真库路径为仓库根目录 `whop_archive.db`（约 870MB）。注意：`data/whop_archive.db` 曾出现 **0 字节空文件**，勿误用。
- ✅ **P0 监测已上线**：`GET /health`、事件循环探针、企微 alert-sink、AI 隧道熔断、外部 bash 看门狗 + **每分钟 crontab**（`scripts/watchdog/run_from_env.sh`）。
- ⚠️ **eventLoop 偶发尖刺**：看门狗已抓到一次 `/health` 503（eventLoop critical）并自动恢复；根因待查（同步 SQLite / 高频 sync / Auto News 空窗刷屏嫌疑）。
- ⚠️ **企微「延迟感」多为业务过滤而非 webhook**：直连 webhook RTT ≈ 0.6–0.8s（ok）。`TARGET_SPEAKER_USER_IDS` 当前 **仅 1 个大V**；该大V 无新发言时群内无实时推送属预期。非名单发言者不会进企微。
- ⚠️ **AI / 队列 / 资产**：本地 14B 隧道仍依赖本机；`l2a_cut` ~295 / `timeline` ~53 pending；L2a 水位仍停在 08-30 一带；Persona 滞后问题未消。
- ⚠️ **数据完整性缺口仍在**：`messages.attachments` 回填、`task_queue` 脏数据清理 → P1。
- ⚠️ **Auto News Scheduler** 约每 30s 对空窗报错刷 `error.log`（噪声大，建议尽快降噪）。

---

## 3. 开发 / 修复目标

| 目标 | 具体含义 | 衡量标准 |
|---|---|---|
| G1 稳定性 | 消除主线程卡死与雪崩式失败；AI 供给具备断线降级 | 不再出现"卡死数十分钟无人知"；隧道断时不刷千次失败而是降级+一条告警 |
| G2 可观测 / 中断响应 | 任何子系统异常、流程丢失/卡顿、前端延迟能被自动探测并分级告警；**主进程僵死也能由外部看门狗报出** | 注入故障可在阈值内收到企业微信告警，并在恢复后收到恢复通知 |
| G3 正确性 | 结构化数据完整、任务队列不被污染 | `messages.attachments` 正确回填；`task_queue` 无 `gemini_api_cloud` 脏数据 |
| G4 及时性 | 各层级资产按预期周期更新，滞后可发现 | Persona/L2a/News 有可靠定时调度 + 滞后告警 |
| G5 低侵入 | 监测与加固以旁路增量方式接入 | 不增加主流程阻塞风险，可灰度/开关控制 |

---

## 4. 设计约束与避坑红线（经审核确认，全局强制遵守）

> 针对本机「958MB 极限小内存 + SQLite 867MB 同步阻塞主线程 + 禁止盲目自动重启」的硬约束，以下为不可违反的红线：

- **R1 看门狗零 V8 开销**：外部看门狗**必须**是极轻量 `bash + curl`，由 Linux 原生 `crontab`（每分钟）或 `systemd timer` 驱动；**绝不为看门狗单独跑一个 Node/V8 进程**（否则额外 30–50MB 内存可能诱发 OOM-Killer 误杀业务主进程）。
- **R2 看门狗只告警、绝不自动重启**：看门狗**仅探测连通性并推送企业微信告警，严禁调用 `pm2 restart` 或任何写死的重启循环**。主服务死锁/长任务时重启会丢失内存态任务，且可能因 SQLite 锁未释放导致启动崩溃。
- **R3 监测数据严禁写主库**：`health_events` 等监测数据**绝不写入 `whop_archive.db`**（同步写锁/WAL checkpoint 争用会让监测自身反噬事件循环）。改用**独立 `monitoring.db`（独立 WAL）+ 内存定长环形缓冲（保留最近 ~500 条）**，仅在 warn/critical 边沿变化时落盘。
- **R4 恪守在线/离线硬隔离**：**绝不在 `whop-wechat-bridge` 主进程内启动常驻在线 worker 去跑 L2a 切窗/大模型计算**（会瞬间抽干 958MB 内存与 CPU）。积压队列由离线批处理脚本在其运行时消费并更新 `pipeline_tasks` 状态，或在入队端加开关/对遗留积压做归档标记。
- **R5 自愈仅限"软降级"**：仅允许受控软降级（AI 断线自动暂停队头消费、日志/临时文件定期清理），**严禁进程重启类硬自愈**。
- **R6 旁路增量**：所有监测与加固以旁路方式接入，可开关/灰度，不侵入主数据流。

---

## 5. 不合理之处与改法（来自整体检视）

| # | 问题 | 影响 | 改法 |
|---|---|---|---|
| I1 | 本地 14B 靠 `ssh -R` 隧道映射到 `127.0.0.1:8080`（服务器 958MB 跑不动模型） | 隧道一断，所有 bulk AI（news_map/persona_map）`ECONNREFUSED` 全失败 | 隧道健康探活 + **断线自动挂起队列消费（不盲目重试、不转烧 Gemini）** + 告警；暂不建常驻推理机（见决策 Q1） |
| I2 | Gemini 免费配额受限、密钥池曾含失效 key | news_reduce 大面积 429/401 | 已补新 Key + 清理失效 Key；坚持本地优先、云端稀疏兜底；配额水位告警、失败退避重排 |
| I3 | `rate-limiter` 用 `task_queue` 表存 API 可视化卡片 | 任务表膨胀（79% 脏数据）+ 被 worker 误当任务（"Unsupported task type"） | 改用**内存环形缓冲 / 独立库**做 API 可视化；清理历史 22k 脏行；worker 只认真实任务类型 |
| I4 | `normalizedMessages` 丢弃 attachments + `saveMessages` 为 `INSERT OR IGNORE` | `messages.attachments` 结构化附件全空；DPC `media` 队列空转 | 归一化时保留 attachments 并在下载后回填；校正媒体三层一致性 |
| I5 | `pipeline_tasks` 六队列仅 `media` 有在线消费者 | `l2a_cut`/`timeline` 入队即积压，队列语义名存实亡 | **恪守 R4**：由离线批处理脚本/系统 cron 消费并推进水位，或入队开关 + 遗留积压归档 |
| I6 | 离线资产（persona/L2a）靠轮询内时点判断触发 | 漏触发即长期滞后（persona 8 天、L2a 3.5 天） | 改为可靠定时调度（系统 cron），带成功/滞后监测 |

---

## 6. 监测机制（中断响应式）

### 6.1 框架
```
子系统探针(HealthProbe: check/周期/阈值/级别)
  → 统一调度器(Supervisor) → 状态机(ok/warn/critical, 边沿触发+冷却抑制)
  → 告警路由(企业微信分级) / 软降级钩子(受 R5 约束) / monitoring.db+环形缓冲(R3) / /api/health
```
原则：边沿触发（进入/恢复各告警一次）、冷却去抖、告警含「子系统+现象+证据数值+建议动作」。

### 6.2 两个基石（必须最先有）
- **M0-A 外部看门狗（遵守 R1/R2）**：`bash + curl` 脚本，由 `crontab`/`systemd timer` 每分钟探测 8085 端口与 `/health`；超时或非 200 → 推企业微信告警。**只告警、绝不 `pm2 restart`**，独立于 Node 运行时，从而在主进程假死时仍能自报。
- **M0-B 事件循环延迟探针**：`perf_hooks.monitorEventLoopDelay()`，`>1s` warn / `>5s` critical。卡顿的最直接信号。

### 6.3 分子系统监测清单
| 组 | 子系统 | 关键监测项 | 异常判据 |
|---|---|---|---|
| A | 运行时 | 事件循环延迟、内存、pm2 重启、未捕获异常、磁盘 | lag>阈值 / RSS 近上限 / 重启突增 / 磁盘>85% |
| B | 数据抓取 | 抓取心跳、单轮耗时、同步锁卡死、Whop 失败、抓取量 | 交易时段水位停滞 N 分钟 / 单轮超时 / 连续 fetch 失败 |
| C | 处理与队列 | 队列积压、无消费者、水位滞后、running 卡死、失败率 | pending 超阈值 / done 长期不增 / wm 落后 / 失败率突增 |
| D | AI 供给 | 本地 14B 隧道探活、Gemini 配额、401/429 率、模型卸载 | 8080 探活失败 / 配额近上限 / 失败率高 |
| E | 资产新鲜度 | Persona/L2a/News/Timeline 距上次更新 | 超预期周期未更新 |
| F | 推送/交易 | 微信推送成功率、待推送积压、跟单失败率 | webhook 不可达 / is_pushed·is_traded 积压 |
| G | 前端渲染 | （降级）仅全局 `window.onerror` 上报；API p95 延迟由服务端埋点 | 前端报错 / 接口延迟超阈值 |
| H | 数据一致性 | 附件回填、manifest·磁盘·DB 三方一致、打标覆盖、水位单调 | 有图但 attachments 空 / 数量偏差 / 覆盖率低 / 水位倒退 |

---

## 7. 统一优先级与执行顺序

> 复杂度用技术范围描述（不用日历时间）。P0 顺序已按审核建议微调为"先通告警 → 看门狗上哨 → 主进程体征 → AI 隧道熔断"。

### 阶段 P0 — 止血与"出事能知道"（✅ 2026-09-04 已完成并上机）
| 序 | 项 | 状态 | 涉及模块 | 关键约束 | 验收/上机证据 |
|---|---|---|---|---|---|
| 1 | 企业微信告警出口 + 冷却抑制 | ✅ | `monitoring/alert-sink.js` | 边沿；critical 10min；warn 聚合 5min | 单元测试 PASS；`/health.subsystems.alerts` 可见 |
| 2 | 超轻量外部看门狗 | ✅ | `scripts/watchdog/*` + crontab | **R1/R2** | crontab 每分钟跑 `run_from_env.sh`；已边沿告警 503→恢复 |
| 3 | `/health` + 事件循环探针 | ✅ | `monitoring/health.js` + event-loop-probe | 只读旁路 | `/health` 200；meanMs≈20；尖刺时 503 |
| 4 | AI 隧道探活 + 断线熔断挂起 | ✅ | ai-tunnel-circuit + router/queue 接线 | 挂起队头、不转烧 Gemini | `/health.aiTunnel` closed；8080 可达 |

### 阶段 P1 — 正确性、瘦身与处理链路监测
| 序 | 项 | 对应 | 涉及模块 | 验收标准 |
|---|---|---|---|---|
| 5 | 修复 attachments 回填 | I4 | `monitor.js`/`database.js` | 新带图消息 `messages.attachments` 正确写入 |
| 6 | rate-limiter 去污染 + 清理脏数据 | I3 | `rate-limiter.js` + 一次性清理脚本 | `task_queue` 不再写 `gemini_api_cloud`；历史清空 |
| 7 | 统一探针框架 + `monitoring.db`/环形缓冲 + 队列/水位/失败率监测 | C,M,R3 | `monitoring/` + 独立库 | 积压/滞后/失败率超阈值→告警并入独立库 |
| 8 | 队列消费者落实（离线脚本/cron，恪守 R4） | I5 | 离线批处理脚本 + 系统 cron | pending 能被离线消费、水位推进；主进程不新增常驻 worker |
| 9 | 离线资产可靠定时调度 | I6 | 系统 cron | persona/L2a 按期更新，滞后可监测 |
| 10 | 推送/交易链路监测 | F | 探针 | 推送失败/积压→告警 |

### 阶段 P2 — 可观测性与演进
| 序 | 项 | 对应 | 涉及模块 | 验收标准 |
|---|---|---|---|---|
| 11 | 健康看板页（红黄绿+趋势+最近告警） | 全局 | 新增前端页 + `/api/health` | 一页看清各子系统 |
| 12 | 资产新鲜度巡检 | E | 探针 | 各层资产滞后可见告警 |
| 13 | 数据一致性巡检（附件/manifest/磁盘/打标） | H | 探针 + 脚本 | 偏差可发现 |
| 14 | 前端错误上报（仅 `window.onerror`，最低优先级/可剔除） | G | `public/app.js` | 前端异常可见（不做首屏/掉帧打点） |
| 15 | 软降级钩子（受 R5 约束） | 全局 | Supervisor 钩子 | 仅软降级/清理，无进程重启 |
| 16 | DB 增长治理（FTS/索引/归档） | 演进 | `database.js` + 归档脚本 | 写放大与体积可控 |

### 依赖关系
- P0-1（告警出口）是后续所有告警的前置，最先合。
- P0-2 看门狗可先探端口连通，`/health`（P0-3）就绪后增强。
- P1-7（探针框架/独立库）依赖 P0 告警出口；P1-8/9 依赖离线调度改造。
- P2-11（看板）依赖 P1-7 的 `monitoring.db` 与 `/api/health`。

---

## 8. 已定稿决策（经审核）

| # | 决策点 | 定稿结论 |
|---|---|---|
| Q1 | 本地 14B 供给 | **仅做"隧道探活 + 断线挂起队列 + 告警"，暂不建常驻推理机。** 隧道性能良好，断线多因本机休眠/断网；探活失败即暂停消费、不重试、不转烧 Gemini。 |
| Q2 | Gemini 策略 | **坚持本地优先、Gemini 稀疏兜底，不升级付费配额。** 已补新 Key、清失效 Key，双 Key 轮询；只要断线不雪崩重试，免费配额足够覆盖盘中关键信号；配额耗尽降级告警。 |
| Q3 | 队列消费者形态 | **系统 cron 跑离线脚本 / 手工批处理触发**，严守在线/离线硬隔离（R4），不在主服务跑高耗能 worker。 |
| Q4 | 告警渠道与冷却 | **单一群聊企业微信 Webhook**；critical 10 分钟去抖、warn 聚合；边沿触发（故障一次、恢复一次）。 |
| Q5 | 自愈动作授权 | **仅受控软降级**（AI 断线暂停队头消费、日志/临时文件清理）；**严禁进程重启类硬自愈**（R2/R5）。 |
| Q6 | 监测数据存储 | **独立 `monitoring.db` + 内存定长环形缓冲，坚决不入主库**（R3）。 |
| Q7 | 前端 RUM | **降至最低优先级，仅抓全局 `window.onerror`**；不做首屏/长任务/掉帧打点。 |
| Q8 | 看门狗形态 | **单机系统级轻量看门狗（bash + 定时调度）**，不引入多机/外部探针（R1）。 |

---

## 9. 结论与下一步

- 本文仍是**完整工作计划权威稿**（红线 R1–R6、决策 Q1–Q8、P0/P1/P2 顺序）。
- **P0 已落地**：PR #7 已合入 `main`（squash `c5b57ae`），已 SCP 部署 gcp-vm；看门狗 crontab 已装。原文档轨 PR #6 已因冲突关闭。
- **下一步默认从 P1-5 起**：attachments 回填 → rate-limiter 去污 → `monitoring.db` 探针框架 → 离线队列消费者/cron → 推送链路监测；并行可处理运维噪声（Auto News 空窗刷屏、eventLoop 尖刺根因）。
- 每阶段坚持「旁路增量、只告警不硬重启、监测不入主库、离线隔离」红线。
- **部署提醒**：在 GitHub `main` 与 VM 对齐前，VM 优先 **文件拷贝部署**，避免整树 `git pull` 踩到历史截断/`server.js` 事故。

## 10. 实施状态快照（2026-09-04 18:50 Asia/Shanghai 最新归档）

### 10.1 仓库 / PR / 提交线
| 项 | 状态 | 说明 |
|---|---|---|
| 分支 `feat/p1-attachments-and-ratelimiter` | 正在开发与验证 | 承载 P1-5、P1-6 及 P0/P1 稳定性加固，已同步推送至 GitHub |
| Commit `f092129` | ✅ 已推远端 | P1-5 attachments ON CONFLICT 回填 + P1-6 rate-limiter 纯内存去污 (清理 22,285 条历史脏数据) |
| Commit `05d1937` | ✅ 已推远端 | 修复 888 条全量重复 upsert 致命缺陷（仅写新消息）+ 股票标的正则预编译 |
| Commit `5d7d022` | ✅ 已推远端 | P0 加固：防震荡抑制 (Flapping) + 慢日志环形缓冲 (trackSlowOp) + 3级阶梯背压控制器 (25s/60s/120s) + 告警时区北京时间 |
| Commit `09c5ed0` | ✅ 已推远端 | P1 减负：`saveMessages` 50 条切片分块 + `setImmediate` 让出事件循环 + Auto News 空数据 error.log 降噪 |

### 10.2 生产 gcp-vm（实机核验摘要）
| 项 | 结果 | 说明 |
|---|---|---|
| 服务 | pm2 `whop-wechat-bridge` online | PID 693693，当前 CPU 0%~2%，内存 ~126MB，0 异常重启 |
| 代码一致性 | SHA256 100% 比对一致 | `database.js` / `monitor.js` / `server.js` 等 8 个核心模块与远端 commit 逐位匹配 |
| `/health` | 常态 200 OK | 内网 `127.0.0.1:8085/health` 毫秒级返回，时区显示 `(北京时间)` |
| 看门狗 | bash 探针运行正常 | `status=ok prev=ok detail=http=200`，静默无骚扰告警 |
| 企微推送 | 双通道分流已就绪 | 业务群 (`WECHAT_WORK_WEBHOOK_URL`) 与 监控告警群 (`WECHAT_ALERT_WEBHOOK_URL`) 物理隔离 |
| 赵哥图片推送 | 原生协议验证通过 | 原生 base64/md5 `msgtype: "image"` + markdown 伴随文本 + 剔除长乱码链接 |
| 访问路径规范 | 严格采用内网与安全隧道 | 验活统一使用内网回环 `127.0.0.1:8085`，公网访问统一走 Cloudflare 加密隧道，废止公网裸 IP 验收话术 |

### 10.3 全量任务清单对照（已做 / 待做）
| 优先级 | 任务项 | 状态 | 落地内容 / 交付说明 |
|---|---|---|---|
| P0-1 | alert-sink 告警中心 | ✅ 完成 | 边缘触发 + critical 去重 + 10分钟 Flapping 震荡抑制（翻转>2次进震荡，单次 OK 静音） |
| P0-2 | bash 看门狗 + crontab | ✅ 完成 | 外部 curl 探测（R1/R2 只告警不自动 pm2 restart）+ 失败 2 秒重试防抖 |
| P0-3 | `/health` + event-loop 探针 | ✅ 完成 | 实时延迟度量 + 喂入背压控制器 + checkedAt 统一北京时间 |
| P0-4 | AI 隧道熔断保护 | ✅ 完成 | 连续 3 次失败软降级挂起本地 14B 探针，避免刷屏 |
| P0-5 | 告警时区本地化 | ✅ 完成 | 移除 `toISOString()` UTC 偏差，全面支持 Asia/Shanghai 北京时间 |
| P0-6 | 慢操作打点归因 | ✅ 完成 | 舍弃重型 V8 Profiler，改用 `trackSlowOp` + 20 条内存环形缓冲，告警证据直出阻塞函数与 batch |
| P0-7 | 固定三级阶梯背压 | ✅ 完成 | 25s $\to$ 60s $\to$ 120s 自动退避，暂停次要 media_worker；连续 3 周期健康平滑回退 |
| P1-5 | attachments 回填与持久化 | ✅ 完成 | `messages.attachments` 库表结构就绪，实时下载活签落盘并在主库 ON CONFLICT 回填 |
| P1-6 | rate-limiter 内存化与去污 | ✅ 完成 | 22,285 条 `gemini_api_cloud` 历史脏数据物理清除，改为纯内存 Map 限流，task_queue 零写入 |
| P1-A | 入库 50 条分块切片减负 | ✅ 完成 | `saveMessages` 大批量入库按 50 条切片并在片间 `setImmediate`，主动交出主线程生命通道 |
| P1-B | 调度器日志噪音治理 | ✅ 完成 | Auto News Scheduler 空数据时降级为 info 日志，彻底停止污染 `error.log` |
| P1-7 | `monitoring.db` 独立库 + 探针框架 | ⬜ 待做 | 遵循 R3 红线（监控数据绝不写入 `whop_archive.db`），建立专用的指标时序存储 |
| P1-8/9 | 看板与 Ingest 物理多进程隔离 | ⬜ 待做 | Web 只读服务与 Ingest/Worker 拆分为独立 PM2 进程，通过 SQLite WAL 解耦 |
| P1-10 | 推送与交易链路端到端监测 | ⬜ 待做 | 监控大V发言到企微推送的端到端时延（TTL），超过阈值主动报警 |
| 运维 | 24小时内网静默观察 | 🟡 进行中 | 重点监控大批入库延迟、背压阶梯平滑回退、探针单点毛刺表现，确认零 pm2 restart 误触发 |
| 待调优 | 探针毛刺判定优化 | ⬜ 建议 | 当前 `max >= 5s` 易受单次底层 Full GC 抖动触发；建议未来以 `p99 >= 5s` 为 critical 核心判定，避免孤立毛刺误报 |
