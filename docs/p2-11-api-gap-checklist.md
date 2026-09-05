# P2-11 API 缺口清单（P2-A / Cursor）

> 日期：2026-09-05  
> 对照：`docs/p2-11-health-dashboard-wireframe.md` §3–4  
> 实现：`monitoring/dashboard-api.js` + `monitoring/health.js` + `monitoring/monitoring-db.js`  
> 用途：Gemini 做 **P2-C** 的改改清单；Gemini **P2-B** 应把线框键名改成与真实表/健康快照一致。

---

## 1. 总览

| 区块 | 线框期望 | 现状 | 判定 |
|---|---|---|---|
| `market` / `serverTimeBeijing` | 完整 | 已实现 | ✅ 已实现 |
| `overall.status` / `uptime` / `memory` | 完整 | 有；缺 `score`；内存=**本进程(web) RSS** | ⚠️ 半实现 / 语义误导 |
| `subsystems` 六格 A–F | 固定键名 | 来自 `/health` 快照键名不同 + 多了 `ingest`/`alerts`/`process` | ⚠️ 半实现（数据有，契约漂移） |
| `recentAlerts` | `alert_events` | 读 **`alert_history`**（真实表） | ✅ 表名以代码为准；线框需改 |
| `sparklines.memoryRss` | 1h 序列 | 读 **`metric_samples.memory_rss_mb`** | ✅ 半实现（来源对；进程语义待定） |
| `sparklines.pushP95` | 真实 P95 | **`samples.map(() => 180)` 假常数** | 🚫 stub / 假绿灯风险 |
| `GET /monitoring` 静态页 | HTML/CSS/JS | **不存在**（仅有 `public/index.html`） | 🚫 缺失（P2-D/F） |
| `GET /api/monitoring/dashboard` 路由 | 有 | `web_runner` 已挂 | ✅ 已实现 |

---

## 2. 表名 / 数据源：线框 vs 真实

| 线框写法 | 真实实现 | 建议（P2-B/C） |
|---|---|---|
| `alert_events` | `alert_history`（列：`title/detail/sent_at/sent_at_beijing`） | **改线框**；API 继续用 `alert_history` |
| `metrics_timeseries (metric_name,value)` | `metric_samples`（宽表：`memory_rss_mb`, `event_loop_*`, `media_pending`…） | **改线框**；无独立 push P95 列 |
| `subsystem_snapshots WHERE name='network'` | **无此表**；网络态来自 `aiTunnel` 注入 / 内存快照 | 删除该查询；用 `health.subsystems.aiTunnel` |
| `PRAGMA wal_checkpoint` 展示主库 WAL | `getMonitoringDbStats()` 只计行数，**无 WAL MB** | 可选只读 `PRAGMA`/`stat`；无数据则 `null` + `note` |
| `getPushLatencySnapshot()` | 实为 `getPushPipelineSnapshot()` → `recentP95TtlMs` 等 | 线框改名；**禁止**用常数 180 |

**metric_samples 现有列（无可写扩展本轮）**

```
ts, created_at_beijing, event_loop_mean_ms, event_loop_p99_ms, event_loop_max_ms,
memory_rss_mb, media_pending, total_pending
```

→ `sparklines.pushP95`：**无列可填** → 应返回 `[]` 或整体 `null`，并在 payload 加 `sparklines.notes.pushP95: "not_sampled"`。  
可选后续（非本轮）：从 `push-latency-probe` 环形缓冲导出最近点；仍不要假数。

---

## 3. `subsystems` 键名漂移（线框 A–F ↔ health）

| 线框键 | health / dashboard 实际键 | 网格建议 |
|---|---|---|
| `network` | `aiTunnel`（+ 可选 tunnel launcher 状态） | Banner/格 A 读 `aiTunnel`；或 dashboard **规范化别名** `network ← aiTunnel` |
| `event_loop` | `eventLoop` | 统一 camelCase **或** 在 dashboard 层映射 |
| `database` | `monitoringDb`（无 archive 锁/WAL） | 线框改名；WAL 字段暂 `null` |
| `queues` | `queues` | ✅ |
| `assets` | `assets`（形状以 probe 为准） | 核对 `persona/l2a/news` 是否与线框嵌套一致 |
| `push` | `pushPipeline`（含 `recentP95TtlMs`, `consecutiveFailures` 等） | 映射或改线框 |
| （无） | `ingest`（双进程关键） | **应进网格**（第 7 格或替换 process）；P2-B 必须写进线框 |
| （无） | `process` / `alerts` | 可留在 payload，UI 可不展示 |

