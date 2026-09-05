# P2-11 健康看板（Health Dashboard）架构草图与规范

> 对应任务：`docs/gemini-followup-task-split.md` 之 T4 任务。  
> 核心定位：**单页极简只读仪表盘**，一览系统体征、红黄绿状态网格、最近告警流与资产/队列/推送水线。  
> 架构原则：**纯只读**（只读 `monitoring.db` + `/health` 快照），**无重型前端框架**（纯原生 Vanilla JS + CSS Grid，零构建依赖，极低开销）。

---

## 1. 总体架构与数据流

```mermaid
flowchart TD
    subgraph Storage [数据面 (纯只读)]
        MDB[(monitoring.db\n只读模式)]
        HealthMemory[内存快照 /health]
    end

    subgraph Backend [Web 进程路由]
        API["GET /api/monitoring/dashboard\n(聚合聚合健康、指标走势与告警)"]
        HTML["GET /monitoring\n(静态 HTML/CSS/JS 交付)"]
    end

    subgraph Browser [前端看板 UI (5s 轮询)]
        Hero[顶部状态 Banner & 内存预算]
        Grid[6 大子系统红黄绿九宫格]
        Trends[内存/时延 1小时迷你趋势]
        Alerts[实时告警事件流]
    end

    MDB -->|只读读取 alert_events & metrics| API
    HealthMemory -->|实时内存/子系统状态| API
    API -->|JSON Payload| Browser
    HTML -->|SPA 静态骨架| Browser
```

---

## 2. 页面布局与视觉草图 (Wireframe)

