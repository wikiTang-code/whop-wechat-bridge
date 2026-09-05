# P1-11 路由归属清单（给 T5/T6 门控用）

> 单体 `server.js` 路由盘点。拆分后：**web 默认可挂 GET；标注 write 的必须只在 ingest 或返回 403**。

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
| GET | 未来 `/api/monitoring/dashboard` `/monitoring` | T8 |

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

## 启动侧（非路由）

| 能力 | 归属 |
|---|---|
| `startPoller` / Auto News / Auto Persona | ingest |
| `startQueueWorker` | ingest |
| `startSupervisor`（写 monitoring） | ingest（单写） |
| `startEventLoopProbe` / `startAiTunnelCircuit` | ingest |
| Cloudflare Tunnel | web |
| Express static `public` `/media` | web |
