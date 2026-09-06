# T20 实现备注（Cursor 并行交付，供 Gemini 落地）

> 基线：`253b8aa`。勿改生产 `ecosystem.config.cjs`。  
> 目标：让 `monitoring/readonly-api-router.js` + `web_runner` 满足 `public/app.js` 读面。

## 0. 新增阻断（Cursor 发现）

**`web_runner` 原先无 Basic Auth**；现网 `server.js` 用 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`，API 无凭证 → 401。  
Cursor 已抽出并挂载：

- `monitoring/dashboard-basic-auth.js`
- `scripts/web_runner.js` 已 `app.use(dashboardBasicAuthMiddleware)`
- `test/test_dashboard_basic_auth.js`

Gemini **勿删**；R5 记为 **T22**。Tunnel=`1` 时无 Auth = 公网裸奔。

---

## 1. 契约金样（来自 `server.js` + `app.js`，非猜测）

| 路径 | 必须形状 | frontend 取值 |
|---|---|---|
| `GET /api/config` | `{ success:true, data:{ LAST_SYNC_TIME, MOCK_TRADING_MODE, AI_PROVIDER, … } }` | `result.data` |
| `GET /api/messages` | `{ success, data, total }` + 支持 `speakerMode/search/channelId/...` | `result.data` |
| `GET /api/channels` | `{ success, data }` | `result.data` |
| `GET /api/speakers` | `{ success, speakers }`（排除大 V） | `result.speakers` |
| `GET /api/reports` | `{ success, data, total }` | `result.data` / `total` |
| `GET /api/news-summaries` | `{ success, summaries }` | `data.summaries` |
| `GET /api/news-summaries/status` | `{ success, status, error?, updatedAt? }` | `statusData.status` |
| `GET /api/persona/latest` | `{ success, playbook }` | 已有 |
| `GET /api/gpu/status` | `{ success, data: gpuLock对象 }` | 监控等 |
| `GET /api/system/monitor` | `{ success, data:{ rateLimiterStats, … } }` | `json.data.rateLimiterStats` |
| `GET /api/quant/portfolio\|positions\|orders` | `{ success, data }` | `fetchQuantData` |
| `GET /api/messages/:id/context` | `{ success, messages, targetId, … }` | context 弹层 |
| `GET /api/proxy-image` | 图片流 / 400 | 消息图 |

---

## 2. 推荐实现策略（少重复）

### 2.1 messages / reports / channels / context

优先给 `database.js` 的 `getMessages` / `getReports` / `getDistinctChannels` / `getMessageContext` 增加可选 `dbInstance`（默认 `getDb()`），只读路由传入 `getReadOnlyArchiveDb()`。

`speakerMode` 解析逻辑直接复制 `server.js` `app.get('/api/messages')`（约 676–729 行），不要简化。

注意：`getMessages` 依赖 SQLite 自定义函数 `has_image` / `has_link` / `is_text_only`——只读连接也必须注册同样 UDF（查 `initDb` / `getDb` 注册点，在 `getReadOnlyArchiveDb` 首次打开时复用）。

### 2.2 config

对齐 `server.js` 1842–1879：返回 `data`（可 mask secrets）；`LAST_SYNC_TIME` 用只读库读 portfolio/同步键，或抽 `getLastSyncTime({ dbInstance })`。

### 2.3 proxy-image

可从 `server.js` 737+ 迁到 `monitoring/proxy-image-handler.js`，web 挂载；只读本地 `data/media`，远程拉取不写主库即可。

### 2.4 quant

只读调用 `getUnifiedPortfolio` / `getUnifiedPositions` / orders 查询；写接口继续 403。

### 2.5 system/monitor

不要只塞 `buildHealthPayload`；至少提供 `app.js` 用到的 `rateLimiterStats`、本地模型状态、队列摘要等字段（可简化数值，但键名要对）。

---

## 3. 单测验收（T20）

扩展 `test/test_readonly_api_routes.js`（或新文件）断言：

1. `config.data.LAST_SYNC_TIME` 键存在（可为 null）
2. `messages?speakerMode=speakers` 不抛错且 `data` 为数组
3. `GET /api/proxy-image` 无参 → 400（非 404）
4. `GET /api/messages/:id/context` → 200 且含 `messages` 或明确空
5. `GET /api/quant/portfolio` → `{ success, data }`
6. `gpu` → `data` 键存在
7. 写操作仍 403
8. 配置了 `DASHBOARD_*` 时无 Auth → 401；`/health` 仍 200

---

## 4. T21 提醒

- sample：`ENABLE_TUNNEL=1` 灰度检查项写进 Runbook §3  
- Runbook §6 删除「Tunnel/Auto News 未迁」表述  
- `test_ingest_runner` 首测必须 mock `autoSchedulerFn`，禁止默认打真实 news-engine
