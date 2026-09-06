# P1-11 路由归属清单（给 T5/T6 门控用）

> 单体 `server.js` 路由盘点。拆分后：**web 默认可挂 GET；标注 write 的必须只在 ingest 或返回 403**。  
> **2026-09-06 修订**：补全 L2 工作台 / ticker / pipeline（切流后曾漏挂导致工作台假死）。权威对照：`scripts/web_runner.js` 必须 `app.use('/api', l2WorkbenchRouter)`。

## Web 可挂（只读 / 展示）

| 方法 | 路径 | 备注 |
|---|---|---|
| GET | `/health` | web 独占对外；拆分后含 ingest 心跳 |
| GET | `/api/csrf-token` | 若 write API 迁走可删 |
| GET | `/api/messages` | 只读 |
| GET | `/api/proxy-image` | 只读代理 |
| GET | `/api/channels` `/api/speakers` | 只读 |
| GET | `/api/messages/:id/context` | 只读 |
| GET | `/api/reports` | 只读 |
| GET | `/api/persona/status` `/api/persona/latest` | 只读 |
| GET | `/api/news-summaries*` | 只读 |
| GET | `/api/system/monitor` | 只读聚合 |
| GET | `/api/zhao-positions` | 只读缓存 |
| GET | `/api/campaigns*` `/api/macro-events` | 只读 |
| GET | `/api/quant/portfolio` `/positions` `/orders` | 只读 |
| GET | `/api/config` `/api/strategies` `/api/gpu/status` | 只读 |
| GET | `/api/monitoring/dashboard` `/monitoring` | P2-11 |
| GET | `/api/l2a/*` `/api/l2b/*` `/api/pipeline/*` | L2 工作台只读 |
| GET | `/api/review/queue` | 人工待审池只读 |
| GET | `/api/ticker_timeline/*` `/api/ticker_kline/*` | 个股时间轴 |
| GET | `/review_workbench.html` `/ticker_timeline.html` | 静态页 |
| static | `/media/zhao` | L2 真图穿透 |

## Ingest 独占（写 / 副作用）

| 方法 | 路径 |
|---|---|
| POST | `/api/sync` `/api/sync/realtime` `/api/sync/archive` |
| POST | `/api/reports/*` `/api/persona/generate` `/resume` |
| POST | `/api/news-summaries/generate` |
| POST | `/api/tasks/restart-failed` `/api/task-queue/clear` |
| POST | `/api/trade-review/*` `/api/quant/reset` `/trade` |
| POST | `/api/config` `/api/strategies/analyze` `/api/rag/query` |
| POST | `/webhook` |
| POST | `/api/gpu/acquire` `/release` |
| POST | `/api/l2a/reload-offline` `/api/review/action` | web 进程应 403（只读铁律）；写侧若需开放须另议 |

## 启动侧（非路由）

| 能力 | 归属 |
|---|---|
| `startPoller` / Auto News / Auto Persona | ingest |
| `startQueueWorker` | ingest |
| `startSupervisor`（写 monitoring） | ingest（单写） |
| `startEventLoopProbe` / `startAiTunnelCircuit` | ingest |
| Cloudflare Tunnel | web |
| Express static `public` `/media` | web |

## 门禁（防再漏）

1. 静态页入 `public/` ≠ API 已挂：每个页面至少 1 条关键 GET 须在 `web_runner` 冒烟非 404。  
2. 新增只读路由：先改本表 → 再挂 `web_runner` / `readonly-api-router` → 再补 `test/`。  
3. 详见 [`docs/p2-12-dual-process-gap-and-autofix.md`](./p2-12-dual-process-gap-and-autofix.md)。