**Dashboard 当前行为**：`...(healthSnap.subsystems)` 后再覆盖 `ingest`（`evaluateIngestStatus`）。  
注意：`health` 在 `ROLE=web_dashboard` 时已带 `ingest`（来自 heartbeat），dashboard 再算一遍 — **可接受**，但两处 description 可能不一致；P2-C 建议只保留一处权威（推荐 dashboard 的 `evaluateIngestStatus`）。

---

## 4. 双进程内存语义（阻塞级误导）

`overall.memory.rssMb` = **`process.memoryUsage()` of web_dashboard only**。  
在 958MB 机上展示「96MB / 958MB」会低估；ingest RSS 不在此进程。

**P2-B 契约建议（任选其一，须写死）：**

```json
"memory": {
  "webRssMb": 45.2,
  "ingestRssMb": null,
  "combinedRssMb": null,
  "budgetMb": 958.0,
  "budgetPercent": null,
  "note": "ingestRss from heartbeat.detail_json if present; else null"
}
```

- `ingestRssMb`：若 `ingest_heartbeat.detail_json` 含 rss 则填，否则 `null`（**不要**用假数）。  
- Banner 文案：有合计用合计；否则明确「Web only」。  
- `sparklines.memoryRss`：今日采样来自 **ingest 写库** 时反映 ingest 进程；web 本地趋势另议。P2-C 须在 `sparklines.notes.memoryRss` 注明采样进程。

---

## 5. 字段级：已实现 / stub / 缺失

### overall
| 字段 | 状态 | 动作 |
|---|---|---|
| `status` | ✅ | 保持（来自 health） |
| `score` | 🚫 缺失 | 线框删掉 **或** P2-C 用简单映射 ok=100/warn=60/critical=20 |
| `uptimeSeconds` | ✅ | 仅 web uptime；线框注明 |
| `memory.*` | ⚠️ | 按 §4 扩展双进程字段 |

### recentAlerts
| 字段 | 状态 | 动作 |
|---|---|---|
| 查询 `alert_history` | ✅ | 保持 |
| `message` ← `title` | ✅ | OK |
| `createdAt` ← `sent_at` | ✅ | OK |
| 空表 / DB 不可用 | ✅ `[]` | OK；前端勿当错误 |

### sparklines
| 字段 | 状态 | 动作 |
|---|---|---|
| `memoryRss` from `metric_samples` | ✅/⚠️ | 保留；加 note 进程语义 |
| `pushP95` = 180 | 🚫 **假数据** | **P2-C 必须删除 stub** → `[]` 或 `null` |
| 空库 | ✅ 空数组 | OK |

### 路由 / 页
| 项 | 状态 | Owner |
|---|---|---|
| API 路由 | ✅ | — |
| `public/monitoring.html` | 🚫 | P2-D |
| `GET /monitoring` 显式路由 | ⚠️ static 可碰巧服务文件，但文件不存在 | P2-F |
| Basic Auth 覆盖 `/monitoring` | ✅ middleware 全局（`/health` 例外需确认） | P2-F 复核 |

---

## 6. P2-C（Gemini）最小改动清单

1. **删除** `pushP95` 假常数；无采样则空数组 + `notes`。  
2. **对齐契约**：要么改 payload 键名为线框，要么（推荐）改线框/前端读真实键；二选一并在 P2-B 定稿。  
3. **双进程 memory 字段**（§4）；`ingestRssMb` 可 null。  
4. **确认只读**：继续 `getReadOnlyMonitoringDb()`；禁止 `getMonitoringDb()` / checkpoint 写。  
5. **更新** `test/test_dashboard_api.js`：断言无恒定 `180`；可选断言 `memory.webRssMb` 或 note。  
6. **不要**新建 `alert_events` / `metrics_timeseries` / `subsystem_snapshots` 表。

---

## 7. 给 P2-B（Gemini）的线框修订要点

- §3 表名改为 `alert_history` / `metric_samples`。  
- §4 JSON 键与 `health.subsystems` 对齐，并加入 `ingest` 格。  
- Banner 内存改为 web / ingest / combined。  
- 注明 Tunnel URL 随 quick tunnel 重启变化。  
- 删除「假 P95 180」示例或标明 `null` 示例。

---

## 8. 审阅签字

| 角色 | 结论 | 日期 |
|---|---|---|
| Cursor（作者） | P2-A 完成，可开 G1 | 2026-09-05 |
| Gemini（审阅） | _待填：同意 / 需补_ | |

**阻塞级提醒**：假 `pushP95=180`、把 web RSS 当整机占用、为对齐线框去建不存在的表——均不可合入。
