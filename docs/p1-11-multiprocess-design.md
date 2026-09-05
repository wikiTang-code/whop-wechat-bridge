# P1-11: Web 看板与 Ingest 物理多进程隔离方案设计稿

> **设计性质**：架构设计审定稿（**禁止直接改 `ecosystem.config.cjs` 上生产，须经评审通过后另开分支落地**）。  
> **基线环境**：GCP VM (Debian, 958MB RAM, 1 vCPU, PM2, SQLite 3.40+ WAL)  
> **设计目标**：将对外只读 Web 仪表盘与高频爬虫 Ingest 拆分为独立进程，彻底消除事件循环争用与卡死波及。

---

## 1. 架构拆分动机与收益

### 1.1 现状隐患（单进程痛点）
当前 `server.js` 是一个重型单一进程（单 Event Loop）：
- **事件循环串扰**：Whop GraphQL 轮询、大批量消息入库分块切片、媒体下载、AI 路由判定均与 Express Web 路由（端口 8085 及 `/health`）运行在同一个主线程。
- **故障蔓延（Blast Radius 过大）**：一旦爬虫链路遭遇重型计算或不可抗力的主线程阻塞，外部看门狗探测 `/health` 将立即超时，导致看板无法访问甚至产生误报警。
- **内存难以精准限额**：单进程模式下，`max_memory_restart` 设为 500MB，一旦泄露极易触发宿主机 Linux OOM Killer（总内存仅 958MB）。

### 1.2 拆分后收益
1. **物理故障隔离**：Ingest 进程任何计算延迟或阻塞，绝不波及 Web 看板与对外 API 响应。
2. **读写解耦**：充分利用 SQLite WAL（Write-Ahead Logging）原生的高并发特性——**读写互不阻塞，单写多读并发**。
3. **极低内存预算**：两个轻量进程各自收紧内存上限，稳态总和 $\le 180\text{MB}$，彻底远离 OOM 险境。

---

## 2. 进程清单与职责所有权矩阵（Ownership Matrix）

拆分后系统由两个常驻 PM2 进程组成：

| 职责维度 | `whop-ingest-worker` (数据引擎) | `whop-web-dashboard` (只读面板) |
|---|---|---|
| **核心定位** | 数据爬取、大V发言实时推送、量化跟单、任务派发 | 对外 Web 仪表盘、只读 API、探针聚合、心跳暴露 |
| **入口脚本** | `scripts/ingest_runner.js` (新建精简入口) | `server.js` (剥离爬虫轮询后的 Web 服务) |
| **Whop GraphQL 轮询** | ✅ **独占**（负责 `syncAndAnalyze` 调度循环） | ❌ 无轮询 |
| **大V实时发言推送** | ✅ **独占**（发现新发言 25s 内即时推送到企业微信） | ❌ 无推送权限 |
| **量化跟单提取** | ✅ **独占**（`extractAndExecuteTrades` 交易逻辑） | ❌ 无交易逻辑 |
| **任务队列执行** | ✅ **独占**（负责 `task_queue` 派发与本地 worker） | ❌ 仅可通过只读 SQL 查询队列状态 |
| **数据库主库连接** | ✅ **单写模式**（读写连接，主库唯一写入者） | 🔒 **只读模式** (`{ readonly: true }`) |
| **HTTP 端口与路由** | 🔒 仅心跳暴露（或无端口，仅写心跳水位） | 🌐 **独占对外 8085 端口**（提供 Web 与 `/health`） |
| **Cloudflare Tunnel** | ❌ 不运行 | ✅ **独占管理**（为 8085 建立公网安全隧道） |
| **独立监控库 (R3)** | 写入：写入 Ingest 自身体征与边沿事件 | 写入/读取：读取指标提供 `/health`，写入 Web 体征 |

---

## 3. 生产 958MB 内存预算与熔断砍刀（Memory Budget）

在仅有 958MB 物理内存的 GCP VM 环境下，内存分配必须具有确定性安全边界：

```
+-------------------------------------------------------------------+
|               GCP VM 总可用内存: 958MB                             |
+-------------------------------------------------------------------+
| 宿主机 OS + 内核缓存 + PM2 守护进程:  ~380MB                       |
| 安全留白 (Buffer / 防止 OOM 抖动):   ~378MB                       |
|-------------------------------------------------------------------|
| 应用程序内存预算 (总上限 200MB):                                    |
|   ├── whop-ingest-worker: 稳态  90MB ~ 110MB (上限: 180MB 重启)    |
|   └── whop-web-dashboard: 稳态  55MB ~  70MB (上限: 130MB 重启)    |
+-------------------------------------------------------------------+
```

### 3.1 进程稳态与重启阈值配置
- **`whop-ingest-worker`**：
  - 稳态目标：`85MB ~ 110MB`
  - PM2 触发重启上限：`max_memory_restart: '180M'`
  - 降级削峰：当内存超过 140MB 时，自动挂起次要的图片深度下载与重型总结。
- **`whop-web-dashboard`**：
  - 稳态目标：`55MB ~ 70MB`
  - PM2 触发重启上限：`max_memory_restart: '130M'`
  - 由于全只读连接且无大模型与爬虫，内存曲线极度平滑。
- **两进程稳态总和**：$100\text{MB} + 65\text{MB} = 165\text{MB} \ll 220\text{MB}$，为系统保留充足弹性空间。

---

## 4. 数据面并发与 SQLite WAL 读写安全

遵循 SQLite 官方并发最佳实践与方案 R3/R4 红线：

