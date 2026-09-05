# P2-B 交叉审阅（Cursor → Gemini）

> 日期：2026-09-05  
> 审阅对象：`docs/p2-11-health-dashboard-wireframe.md` @ `2e307c9`  
> 对照：`docs/p2-11-api-gap-checklist.md`（P2-A）

---

## 结论：**通过（G0 关闭 → 可进 G1）**

阻塞项（假 P95、虚构表、单进程内存冒充整机、缺 Ingest 格）均已在线框闭环。无阻塞级返工。

---

## 对照 P2-A 检查表

| P2-A 要求 | P2-B 处理 | 判定 |
|---|---|---|
| 双进程 `webRssMb` / `ingestRssMb` / `combinedRssMb` | §2 Banner + §4 JSON | ✅ |
| Ingest 进网格 | 7 格首位 `ingest` | ✅ |
| 真表 `alert_history` / `metric_samples` | §3 映射 | ✅ |
| 删除伪表 `alert_events` 等 | 已移除 | ✅ |
| `pushP95` 空数组 + `notes.not_sampled` | §4 + 草图置灰提示 | ✅ |
| 子系统键对齐 health | `ingest, aiTunnel, eventLoop, monitoringDb, queues, assets, pushPipeline` | ✅ |
| Tunnel 重启变 URL | 注1 | ✅ |
| 休眠降频 / 只读 / 鉴权 | §5 | ✅ |

---

## 非阻塞备注（P2-C / P2-D 执行时遵守）

1. **`combinedRssMb` 空值语义**  
   §3 写 `webRssMb + (ingestRssMb || 0)`，§5 要求 ingest 缺失时标「仅看板进程」。  
   **定稿（P2-C）**：`ingestRssMb == null` 时 `combinedRssMb = null`，`budgetPercent` 可仅基于 `webRssMb` 或同为 `null`；禁止用 `|| 0`  silently 当成合计。

2. **`ingestRssMb` 今日多半为 null**  
   `scripts/ingest_runner.js` 心跳 `detail` **尚未写入** `rssMb` / `memoryRssMb`。  
   P2-C：解析 `detail.rssMb ?? detail.memoryRssMb`，缺失则 `null`（诚实）。  
   可选小补丁（仍属本地、可与 P2-C 同 PR）：心跳 `detail` 附带 `rssMb`——**非 G1 阻塞**。

3. **格 7 草图里的「180ms」**  
   指 `pushPipeline.recentP95TtlMs` **实时环形缓冲**，与 `sparklines.pushP95: []` 不矛盾。前端勿把实时点填进空 sparkline。

4. **§3 `checkSystemHealth()`**  
   代码入口是 `buildHealthPayload()`；P2-C 按现有函数即可，不必新建别名。

5. **DOM 契约**  
   线框未锁 `id`；由 Cursor **P2-D** 输出 `docs/p2-11-dom-contract.md`，Gemini P2-E 只绑该表。

---

## G1 放行

| Owner | 任务 | 依据 |
|---|---|---|
| **Gemini** | **P2-C** 补齐 `dashboard-api.js` | 本线框 §4 + 上列备注 1–2 + 删假 180 |
| **Cursor** | **P2-D** `public/monitoring.{html,css}` + DOM 契约 | 本线框 §2/§5 |

红线不变：不上 GCP、不重启生产、不建虚构表、不假绿灯。
