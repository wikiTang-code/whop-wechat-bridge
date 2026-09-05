# 后续任务拆分 Round 2（给 Gemini，Cursor 评审修订后）

> 更新：2026-09-05。Cursor 已完成：T2 设计 5 处硬伤修订、T3 SLA 真实现（`monitoring/news-freshness.js`）、探针接线。  
> 准则仍有效：可观测 ≠ 闭环；PM2 累计重启勿误读；本地/云端脚本对称。  
> **禁止**：直接改生产 `ecosystem.config.cjs` / 上机 `pm2 delete all` / 未评审就开双进程。

权威设计：`docs/p1-11-multiprocess-design.md`（修订版）+ `docs/p1-11-split-inventory-baseline.md`

---

## T5 — ingest 瘦入口骨架（只出草稿 PR，不上生产）

**目标**：新建 `scripts/ingest_runner.js` 最小可运行骨架（本地 dry-run）。  
**必须**：
- 只 import 轮询/推送/跟单/`task-queue`/monitoring **写侧**
- 每轮 poll tick 结束写心跳到 **monitoring.db `ingest_heartbeat`**（或先写文件 stub）
- `ROLE=ingest_worker` 门控  
**禁止**：启动 Express 8085、Cloudflare tunnel、改生产 ecosystem  
**验收**：本地 `node scripts/ingest_runner.js --dry-run` 打印 tick + 心跳路径；单测 mock 心跳写入

---

## T6 — web 瘦入口 + 只读 DB 辅助

**目标**：`scripts/web_runner.js` + `monitoring/db-readonly.js`（或 `database-readonly.js`）  
**必须**：
- Express 静态 + 现有只读 `/api/*`；`READONLY_MODE=1`
- 主库 / monitoring.db 均 `{ readonly: true }`
- `/health` 读取 ingest 心跳并实现 90s/180s 状态机（可先单测纯函数）  
**禁止**：`startPoller` / `startQueueWorker` / 推送  
**验收**：unit：心跳 delay→ok/warn/critical；启动不加载 persona-engine（可用 import 探测或文档自检清单）

---

## T7 — monitoring.db `ingest_heartbeat` schema + 裁剪

**目标**：在 `monitoring-db.js` 增加心跳表初始化、upsert、只读 get、与 7 天裁剪策略一致。  
**验收**：`test/test_ingest_heartbeat.js` 独立库文件跑通；**不**写入 `pipeline_watermarks`

---

## T8 — P2 看板 API 契约 stub（只读）

**目标**：按 `docs/p2-11-health-dashboard-wireframe.md` 实现 `GET /api/monitoring/dashboard` **stub**（可返回固定形状 + 真实 `/health` 子集）。  
**禁止**：新前端框架、写库  
**验收**：本地 curl JSON schema 稳定；文档字段表对齐

---

## T9 — 冬令时 / EST vs EDT 注释与校验用例

**目标**：给 `market-calendar.js` / News SLA 文档补 EDT/EST 说明；加 1–2 个固定瞬间断言（可用已知历史 DST 日）。  
**验收**：短文档段落 + 测试不因本机时区失败

---

## 建议 Gemini 顺序

1. **T7**（心跳 schema，阻塞 T5/T6）  
2. **T5** 与 **T6** 可并行（不同文件）  
3. **T8**、**T9** 可并行  

全部在分支 `feat/p1-attachments-and-ratelimiter` 或新建 `feat/p1-11-scaffolding` 提交；**不要** SCP 改 GCP PM2。Cursor 负责评审与上机灰度。
