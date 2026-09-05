# P2-11 健康看板（Health Dashboard）架构草图与规范 (修订版)

> 对应任务：`docs/p2-11-task-split-parallel.md` 之 P2-B 任务（依据 Cursor P2-A `docs/p2-11-api-gap-checklist.md` 修订）。  
> 核心定位：**单页极简只读仪表盘**，一览系统体征、红黄绿状态网格、最近告警流与资产/队列/推送水线。  
> 架构原则：**纯只读**（只读 `monitoring.db` + `/health` 快照），**无重型前端框架**（纯原生 Vanilla JS + CSS Grid，零构建依赖，极低开销）。  
> 双进程语义：明确区分 **Web 进程** 与 **Ingest 进程** 状态与内存占用；**严禁使用假数据（如常数 P95）**。

---

## 1. 总体架构与数据流

```mermaid
flowchart TD
    subgraph Storage [数据面 (纯只读)]
        MDB[(monitoring.db\n只读模式)]
        ArchiveDB[(whop_archive.db\n只读模式)]
        HealthMemory[内存快照 /health]
    end

    subgraph Backend [Web 进程路由 (ROLE=web_dashboard)]
        API["GET /api/monitoring/dashboard\n(聚合健康、指标走势与告警)"]
        HTML["GET /monitoring\n(静态 HTML/CSS/JS 交付，Basic Auth 保护)"]
    end

    subgraph Browser [前端看板 UI (5s 轮询)]
        Hero[顶部状态 Banner & 双进程内存预算]
        Grid[7 大核心子系统红黄绿矩阵]
        Trends[内存 1 小时趋势 & 时延采样状态]
        Alerts[实时告警事件流]
    end

    MDB -->|只读读取 alert_history & metric_samples & ingest_heartbeat| API
    HealthMemory -->|实时内存/子系统快照| API
    ArchiveDB -.->|只读查询队列水位 (按需)| API
    API -->|JSON Payload| Browser
    HTML -->|SPA 静态骨架| Browser
```

---

## 2. 页面布局与视觉草图 (Wireframe)

```
+---------------------------------------------------------------------------------------------------+
|  [●] WHOP-BRIDGE 生产监控看门狗看板       [ 美东: 04:37 ET (休市) | 北京: 16:37 CST ]   [ 刷新: 5s ⟳ ]  |
+---------------------------------------------------------------------------------------------------+
|  GLOBAL STATUS:  [  ● HEALTHY (OK)  ]                                                             |
|  MEM RSS: Web 45.2MB + Ingest 49.8MB = 合计 95.0MB / 958MB (9.9%)  |  UPTIME: 14h 42m (Web 进程)  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [ 核心子系统健康状态矩阵 (Subsystems Grid - 7 大关键维度) ]                                      |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  | [1] Ingest 轮询引擎 (核心)| | [2] 基础网络与 AI Tunnel  | | [3] 事件循环 (EventLoop)         | |
|  | 状态: ● OK                | | 状态: ● OK                | | 状态: ● OK                       | |
|  | - 心跳延迟: 28s (<90s)    | | - AI Tunnel 熔断器: 闭合  | | - Lag: 4.2ms (P95) / 12ms (Max)  | |
|  | - 最近结果: ok (耗时 320ms)| | - CF Tunnel: 运行中 (注1) | | - 采样周期: 10s 探针             | |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  | [4] 监控存储 (monitoring) | | [5] 任务队列与背压        | | [6] 离线资产新鲜度 (Assets)      | |
|  | 状态: ● OK                | | 状态: ● OK                | | 状态: ● OK (休市免检)            | |
|  | - 模式: WAL 只读保护      | | - Media 待下载: 0         | | - Persona: 0.0天 (最新就绪)      | |
|  | - 连接状态: 活跃正常      | | - Offline 离线积压: 0     | | - L2a 水位: 0.1天前 (稳态)       | |
|  | - 独立写者: Ingest 独占   | | - 阶梯背压: 正常 (0 降频) | | - News: 阶段免检 (周末闭盘)      | |
|  +---------------------------+ +---------------------------+ +----------------------------------+ |
|  +----------------------------------------------------------------------------------------------+ |
|  | [7] 消息推送链路 (Push Pipeline)                                                             | |
|  | 状态: ● OK  |  连续失败: 0 次  |  重试熔断: 正常  |  实时 P95 TTL: 180ms (环形缓冲)          | |
|  +----------------------------------------------------------------------------------------------+ |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
|  [ 最近 1 小时指标趋势 (Micro Trends) ]            |  [ 实时告警事件流 (Live Alert Feed) ]        |
|                                                    |                                              |
|  内存占用趋势 (RSS MB，来源: Ingest 定时采样):     |  [16:12:01] 🟢 RECOVERY: News 休市免检恢复正常 |
|  120 |                                             |  [08:01:18] 🟢 ASSET: Persona Playbook 增量完成|
|   90 | ~~~/\~~~/\~~~~~~~~~~~ (95MB 合计估算)       |  [04:00:22] 🟡 WARN: eventLoop spike (182ms)  |
|   60 |                                             |  [02:15:00] 🟢 RECOVERY: 企微推送链路时延正常  |
|    0 +---------------------------------            |  [02:14:10] 🟡 WARN: 企微推送重试 (TTL 3.2s) |
|                                                    |                                              |
|  推送 P95 延迟时序 (ms):                           |  (显示最近 20 条，源自 alert_history)        |
|  [ 提示: 时序数据库未持久化采样，当前展示置灰空状态] |                                              |
|  (严禁使用常数假数据伪造绿灯)                      |                                              |
+---------------------------------------------------------------------------------------------------+
```
> **注1（Cloudflare Quick Tunnel 说明）**：当开启 `ENABLE_TUNNEL=1` 时，使用 TryCloudflare 临时免费通道，每次进程重启分配的临时域名均会变化，生产请以当前进程标准输出之 URL 或自建固定域名为准。

