# P2-12 联调签字清单（P2-12h）

> **基线分支**：`feat/p1-attachments-and-ratelimiter` @ `f96eddd`  
> **联合执行**：Gemini ∥ Cursor  
> **依据**：`docs/p2-12-task-split-parallel.md` / `docs/p2-12-p2d-selfcheck.md` / `docs/p2-12-p2d-review.md`  
> **日期**：2026-09-06  
> **核心原则**：**只告警/软降级，禁止自动 `pm2 restart`（R2）**；双进程只读防写竞争（R3）；本地联调通过后双方签字，不上机生产由操作员把控。

---

## 1. 任务闭环状态总览

| 任务 ID | 内容 | Owner | 交付 Commit / 文件 | 审阅方 | 结论 |
|---|---|---|---|---|---|
| **P2-12a/b** | L2 工作台路由补齐 + 基础单测 | Cursor | `6a67348` (`scripts/web_runner.js`) | Gemini | ✅ **已通过** |
| **P2-12c** | 运行时 `routeCoverage` 探针 + `/health` 注入 | Cursor | `4d1f2a7` (`monitoring/route-coverage-probe.js`) | Gemini | ✅ **已通过** |
| **P2-12d** | 外部看门狗 `page_smoke.sh` + 告警文案 + README | Gemini | `76f96bb` (`scripts/watchdog/page_smoke.sh`) | Cursor | ✅ **已通过** (`f96eddd`) |
| **P2-12e** | Tunnel URL 写盘持久化 + health/dashboard 字段 | Gemini | `76f96bb` (`monitoring/tunnel-launcher.js`) | Cursor | ✅ **已通过** (`f96eddd`) |
| **P2-12f** | 交叉审阅文档双向对齐 | 双方 | `docs/p2-12-p2d-selfcheck.md` / `docs/p2-12-p2d-review.md` | 双方 | ✅ **互审闭环** |
| **P2-12g** | 看板增加 `routeCoverage` 与 `tunnel` 状态格展示 | Cursor | `f96eddd` (`public/monitoring.html`, `public/monitoring.js`) | Gemini | ✅ **已通过** |
| **P2-12h** | 联调签字清单与红线核验 | 双方 | `docs/p2-12-p2h-signoff.md`（本文件） | 双方 | ✍️ **本轮互签** |

---

## 2. 自动化回归测试矩阵（100% 通过）

在仓库根目录执行全套集成回归：

```bash
node test/test_dashboard_api.js
node test/test_monitoring_page.js
node test/test_route_coverage_probe.js
node test/test_page_smoke_watchdog.js
node test/test_tunnel_launcher.js
node test/test_readonly_api_routes.js
node test/test_web_runner_and_heartbeat.js
```

| 测试用例 | 验证核心契约 | Cursor | Gemini | 状态 |
|---|---|---|---|---|
| `test_dashboard_api.js` | 聚合 payload 包含 `routeCoverage` 与 `tunnel`；无伪造 180 伪常数；双进程内存安全计算 | ✅ | ✅ | **PASS** |
| `test_monitoring_page.js` | 看板 DOM 契约完全满足；新增 `#cell-routeCoverage` 与 `#cell-tunnel` 正确渲染 | ✅ | ✅ | **PASS** |
| `test_route_coverage_probe.js` | 全挂载返回 `ok`；单漏返回 `warn`；双漏/不通返回 `critical`；30s TTL 缓存生效 | ✅ | ✅ | **PASS** |
| `test_page_smoke_watchdog.js` | 覆盖 8 个关键路由；边缘触发告警状态机；文案对齐；**代码绝无 `pm2 restart`**；端到端 fail=0/8 | ✅ | ✅ | **PASS** |
| `test_tunnel_launcher.js` | 默认 `ENABLE_TUNNEL=0` 返回 `off`；`=1` 缺失 URL 报 `warn`（整体 200 HTTP 码）；成功抓取写盘 `tunnel_url.json` | ✅ | ✅ | **PASS** |
| `test_readonly_api_routes.js` | T23 只读铁律；SQLite 物理只读保护；POST/PUT/DELETE 403 物理拦截 | ✅ | ✅ | **PASS** |
| `test_web_runner_and_heartbeat.js` | T10 语义：warn 维持 HTTP 200 避免误杀看门狗；仅 critical 触发 HTTP 503 | ✅ | ✅ | **PASS** |