```
+---------------------------------------------------------------------------------------------------+
|  [●] WHOP-BRIDGE 生产监控看门狗看板       [ 美东: 04:37 ET (休市) | 北京: 16:37 CST ]   [ 刷新: 5s ⟳ ]  |
+---------------------------------------------------------------------------------------------------+
|  GLOBAL STATUS:  [  ● HEALTHY (OK)  ]   |  MEM RSS: 96MB / 958MB (10%)  |  UPTIME: 14h 42m         |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [ 核心子系统健康状态矩阵 (Subsystems Grid) ]                                                     |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  | [A] 基础网络与 Tunnel     | | [B] 事件循环与调度        | | [C] 存储与 SQLite                | |
|  | 状态: ● OK                | | 状态: ● OK                | | 状态: ● OK                       | |
|  | - Cloudflare: Connected   | | - Loop Lag: 4.2ms (P95)   | | - 主库锁定: 正常 (WAL: 1.2MB)    | |
|  | - DNS/外网: 正常 (0% 丢包)| | - 活跃调度: 正常          | | - monitoring.db: WAL 0.4MB       | |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  | [D] 队列与背压            | | [E] 离线资产新鲜度        | | [F] 消息推送链路                 | |
|  | 状态: ● OK                | | 状态: ● OK (休市免检)     | | 状态: ● OK                       | |
|  | - Media 待下载: 0 / 419   | | - Persona: 0.0天 (最新)   | | - 推送 P95: 180ms                | |
|  | - Offline 积压: 0         | | - L2a 水位: 0.1天前       | | - 连续失败: 0 次 (去重率 98.4%)  | |
|  | - 任务重试: 0             | | - News: 阶段免检(周末)    | | - 企微状态: 绿灯                 | |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
|  [ 最近 1 小时指标趋势 (Micro Trends) ]            |  [ 实时告警事件流 (Live Alert Feed) ]        |
|                                                    |                                              |
|  内存占用趋势 (RSS MB):                            |  [16:12:01] 🟢 RECOVERY: News 休市免检恢复正常 |
|  120 |                                             |  [08:01:18] 🟢 ASSET: Persona Playbook 增量完成|
|   90 | ~~~/\~~~/\~~~~~~~~~~~ (96MB)                |  [04:00:22] 🟡 WARN: eventLoop spike (182ms)  |
|   60 |                                             |  [02:15:00] 🟢 RECOVERY: 企微推送链路时延恢复正常|
|    0 +---------------------------------            |  [02:14:10] 🟡 WARN: 企微单次推送重试 (TTL 3.2s) |
|                                                    |                                              |
|  推送 P95 延迟 (ms):                               |  (显示最近 20 条，支持按等级筛选: 全部/告警)  |
|  500 |                                             |                                              |
|  200 | ~~~~~~~~~~~~~~~~~~~ (180ms)                 |                                              |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. 数据源映射表 (Data Source Mapping)

看板数据通过单一轻量接口 `GET /api/monitoring/dashboard` 一次性获取，服务端严格走只读通道：

| 看板区块 | 展示字段 | 底层数据源 | 查询方式 / 字段路径 |
|---|---|---|---|
| **全局 Banner** | `status` (ok/warn/critical) | 内存快照 | `checkSystemHealth().status` |
| | `rss`, `heapUsed` | Node.js 运行时 | `process.memoryUsage().rss` |
| | `uptime` | Node.js 运行时 | `process.uptime()` |
| | `marketStatus` | 日历模块 | `isWeekendOrHoliday()` + `getEasternTimeParts()` |
| **A 网络与Tunnel** | `cfTunnel`, `dns` | `monitoring.db` | `SELECT * FROM subsystem_snapshots WHERE name='network'` |
| **B 事件循环** | `eventLoopLagP95` | `monitoring.db` | 时序采样表最近 10 次均值 |
| **C 存储与SQLite** | `walSizeBytes`, `isLocked` | 文件系统 & 连接状态 | 主库 & 监控库 `PRAGMA wal_checkpoint(PASSIVE)` |
| **D 队列与背压** | `mediaPending`, `offlineBacklog` | `whop_archive.db` (只读) | `SELECT count(*) FROM media_fetch_queue WHERE status='pending'` |
| **E 离线资产** | `personaLag`, `l2aLag`, `newsStatus` | `asset-freshness-probe.js` | `getAssetFreshnessSnapshot().assets` |
| **F 推送链路** | `p95LatencyMs`, `consecutiveFailures`| `push-latency-probe.js` | `getPushLatencySnapshot()` |
| **趋势微图** | 1小时 RSS / P95 数组 | `monitoring.db` | `SELECT timestamp, metric_name, value FROM metrics_timeseries WHERE timestamp > ?` |
| **告警事件流** | 最近 20 条告警列表 | `monitoring.db` | `SELECT * FROM alert_events ORDER BY created_at DESC LIMIT 20` |

---

## 4. API 契约设计 (`GET /api/monitoring/dashboard`)

```json
{
  "success": true,
  "timestamp": 1788599850000,
  "serverTimeBeijing": "2026-09-05 16:37:30",
  "market": {
    "isClosed": true,
    "currentET": "2026-09-05 04:37:30 ET",
    "statusText": "周末休市"
  },
  "overall": {
    "status": "ok",
    "score": 100,
    "uptimeSeconds": 52920,
    "memory": {
      "rssMb": 96.2,
      "heapUsedMb": 58.4,
      "budgetMb": 958.0,
      "budgetPercent": 10.0
    }
  },
  "subsystems": {
    "network": { "status": "ok", "detail": "CF Tunnel 正常" },
    "event_loop": { "status": "ok", "lagP95Ms": 4.2 },
    "database": { "status": "ok", "walMb": 1.2, "readonlySafe": true },
    "queues": { "status": "ok", "mediaPending": 0, "offlinePending": 0 },
    "assets": {
      "status": "ok",
      "persona": { "lagDays": 0.0, "status": "ok" },
      "l2a": { "lagDays": 0.1, "status": "ok" },
      "news": { "status": "ok", "description": "休市空窗免检（未生成）" }
    },
    "push": { "status": "ok", "p95LatencyMs": 180, "consecutiveFailures": 0 }
  },
  "recentAlerts": [
    {
      "id": 1024,
      "level": "warn",
      "subsystem": "event_loop",
      "message": "EventLoop 延迟尖刺 182ms (超过阈值 150ms)",
      "createdAt": 1788554422000,
      "createdAtBeijing": "2026-09-05 04:00:22"
    }
  ],
  "sparklines": {
    "timestamps": [1788596250000, 1788598050000, 1788599850000],
    "memoryRss": [94.1, 95.8, 96.2],
    "pushP95": [175, 182, 180]
  }
}
```

---

## 5. 前端实现原则（零依赖、纯原生）

1. **单文件交付**：直接通过 `public/monitoring.html` 独立托管，无需 Webpack、Vite 或 npm 依赖构建；
2. **轻量 SVG 趋势图**：利用内联 `<svg>` 动态生成 polyline 点阵，不引入 Chart.js / ECharts，节省浏览器及 Node.js 内存；
3. **5 秒无感静默轮询**：前端通过 `fetch` 请求，出错时自动重试且页面置灰；
4. **安全与隔离**：
   - 所有数据库读取使用只读连接句柄 `new Database('monitoring.db', { readonly: true })`；
   - 接口不接受任何修改参数，严防写操作注入；
   - 在 P1-11 落地后，直接天然挂载在 `whop-web-dashboard` 独立进程上。