---

## 3. 数据源真实映射表 (Data Source Mapping)

看板数据通过单一轻量接口 `GET /api/monitoring/dashboard` 一次性获取，服务端严格走只读通道：

| 看板区块 | 展示字段 | 底层数据源 | 查询方式 / 字段路径 |
|---|---|---|---|
| **全局 Banner** | `status` (ok/warn/critical) | 内存快照 | `checkSystemHealth().status` / `healthSnap.status` |
| | `webRssMb` | Node.js 运行时 | `Math.round(process.memoryUsage().rss / 1048576 * 10) / 10` |
| | `ingestRssMb` | Ingest 心跳包 | `ingest_heartbeat.detail_json` 中的 `rssMb` (若无则为 `null`) |
| | `combinedRssMb` | 组合计算 | `webRssMb + (ingestRssMb || 0)`（若 ingest 无则标注仅 Web） |
| | `uptime` | Web 进程运行时 | `Math.round(process.uptime())` (看板 Web 实例运行时间) |
| | `marketStatus` | 交易日历模块 | `isWeekendOrHoliday()` + `getEasternTimeParts()` |
| **1 Ingest 引擎** | `status`, `delaySec`, `lastOutcome` | `monitoring.db` (只读) | 表 `ingest_heartbeat` (通过 `getIngestHeartbeat('primary')`) |
| **2 网络与 Tunnel**| `status`, `aiTunnel`, `cfTunnel` | 内存探针 | `healthSnap.subsystems.aiTunnel` + Tunnel launcher 状态 |
| **3 事件循环** | `eventLoopLagP95`, `status` | 内存探针 / 采样 | `healthSnap.subsystems.eventLoop` (P95/Max/Mean) |
| **4 监控存储** | `status`, `readonlySafe` | 内存探针 / 句柄 | `healthSnap.subsystems.monitoringDb` (WAL 与只读断言) |
| **5 队列与背压** | `mediaPending`, `offlinePending` | 内存探针 | `healthSnap.subsystems.queues` |
| **6 离线资产** | `persona`, `l2a`, `news` | 离线资产探针 | `healthSnap.subsystems.assets` (含休市免检状态) |
| **7 推送链路** | `recentP95TtlMs`, `consecutiveFailures`| 推送探针快照 | `healthSnap.subsystems.pushPipeline` |
| **趋势微图** | 1 小时内存走势 (`memoryRss`) | `monitoring.db` (只读) | `SELECT ts, memory_rss_mb FROM metric_samples WHERE ts > ?` |
| | 推送时序走势 (`pushP95`) | 真实数据约束 | **无时序采样列时返回 `[]` / `null`，严禁假常数 180** |
| **告警事件流** | 最近 20 条系统告警 | `monitoring.db` (只读) | `SELECT id, subsystem, level, title as message, sent_at as createdAt, sent_at_beijing as createdAtBeijing FROM alert_history ORDER BY sent_at DESC LIMIT 20` |

