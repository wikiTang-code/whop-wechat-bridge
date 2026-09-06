# P2-12d & P2-12e 交付自检清单（Gemini）

> **状态**：已完成本地实现与单测，待 Cursor 交叉审阅（P2-12f）。  
> **分支**：`feat/p1-attachments-and-ratelimiter`  
> **提交范围**：P2-12d 看门狗冒烟脚本与告警体系、P2-12e Tunnel URL 状态落盘与 `/health` 暴露。

---

## 1. 任务完成概况

| 子任务 | 负责模块 | 变更文件 | 核心成果 |
|---|---|---|---|
| **P2-12d** | 看门狗冒烟与告警体系 | `scripts/watchdog/page_smoke.sh`<br>`scripts/watchdog/README.md`<br>`test/test_page_smoke_watchdog.js` | 覆盖 8 个关键路由；边缘触发状态机；对接 `watchdog_alert.sh`；明确标注「页壳假绿/路由漏挂」；**严格零 pm2 restart**。 |
| **P2-12e** | Tunnel URL 落盘与健康契约 | `monitoring/tunnel-launcher.js`<br>`monitoring/health.js`<br>`test/test_tunnel_launcher.js` | 成功捕获 URL 写入 `data/runtime/tunnel_url.json`；暴露 `getTunnelStatus()`；`/health.subsystems.tunnel` 暴露 `{ status, url, port, updatedAtMs }`；`ENABLE_TUNNEL=1` 无 URL 报 `warn`。 |

---

## 2. 铁律与红线自检 (R1 / R2 / R3 / 防撞车)

- [x] **R2 红线（告警不重启）**：`scripts/watchdog/page_smoke.sh` 内**绝对禁止**任何 `pm2 restart` / `pm2 stop` 命令，仅输出告警通知并软降级。
- [x] **告警文案对齐**：告警标题明确包含 `关键页 API 路由冒烟失败 (页壳假绿/路由漏挂)`，提供异常路由明细与基址。
- [x] **轻量独立（纯 Bash）**：看门狗自身绝不拉起 Node 运行时，不引入常驻大开销，适合 crontab / systemd 定时器。
- [x] **所有权防撞车**：严格未修改 `monitoring/route-coverage-probe.js`（保持 Cursor 独占所有权）；未扩大 `web_runner.js` 的告警职责。
- [x] **环境安全红线**：未连接 GCP、未触碰生产 `ecosystem.config.cjs`，全量测试均在本地隔离端口完成。

---

## 3. 契约格式核验

### 3.1 `data/runtime/tunnel_url.json` 磁盘落盘格式
```json
{
  "url": "https://sample-domain.trycloudflare.com",
  "status": "ok",
  "port": 8085,
  "updatedAtMs": 1757139123456,
  "updatedAtBeijing": "2026-09-06 14:12:03"
}
```

### 3.2 `/health` 中 `subsystems.tunnel` 契约
```json
{
  "status": "ok",
  "url": "https://sample-domain.trycloudflare.com",
  "port": 8085,
  "updatedAtMs": 1757139123456,
  "description": "Cloudflare tunnel is active and public"
}
```
*注：当 `ENABLE_TUNNEL=0`（默认）时，status 为 `"off"`；当 `ENABLE_TUNNEL=1` 且尚未提取到公网 URL 时，status 为 `"warn"`，同时将 overall 状态安全提升至 `"warn"`（保持 200 HTTP 状态码，避免误伤监控）。*

### 3.3 关键路由最小集（与 route-coverage-probe.js 100% 对齐）
1. `/api/messages?limit=1`
2. `/api/monitoring/dashboard`
3. `/api/l2a/dates`
4. `/api/l2b/drycut20`
5. `/api/review/queue?date=2026-06-26`
6. `/api/pipeline/queue-status`
7. `/review_workbench.html`
8. `/monitoring`

---

## 4. 本地测试验证记录

### 4.1 P2-12e Tunnel Launcher 测试
```bash
$ node test/test_tunnel_launcher.js
--- 开始执行 T16 / P2-12e 测试: test_tunnel_launcher ---
1. 验证默认配置下 Tunnel 保持关闭...
   ✅ 默认 off 验证通过：未开启开关时绝不启动子进程，/health 返回 status: off
2. 验证 ENABLE_TUNNEL=1 但无有效 URL 时的 warn 告警状态...
   ✅ ENABLE_TUNNEL=1 无 URL 触发 warn 判定验证通过！
3. 验证 Tunnel URL 提取成功时的写盘持久化与 /health 正常字段...
   ✅ P2-12e: Tunnel URL 落盘与 /health.subsystems.tunnel 字段对齐通过！

🎉 ALL T16 / P2-12e TESTS PASSED: test_tunnel_launcher
```

### 4.2 P2-12d 看门狗冒烟端到端测试
```bash
$ node test/test_page_smoke_watchdog.js
--- 开始执行 P2-12d 测试: test_page_smoke_watchdog ---
1. 验证 R1/R2 红线与告警文案规范...
   ✅ 静态红线核验通过：禁止 pm2 restart，文案对齐，纯 bash 探测
2. 验证关键页与 API 路由最小集覆盖...
   ✅ 全部 8 个关键页/API 路径覆盖核验通过！
3. 启动临时 Web 服务执行端到端冒烟测试...
[WebRunner] whop-web-dashboard 已就绪，监听端口 :18095 (READONLY_MODE=1)
   [page_smoke stdout]:
 [page_smoke] status=ok fail=0/8 (last=ok)
   ✅ 端到端测试通过：全 8 关键路由全部健康通畅 (fail=0/8)

🎉 ALL P2-12d TESTS PASSED: test_page_smoke_watchdog
```

### 4.3 全量相关套件回归测试
- `node test/test_route_coverage_probe.js`：**PASS**
- `node test/test_readonly_api_routes.js`：**PASS**
- `node test/test_web_runner_and_heartbeat.js`：**PASS**
- `node test/test_monitoring_page.js`：**PASS**
- `node test/test_ingest_heartbeat.js`：**PASS**
- `node test/test_dashboard_api.js`：**PASS**

---

## 5. 移交 Cursor 审阅说明

本部分工作已全部闭环，请 Cursor 团队检阅本清单及对应代码：
- `monitoring/tunnel-launcher.js`
- `monitoring/health.js`
- `scripts/watchdog/page_smoke.sh`
- `scripts/watchdog/README.md`
- `test/test_tunnel_launcher.js`
- `test/test_page_smoke_watchdog.js`

待交叉审阅确认后，即可进入 **P2-12g**（Cursor 在 `public/monitoring.html` 与 `public/monitoring.js` 增加 `routeCoverage` 与 `tunnel` 状态小格展示）。
