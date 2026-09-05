# P2-11 DOM 契约（P2-D / Cursor）

> 日期：2026-09-05  
> 依据：`docs/p2-11-health-dashboard-wireframe.md` §2 / §5（P2-B 定稿）  
> 用途：Gemini **P2-E** 只绑定本表 `id` / `data-*`，**不改 HTML 结构**。

---

## 1. 文件

| 路径 | Owner | 说明 |
|---|---|---|
| `public/monitoring.html` | Cursor P2-D | 骨架 |
| `public/monitoring.css` | Cursor P2-D | 样式 |
| `public/monitoring.js` | Gemini P2-E | 轮询与填数（本轮仅占位 stub） |

---

## 2. 稳定选择器

### 全局 / Banner

| 选择器 | 用途 | 数据路径 |
|---|---|---|
| `#fetch-error` | 拉取失败横幅（默认 hidden） | 网络/5xx |
| `#dash-title` | 标题文案（静态） | — |
| `#market-et` | 美东时间 + 休市文案 | `market.currentET` + `market.statusText` |
| `#market-bj` | 北京时间 | `serverTimeBeijing` |
| `#refresh-label` | 「刷新: 5s」等 | 前端本地 |
| `#global-status` | 总状态文案 | `overall.status` |
| `#global-status` `[data-status-dot]` | 色点 | 同上 |
| `#mem-line` | 整行内存文案容器 | — |
| `#mem-web` | Web RSS | `overall.memory.webRssMb` |
| `#mem-ingest` | Ingest RSS | `overall.memory.ingestRssMb`（可空） |
| `#mem-combined` | 合计 | `overall.memory.combinedRssMb`（可空） |
| `#mem-budget` | 预算 MB | `overall.memory.budgetMb` |
| `#mem-percent` | 占用百分比 | `overall.memory.budgetPercent` |
| `#mem-note` | 「仅看板进程」等 | `overall.memory.note` / 前端派生 |
| `#uptime` | Web uptime | `overall.uptimeSeconds` |

### 子系统网格（7 格）

每格根节点：`[data-subsystem="<key>"]`  
固定 key（与契约一致，顺序即展示序）：

1. `ingest`
2. `aiTunnel`
3. `eventLoop`
4. `monitoringDb`
5. `queues`
6. `assets`
7. `pushPipeline`

格内约定：

| 选择器 | 用途 |
|---|---|
| `[data-subsystem] [data-role="status"]` | 状态文案 + `data-level="ok\|warn\|critical\|unknown"` |
| `[data-subsystem] [data-role="detail"]` | 多行明细（可 `innerHTML` 安全文本拼接） |
| `[data-subsystem] [data-role="title"]` | 静态标题（勿改文案结构） |

### 趋势 / 告警

| 选择器 | 用途 | 数据路径 |
|---|---|---|
| `#spark-memory` | SVG 或 polyline 容器 | `sparklines.timestamps` + `memoryRss` |
| `#spark-memory-caption` | 说明 | `sparklines.notes.memoryRss` |
| `#spark-push` | 推送时序容器 | `sparklines.pushP95` |
| `#spark-push-empty` | 无采样占位（默认可见） | `notes.pushP95 === "not_sampled"` 或空数组 |
| `#alert-feed` | `<ul>` 告警列表 | `recentAlerts[]` |
| `#alert-feed-empty` | 无告警占位 | — |

### 根状态 class

| 选择器 | class | 含义 |
|---|---|---|
| `body` | `.dash-degraded` | 上次成功数据保留 + 半透明（fetch 失败） |
| `body` | `.dash-ok` / `.dash-warn` / `.dash-critical` | 对齐 `overall.status` |
| `[data-level]` | `ok` / `warn` / `critical` / `unknown` | 格点上色 |

---

## 3. P2-E 填写规则（摘要）

- `fetch('/api/monitoring/dashboard')`，可见 5s / `hidden` 30s。  
- `ingestRssMb == null` → 隐藏合计句式，显示 `#mem-note`「仅看板进程」。  
- `pushP95` 空 → 显示 `#spark-push-empty`，**禁止**画假线。  
- 零写接口；不改本契约以外的 DOM 树。

---

## 4. 审阅

| 角色 | 结论 |
|---|---|
| Cursor | P2-D DOM 契约锁定 |
| Gemini | P2-E 前确认无歧义后签字 |