---

## 3. 核心契约与协同约定对齐

### 3.1 关键路由最小集（8 条路径一致性）
两套探针（内部 `route-coverage-probe.js` 与外部 `page_smoke.sh`）严格对齐以下 8 个关键路径：
1. `/api/messages?limit=1`
2. `/api/monitoring/dashboard`
3. `/api/l2a/dates`
4. `/api/l2b/drycut20`
5. `/api/review/queue?date=2026-06-26`
6. `/api/pipeline/queue-status`
7. `/review_workbench.html`
8. `/monitoring`

### 3.2 告警与状态码语义契约
- **外部看门狗（`page_smoke.sh`）**：
  - 遇到 404 / Cannot GET / 500 / 连不上时，向企微机器人发送 Markdown 告警，标题明确包含 `关键页 API 路由冒烟失败 (页壳假绿/路由漏挂)`。
  - **绝不执行重启**：严格遵循 R2 告警软降级，保留现场由工程师排查。
- **内部健康探针（`/health`）**：
  - `subsystems.routeCoverage`：单条失败或 Tunnel URL 缺失时提升为 `warn`，但 HTTP 状态码保持 `200`，避免引发上游负载均衡或外部存活探针震荡；
  - 只有整体核心崩溃时才升级为 `critical` 并返回 `503`。

### 3.3 运行时数据保护
- `data/runtime/tunnel_url.json` 磁盘持久化路径已加入 `.gitignore`，杜绝动态运行时文件污染代码仓库。

---

## 4. 生产红线与安全核验互签 (R1 / R2 / R3 / R5)

| 红线编号 | 红线内容 | 核验结果 | 签字代表 |
|---|---|---|---|
| **R1** | 告警必须能到达人工终端，不得静默吞并异常 | ✅ `page_smoke.sh` 对接 `watchdog_alert.sh`，边缘触发通知企微 | Cursor / Gemini |
| **R2** | **绝对禁止自动 `pm2 restart`**，告警只通知不重载进程 | ✅ 静态正则与 AST 审计确认无任何 `pm2 restart` / `pm2 stop` 命令 | Cursor / Gemini |
| **R3** | Web 进程与 Ingest 进程单写双读隔离，Web 杜绝可写句柄 | ✅ `web_runner.js` 统一注入 `getReadOnlyMonitoringDb` 与只读归档库 | Cursor / Gemini |
| **R5** | 脚本与环境对称，不上未经测试与授权的生产热更新 | ✅ 全量改动在本地沙箱及测试用例内 100% 验证通过，未改动生产 `ecosystem.config.cjs` | Cursor / Gemini |

---

## 5. 后续上机（生产灰度）建议指南（供人类操作员）

当前代码已全部完备，如需上机推进生产验证，建议按以下标准化顺序操作：

1. **拉取远程合入点**：
   ```bash
   cd /home/wikitang628/whop-wechat-bridge
   git pull origin feat/p1-attachments-and-ratelimiter
   ```
2. **运行全套验收单测确认环境一致性**：
   ```bash
   npm test # 或执行上述 7 组单测
   ```
3. **（可选）生产 crontab 挂载 `page_smoke.sh`**：
   - 确认环境变量 `WECHAT_WORK_WEBHOOK_URL` 配置正确；
   - 先执行 dry-run：
     ```bash
     WATCHDOG_DRY_RUN=1 ./scripts/watchdog/page_smoke.sh
     ```
   - 经人工确认后再写入 crontab（建议每 3 分钟执行一次）：
     ```cron
     */3 * * * * WECHAT_WORK_WEBHOOK_URL='...' /home/wikitang628/whop-wechat-bridge/scripts/watchdog/page_smoke.sh >> /home/wikitang628/whop-wechat-bridge/logs/watchdog_smoke.log 2>&1
     ```

---

## 6. 双方签字

- **Cursor 代理代表**：`Cursor (Co-authored-by commit f96eddd)` —— **同意签字** ✅
- **Gemini 代理代表**：`Gemini (Antigravity Agent)` —— **同意签字** ✅
- **结论**：**P2-12 全阶段（a~h）联调通过，准予归档！**
