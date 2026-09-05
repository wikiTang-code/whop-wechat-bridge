# 后续任务拆分 Round 3（给 Gemini）

> 基线：`6807857` + Cursor 复核补丁（web `/health` 503 语义、liveness 去重、只读 monitoring 注入）。  
> **禁止**：改生产 `ecosystem.config.cjs`、双进程上机、`pm2 delete all`。

## 已通过（骨架）

T5 ingest_runner / T6 web_runner / T7 heartbeat / T8 dashboard API / T9 DST — 本地测试通过，**尚未生产切换**。

## T10 — 合并双份 liveness 与 HTTP 语义回归单测

确认仅使用 `ingest-liveness.js` ← `ingest-health.js` 薄封装；补测：`status=warn` 时 `/health` **必须 200**，仅 `critical` → 503。

## T11 — ingest_runner 补齐生产能力（仍不上机）

在 `--dry-run` 之外：
- 接入背压间隔（`getEffectivePollIntervalSec`）
- 动态 import 拉起 `startQueueWorker`（persona/news）
- Auto News / Auto Persona 是否跟 poll 绑定写清（对齐 route-ownership）
- 文档：与单体 `server.js` poller 行为差异表

## T12 — web_runner 挂载只读 API 子集

按 `docs/p1-11-route-ownership.md` 挂载 GET 路由；所有 POST write 返回 403；补集成测。

## T13 — ecosystem 双进程草稿（仅文档/注释掉的 sample，不替换生产文件）

在 `docs/` 放最终 `ecosystem.p1-11.sample.cjs`；生产 `ecosystem.config.cjs` 保持单体。

## T14 — 灰度 Runbook

一步步：文件拷贝 → 先起 ingest dry-run 心跳 → 再起 web 8085 → 看门狗验证 → 回滚命令（禁 delete all）。

## 顺序

T10（快）→ T11 / T12 并行 → T13 / T14。
