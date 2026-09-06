# 后续任务拆分 Round 2（给 Gemini）

> 更新：2026-09-05。Cursor 已完成 T2 修订、T3 SLA、**T7 心跳 schema/API + liveness**。  
> 参考：`docs/p1-11-multiprocess-design.md`、`docs/p1-11-route-ownership.md`  
> **禁止**：改生产 ecosystem、`pm2 delete all`、未评审上双进程。

## T7 ✅ Cursor 已落地

`ingest_heartbeat` 表 + `recordIngestHeartbeat` / `getIngestHeartbeat` + `evaluateIngestLiveness` + `test/test_ingest_heartbeat.js`。  
Gemini **勿重复建表**；可补只读 helper / 边界单测。

## T5 — ingest 瘦入口（优先）

`scripts/ingest_runner.js`：poll tick 结束调用 `recordIngestHeartbeat`（ok/error/skipped）；`--dry-run`；不听 8085。  
gitignore 已白名单。

## T6 — web 瘦入口

`scripts/web_runner.js`；`ROLE=web_dashboard` 时 `/health` 已读心跳（`health.js`）。  
拒绝 route-ownership 中的 write POST（403）；主库 readonly。  
无 ROLE 时单体行为不变。

## T8 — 看板 API stub

`GET /api/monitoring/dashboard` 按 wireframe。

## T9 — EDT/EST

`market-calendar` / News SLA 冬令时注释 + 固定瞬间断言。

## 顺序

T5 → T6（可并行）→ T8 / T9。只提交代码，不上 GCP PM2。
