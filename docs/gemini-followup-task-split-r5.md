# R4 复核结论（Cursor，`95994c1`）

> 日期：2026-09-05。本地 10 组单测 Exit 0。生产仍为单体，**未批准灰度**。

## 总评

| 任务 | 判定 | 说明 |
|---|---|---|
| T15 Auto News/Persona | **通过（骨架）** | 已抽 `auto-schedulers.js` 并在 ingest 成功路径调用 |
| T16 Tunnel | **条件通过** | 开关正确；sample 默认 `ENABLE_TUNNEL=0`，切灰若不显式置 `1` 公网仍断 |
| T17 Supervisor/探针 | **通过** | `launchMonitoringProbes` 迁入 ingest |
| T18 只读 API 契约 | **未通过** | 键名部分修好，但与 `public/app.js` **仍未 100% 对齐**（见下） |
| T19 Runbook | **大体通过** | 停单体→起 sample 正确；§6 关闭清单过时 |

**结论：T15–T17/T19 可认；T18 仍阻断「完整看板灰度」。未关闭 T18 前不要 GCP 切双进程。**

---

## T18 仍存缺口（对照 `docs/p1-11-t18-api-contract-gaps.md`）

### 阻断 / 高优

| 项 | 现网 | 只读现状 | 影响 |
|---|---|---|---|
| `GET /api/config` | `{ success, data: { LAST_SYNC_TIME, … } }` | `{ success, config: { aiProvider… } }` | `fetchConfig` 读 `result.data` → **设置页/上次同步崩溃或空白** |
| `GET /api/messages` 过滤 | `getMessages(speakerMode/search/…)` | 无过滤，仅 LIMIT | 看板筛选失效，默认非「只看大V」 |
| `GET /api/proxy-image` | 有 | **未挂** | 消息图片全挂 |
| `GET /api/messages/:id/context` | 有 | **未挂** | 上下文弹层失败 |
| `GET /api/quant/*` | portfolio/positions/orders | **未挂** | 量化页空 |

### 中优

| 项 | 问题 |
|---|---|
| `GET /api/gpu/status` | 缺 `data` 包装（现网 `data: global.gpuLock`） |
| `GET /api/system/monitor` | 返回 `buildHealthPayload`，与单体丰富监控 JSON **形状不同** |
| speakers 过滤 | 未排除 `TARGET_SPEAKER_USER_IDS` |
| 单测 | 未断言 `config.data`、`proxy-image`、messages 过滤；宣称「现网所有前端接口」过宽 |

### 已修好（确认）

channels/reports/news 的 `data`/`summaries`/`total` 兼备键；403 写拦截；persona/latest、news status 骨架有。

---

## 其它观察

1. **T16**：灰度时 sample 必须 `ENABLE_TUNNEL=1`（或 Runbook 写明改用固定域名/SSH 端口转发）。默认 0 ≠ 现网公网可达。
2. **T15 单测副作用**：`test_ingest_runner` 首测未 mock `autoSchedulerFn` 时会打到真实 `news-engine`（本地已见 Auto-generating 日志）。应默认 mock，避免误触生成。
3. **Runbook §6** 仍写「关闭清单：Tunnel、Auto News…」——与 §0「已闭环」矛盾，应删或改为「已迁入，勿再当缺口」。
4. 生产 `ecosystem.config.cjs` 未改 ✅；VM 仍单体 online ✅。

---

## 建议给 Gemini（R5 最小集）

**T20** — 按本表修 T18：config=`data` + LAST_SYNC_TIME；messages 复用/对齐 `getMessages`；挂 proxy-image + context；挂 quant 只读三路由；单测按 `app.js` 取值路径断言。  
详见 [`docs/p1-11-t20-readonly-implementation-notes.md`](./p1-11-t20-readonly-implementation-notes.md)。

**T21** — sample/Runbook：灰度检查清单强制确认 `ENABLE_TUNNEL`；修 §6；ingest 单测默认 mock auto schedulers。

**T22（Cursor 新发现，P0 安全）** — `web_runner` 必须挂与现网一致的 Basic Auth。  
Cursor 已落地 `monitoring/dashboard-basic-auth.js` + web 挂载 + 单测；Gemini **保留并回归**，Tunnel=1 时无 Auth 禁止灰度。

通过 **T20 + T22** 后再提灰度申请。
