# P2-11 本地联调清单（P2-H）

> 日期：2026-09-06  
> 范围：**仅本地**。不上 GCP、不 `pm2 restart` 生产双进程。  
> 前置：P2-C/D/E/F 已合入；审阅见 `p2-11-p2c-review.md` / `p2-11-p2e-review.md`。

---

## A. 自动化（必过）

在仓库根目录：

```bash
node test/test_dashboard_api.js
node test/test_monitoring_page.js
node test/test_dashboard_basic_auth.js
node test/test_readonly_api_routes.js
```

| # | 检查项 | Cursor | Gemini |
|---|---|---|---|
| A1 | `test_dashboard_api` PASS（无假 180、combined 空值） | ✅ | ☐ |
| A2 | `test_monitoring_page` PASS（/monitoring + JS 契约） | ✅ | ☐ |
| A3 | auth + readonly routes 回归 PASS | ✅ | ☐ |

---

## B. 手动：起本地 Web 看板

```bash
# PowerShell 示例（勿开 Tunnel）
$env:ROLE='web_dashboard'
$env:READONLY_MODE='1'
$env:ENABLE_TUNNEL='0'
# 可选: $env:DASHBOARD_USERNAME='demo'; $env:DASHBOARD_PASSWORD='demo'
node scripts/web_runner.js
```

浏览器打开：`http://127.0.0.1:8085/monitoring`（若设了 Basic Auth 则输入凭据）。

| # | 检查项 | Cursor | Gemini |
|---|---|---|---|
| B1 | 页面加载，7 格出现，非永久「等待数据」 | ☐ | ☐ |
| B2 | Banner 有美东/北京时间与 GLOBAL 状态 | ☐ | ☐ |
| B3 | Ingest 无 rss 时显示「仅看板进程」，无伪造合计 | ☐ | ☐ |
| B4 | 推送时序区显示 not_sampled 占位，无假折线 | ☐ | ☐ |
| B5 | DevTools Network 仅见 GET dashboard，无 POST/PUT/DELETE | ☐ | ☐ |
| B6 | 切到其它标签 30s+ 再回来：应立即刷新；`#refresh-label` 文案合理 | ☐ | ☐ |

---

## C. 容错边界

| # | 操作 | 期望 | Cursor | Gemini |
|---|---|---|---|---|
| C1 | 停掉 web_runner 或临时改坏 API | 顶部 `#fetch-error` + body 半透明，**不白屏** | ☐ | ☐ |
| C2 | 恢复服务 | 错误条消失，数据继续更新 | ☐ | ☐ |
| C3 | 无 `monitoring.db` / 空告警 | 告警区 empty 占位，不崩 | ☐ | ☐ |
| C4 |（可选）配置 Basic Auth 后未登录访问 `/monitoring` | 401；`/health` 仍可匿名 | ☐ | ☐ |

---

## D. 明确不做（本清单外）

- 不上 GCP / 不替换生产 `ecosystem`  
- 不要求 ingest 心跳已带 `rssMb`（诚实 null 即可）  
- 不要求 `sparklines.pushP95` 有真实点（`not_sampled` 合格）

---

## 签字

| 角色 | 结论 | 日期 |
|---|---|---|
| Cursor | 自动化已本地复跑；清单起草完成 | 2026-09-06 |
| Gemini | _待勾选 B/C 后签字_ | |

双方签字后，方可另开「P2 上机窗口」讨论（仍须满足 P1 观察时长约定）。
