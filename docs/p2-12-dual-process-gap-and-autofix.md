# P2-12：双进程切流残余风险与自动检测 / 软修复

> 触发：2026-09-06 L2 工作台「页面能开、数据全空」（`/api/l2*` 在 `web_runner` 未挂载 → 404）。  
> 原则：可观测 ≠ 业务可用；**静态壳绿 ≠ API 绿**。自愈仍遵守 R2/R5（只告警 + 软降级，不自动 `pm2 restart`）。

---

## 1. 已暴露缺口（本轮已修）

| 项 | 现象 | 处置 |
|---|---|---|
| L2 API 漏挂 | `review_workbench.html` 200，drycut/dates 404 | `web_runner` 挂 `l2WorkbenchRouter` + `/media/zhao` |
| Auth 半边 | 页免鉴权，`/api/review` `/api/pipeline` 曾 401 | bypass 与单体对齐 |
| 归属清单不全 | `p1-11-route-ownership.md` 无 L2/ticker | 已补表 + 门禁段 |

---

## 2. P2 必须消化的风险项

| ID | 风险 | P2 动作 | 优先级 |
|---|---|---|---|
| R-A | **路由漏挂**（壳在 API 死） | 页面↔API 冒烟清单 + CI 门禁 | P0 |
| R-B | **鉴权白名单漂移**（页与 API 不一致） | 单一 `isDashboardAuthBypassPath` 源；单测覆盖 | P0 |
| R-C | **能力错位**（工作台 POST 在 web 403） | 文档标明；若产品要 reload/action，设计只读允许名单或 ingest 旁路 | P1 |
| R-D | **Tunnel URL 易变** | 健康看板展示当前 tunnel；书签失效告警（可选） | P1 |
| R-E | **双进程 RSS 误读** | P2-11 dashboard 已区分 web/ingest；看门狗勿只盯单进程 | P1 |
| R-F | **回滚窗口** | Runbook 抽检脚本化；禁 `delete all` | P1 |
| R-G | **契约测试债** | 主看板有 T18；L2/ticker/quant 二级页补 smoke | P0 |
| R-H | **生产热修未落库** | 本地↔GCP 对称检查（已有铁律）；部署后 `git status` 门禁 | P1 |

---

## 3. 自动检测（检测先于修复）

### 3.1 静态 / 单测（本轮落地）

- `web_runner.js` 必须 `import` + `app.use('/api', l2WorkbenchRouter)`（源码断言）。
- 临时起 `web_runner` app：下列路径 **禁止 404**（允许 200/空数据 JSON）：
  - `GET /api/l2a/dates`
  - `GET /api/l2b/drycut20`
  - `GET /api/review/queue?date=2026-06-26`
  - `GET /api/pipeline/queue-status`
  - `GET /review_workbench.html`
- Auth bypass：上述 L2/review/pipeline 路径在未带 Basic Auth 时仍可达（与产品意图一致）。

### 3.2 运行时探针（P2 后续）

| 探针 | 挂载点 | 语义 |
|---|---|---|
| `page_api_coverage` | `/health` 或 monitoring dashboard | 对「关键页 API 集合」轮询；任一持续 404 → `warn`/`critical` |
| `tunnel_url_present` | web 日志 / 状态文件 | Tunnel 启用但无 URL → warn |
| `auth_bypass_parity` | 单测 | bypass 列表 ⊆ 实际挂载路由前缀 |

关键页 API 最小集合（初版）：

```text
/api/messages?limit=1
/api/monitoring/dashboard
/api/l2a/dates
/api/l2b/drycut20
/api/review/queue?date=<default>
/review_workbench.html
/monitoring
```

### 3.3 看门狗扩展（软）

- 现有 bash 看门狗只打 `/health`。
- P2 增加可选 `scripts/watchdog/page_smoke.sh`：本机 curl 关键 GET；失败写 `watchdog.log` + alert-sink（**不** restart）。

---

## 4. 「自动修复」边界（R2/R5）

允许的软修复：

1. **告警**：企微说明「路由漏挂 / 页壳假绿」。  
2. **看板红格**：dashboard 标 `routeCoverage=critical`。  
3. **文档/CI 阻断合并**：缺挂载单测失败。  

禁止：

- 自动 `pm2 restart` / 自动切回单体。  
- 自动改写生产 ecosystem。  

人工修复剧本（Runbook 追加）：确认漏挂 → 合入挂载 → 仅 restart `whop-web-dashboard` → 冒烟。

---

## 5. 任务拆分建议（并行）

| 子任务 | 内容 | 依赖 |
|---|---|---|
| P2-12a | 本文件 + 路由表 + L2 挂载热修入仓 | — |
| P2-12b | `test_web_runner_page_smoke.js`（本轮） | 12a |
| P2-12c | `/health` 或 dashboard 增加 `routeCoverage` 字段 | 12b |
| P2-12d | watchdog page_smoke + 告警文案 | 12c |
| P2-12e | Tunnel URL 可观测 + 书签失效说明 | 可选 |
| P2-12f | 工作台 POST 产品决策（保持 403 vs 白名单） | 产品 |

---

## 6. 验收

- [x] GCP/本地：`/api/l2b/drycut20` → 200 且 count=20（有样本时）  
- [ ] 单测：`test_web_runner_page_smoke.js` PASS  
- [ ] 切流/发版检查单含「关键页 API 非 404」  
- [ ] P2-11 看板可看到 routeCoverage（12c 完成后）