---

## 4. API 契约设计 (`GET /api/monitoring/dashboard`)

```json
{
  "success": true,
  "timestamp": 1788599850000,
  "serverTimeBeijing": "2026-09-05 16:37:30",
  "market": {
    "isClosed": true,
    "currentET": "2026-09-05 04:37 ET",
    "statusText": "休市时段"
  },
  "overall": {
    "status": "ok",
    "uptimeSeconds": 52920,
    "memory": {
      "webRssMb": 45.2,
      "ingestRssMb": 49.8,
      "combinedRssMb": 95.0,
      "budgetMb": 958.0,
      "budgetPercent": 9.9,
      "note": "ingestRss from heartbeat.detail_json if present; else null"
    }
  },
  "subsystems": {
    "ingest": {
      "status": "ok",
      "delaySec": 28,
      "description": "心跳正常 (28s 前)",
      "lastOutcome": "ok"
    },
    "aiTunnel": {
      "status": "ok",
      "state": "CLOSED",
      "description": "AI 隧道熔断器闭合 (正常)"
    },
    "eventLoop": {
      "status": "ok",
      "meanDelayMs": 1.2,
      "p99DelayMs": 4.2,
      "maxDelayMs": 12.0
    },
    "monitoringDb": {
      "status": "ok",
      "readonlySafe": true,
      "description": "只读模式连接正常"
    },
    "queues": {
      "status": "ok",
      "mediaPending": 0,
      "offlinePending": 0
    },
    "assets": {
      "status": "ok",
      "persona": { "lagDays": 0.0, "status": "ok" },
      "l2a": { "lagDays": 0.1, "status": "ok" },
      "news": { "status": "ok", "description": "休市空窗免检（未生成）", "marketClosed": true }
    },
    "pushPipeline": {
      "status": "ok",
      "recentP95TtlMs": 180,
      "consecutiveFailures": 0,
      "circuitOpen": false
    }
  },
  "recentAlerts": [
    {
      "id": 1024,
      "subsystem": "eventLoop",
      "level": "warn",
      "message": "EventLoop 延迟尖刺 182ms (超过阈值 150ms)",
      "createdAt": 1788554422000,
      "createdAtBeijing": "2026-09-05 04:00:22"
    }
  ],
  "sparklines": {
    "timestamps": [1788596250000, 1788598050000, 1788599850000],
    "memoryRss": [94.1, 95.8, 96.2],
    "pushP95": [],
    "notes": {
      "memoryRss": "from ingest metric_samples.memory_rss_mb",
      "pushP95": "not_sampled"
    }
  }
}
```

---

## 5. 前端实现原则（零依赖、纯原生、双进程与容错感知）

1. **单文件交付**：直接通过 `public/monitoring.html` + `public/monitoring.js` + `public/monitoring.css` 独立托管，无需 Webpack、Vite 或 npm 构建链；
2. **双进程内存展示容错**：
   - 若 `combinedRssMb` 存在且非 `null`，Hero 区域显示 `Web X MB + Ingest Y MB = 合计 Z MB / 958MB`；
   - 若 `ingestRssMb` 为 `null`，显式标注 `Web: X MB / 958MB (仅看板进程)`，禁止伪造或隐瞒 Ingest 内存；
3. **真实时序图与置灰机制**：
   - 内存使用内联 SVG 动态 Polyline 绘制最近 1 小时曲线；
   - 对 `pushP95: []` 或 `not_sampled`，前端友好渲染“无持久化时序采样”占位提示，**严禁使用假常数假装正常**；
4. **5 秒无感静默轮询与休眠降频**：
   - 前端通过 `fetch('/api/monitoring/dashboard')` 静默轮询；
   - 当 `document.visibilityState === 'hidden'` 时，将轮询间隔自动降低到 30s，唤醒后立即拉取一次；
   - 接口报错或断网时，看板显示顶部警告条，保留上一次数据并整体半透明置灰，不白屏；
5. **安全与权限隔离**：
   - 严格继承 `dashboardBasicAuthMiddleware` 鉴权，未登录用户无法访问静态页与 API；
   - `/health` 探针继续保持匿名豁免供 GCP 外部看门狗探测；
   - 严格纯只读，前端零任何 POST/PUT/DELETE 接口调用。