### 4.1 主业务库 (`whop_archive.db`)
- **写锁单一化（Single-Writer Principle）**：
  - 只有 `whop-ingest-worker` 进程以读写模式打开 `whop_archive.db`；
  - 开启 `PRAGMA journal_mode = WAL;` 与 `PRAGMA synchronous = NORMAL;`；
  - 设置 `PRAGMA busy_timeout = 5000;`。
- **读通道零争用（Zero-Lock Read-Only）**：
  - `whop-web-dashboard` 打开连接时必须且只能传入 `{ readonly: true }`；
  - 在 WAL 模式下，读操作仅读取 shared-memory (`-shm`) 与 WAL 日志，读操作绝不阻塞写操作，写操作绝不阻塞读操作；
  - Web 仪表盘与 API 查询无论耗时多久，均 100% 无法卡死 Ingest 写入。

### 4.2 独立监控库 (`monitoring.db`)
- 继续严格恪守 **R3 红线**；
- Ingest 进程与 Web 进程各自持有独立连接，低频（每分钟一次）写入或读取时序采样，库体积恒定由自动清理维持在 10MB 以内。

---

## 5. 看门狗与跨进程假死感知（Heartbeat & Liveness）

在将 `/health` 剥离到 `whop-web-dashboard` 后，必须解决核心痛点：  
**“如何防止 Ingest 进程假死（主循环卡死），而 Web 进程却依然向看门狗返回 HTTP 200 的致命盲区？”**

### 5.1 解决方案：双重原子递增水位心跳（Heartbeat Probe）
1. **Ingest 进程心跳写入**：
   - `whop-ingest-worker` 每次成功执行完一轮 `syncAndAnalyze`（正常为 25s 周期），向 `pipeline_watermarks` 表更新：
     ```sql
     INSERT INTO pipeline_watermarks (pipeline_name, last_processed_ts, updated_at)
     VALUES ('ingest_heartbeat', strftime('%s','now')*1000, strftime('%s','now')*1000)
     ON CONFLICT(pipeline_name) DO UPDATE SET
       last_processed_ts = excluded.last_processed_ts,
       updated_at = excluded.updated_at;
     ```
2. **Web 进程 `/health` 联动判定**：
   - `whop-web-dashboard` 收到 `/health` 请求时，以只读方式读取 `ingest_heartbeat` 水位；
   - **健康状态机**：
     - 若 `now - heartbeat.updated_at < 60s`：`ingest.status = 'ok'`；
     - 若 `60s <= delay < 150s`：`ingest.status = 'warn'`（背压退避中，可观测）；
     - 若 `delay >= 150s`（超过最大退避 120s 容忍限度）：
       - `ingest.status = 'critical'`；
       - **整体 `/health` 立即返回 HTTP 503**！
3. **外部 Watchdog 闭环**：
   - 外部 `watchdog.sh` 请求 `/health` 收到 503 时，立即通过企业微信告警群推送通知：  
     `【CRITICAL】Whop Ingest 引擎假死告警：心跳已停滞 150 秒未更新！`
   - 恪守 **R1/R2 红线**：只向企微告警，不粗暴自动 restart。

---

## 6. 配置与部署对称性（Local & GCP VM Parity）

### 6.1 `ecosystem.config.cjs` 规范配置样例
```javascript
module.exports = {
  apps: [
    {
      name: 'whop-ingest-worker',
      script: 'scripts/ingest_runner.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '180M',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        ROLE: 'ingest_worker',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/ingest_error.log',
      out_file: './logs/ingest_out.log',
    },
    {
      name: 'whop-web-dashboard',
      script: 'server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '130M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: '8085',
        ROLE: 'web_dashboard',
        READONLY_MODE: '1',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/web_error.log',
      out_file: './logs/web_out.log',
    }
  ]
};
```

### 6.2 启动顺序规范
1. **优先拉起 `whop-ingest-worker`**：确保数据库 WAL 模式开启且主写入锁就绪；
2. **随后拉起 `whop-web-dashboard`**：以只读模式挂载库文件，并开放 8085 端口与 Cloudflare Quick Tunnel。

---

## 7. 一键无损回滚预案（Rollback Runbook）

为保证生产环境绝对安全，制定 30 秒一键回滚流程：

### 7.1 回滚触发条件
- 进程间出现意外的 SQLite Lock 错误；
- 总内存占用意外超过 240MB；
- 大V发言即时推送时延出现突发性拉长。

### 7.2 一键回滚单条命令
```bash
# 线上紧急回滚单命令：停用多进程，切换回原有单体 server.js
pm2 delete all && pm2 start server.js --name whop-wechat-bridge --max-memory-restart 500M && pm2 save
```
> **安全背书**：代码改动仅通过环境变量 `ROLE` 区分（如 `ROLE === 'ingest_worker'` 才执行轮询，`ROLE === 'web_dashboard'` 仅起 Express）。若回滚为 `whop-wechat-bridge`（无 `ROLE`），系统自动回退为原有单体模式，代码 100% 向下兼容。

---

## 8. 实施与验收推进路线

- [x] **第一阶段（T2）**：产出本设计文档，供 Cursor / 开发者团队评审；
- [ ] **第二阶段**：评审通过后，在本地创建隔离分支 `feat/p1-11-multiprocess`；
- [ ] **第三阶段**：编写 `scripts/ingest_runner.js` 与 `server.js` 门控解耦，跑通测试矩阵；
- [ ] **第四阶段**：在本地验证只读锁安全与内存，确认无误后以文件拷贝方式部署到 GCP VM 进行 24h 灰度验证。
