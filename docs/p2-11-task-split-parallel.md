# P2-11 健康看板任务拆分（Gemini ∥ Cursor，交叉审阅）

> 日期：2026-09-05  
> 基线：双进程已灰度（ingest + web），**本轮禁止 GCP 部署 / 禁止重启生产进程**。  
> 依据：`docs/p2-11-health-dashboard-wireframe.md` + 现有 `monitoring/dashboard-api.js` + `GET /api/monitoring/dashboard`。  
> 准则：可观测 ≠ 业务闭环；PM2 看 uptime/unstable；本地/云端脚本对称（部署另开窗口）。

---

## 0. 范围与红线

**做**
- 本地实现健康看板静态页 + API 契约补齐 + 单测  
- 文档与线框对齐双进程（RSS 展示「两进程合计」语义）  
- 交叉审阅对方交付

**不做（本轮）**
- 不上 GCP、不 `pm2 restart`、不改生产 `ecosystem.config.cjs`  
- 不引入 React/Vue/构建链（Vanilla JS + CSS，与线框一致）  
- 不改 ingest 写路径、不扩写 monitoring.db schema（除非单测夹具）  
- 不做 P2-12～16（资产巡检/一致性/RUM/软降级/DB 治理）——另开轮次

---

## 1. 并行分工总表

| ID | 任务 | Owner | 并行组 | 交叉审阅方 | 依赖 |
|---|---|---|---|---|---|
| **P2-A** | API 契约审计与缺口清单（对照线框 §3–4 vs `dashboard-api.js`） | **Cursor** | G0 | Gemini | 无 |
| **P2-B** | 线框修订：双进程内存/ingest 心跳/Tunnel 字段语义 | **Gemini** | G0 | Cursor | 无 |
| **P2-C** | 补齐 `getDashboardPayload` 真实数据（告警表名、sparklines、子系统格） | **Gemini** | G1 | Cursor | P2-A 清单 |
| **P2-D** | 静态页骨架 `public/monitoring.html` + CSS（Banner + 6 格 + 趋势区 + 告警流） | **Cursor** | G1 | Gemini | P2-B 布局定稿可并行草稿 |
| **P2-E** | 前端轮询逻辑 `public/monitoring.js`（5s、状态上色、容错） | **Gemini** | G2 | Cursor | P2-C 契约稳定 + P2-D DOM id 约定 |
| **P2-F** | `web_runner` 挂载 `GET /monitoring`（静态页）+ 鉴权白名单策略 | **Cursor** | G2 | Gemini | P2-D |
| **P2-G** | 契约单测扩展（缺字段失败、只读、双进程字段） | **双方各写一块，互审** | G2 | 互审 | P2-C |
| **P2-H** | 联调检查清单（本地 web_runner 手测，不上机） | **Cursor** 起草 / **Gemini** 补测项 | G3 | 互签 | P2-E/F/G |

**并行节奏**
```
G0:  Cursor P2-A  ║  Gemini P2-B
G1:  Gemini P2-C  ║  Cursor P2-D   （中间交换：契约 JSON 样例 ↔ DOM id 表）
G2:  Gemini P2-E  ║  Cursor P2-F + 双方 P2-G
G3:  交叉审阅合入 → Cursor 出 P2-H → 双方签字 → 再议是否上机
```

---

## 2. 任务详述

### P2-A — Cursor：API 缺口清单（先发）

对照 `docs/p2-11-health-dashboard-wireframe.md` 与 `monitoring/dashboard-api.js` / `test/test_dashboard_api.js`，输出：

`docs/p2-11-api-gap-checklist.md`

至少列清：
- 已实现 / 半实现（stub）/ 缺失  
- 表名是否与真实 `monitoring.db` 一致（如 `alert_history` vs 线框 `alert_events`）  
- 双进程下 `overall.memory` 仅反映 **web RSS** 的误导点 → 建议字段  
- ingest 子系统是否进入 `subsystems` 网格  

**验收**：Gemini 能按清单改 P2-C，无需再猜。

### P2-B — Gemini：线框修订（双进程语义）

更新 `docs/p2-11-health-dashboard-wireframe.md`：
- Banner：区分 `webRssMb` / `ingestRssMb` / `combinedRssMb`（或明确「仅 web，合计另字段」）  
- 网格增加 **Ingest 心跳**（ok/warn/critical + delaySec）  
- Tunnel：注明 quick tunnel URL 重启会变  
- 仍保持 Vanilla、5s 轮询、只读  

**验收**：Cursor 按修订稿写 DOM，不返工布局语义。

### P2-C — Gemini：补齐 dashboard-api

在 **不写库** 前提下：
- 按 P2-A 清单把 stub 换成真实只读查询（能读则读，不能则显式 `null` + `note`）  
- pushP95 禁止假常数 `180` 冒充（无数据则 `null` / 空数组）  
- 保持 `GET /api/monitoring/dashboard` 路径；形状变更须同步线框 §4  
- 单测：`test/test_dashboard_api.js` 更新  

**验收**：Cursor 审阅「无 getDb 写、无假绿色」。

### P2-D — Cursor：页面骨架

新增（建议路径）：
- `public/monitoring.html`  
- `public/monitoring.css`  

实现线框四大块的 **结构 + 占位**，约定稳定 `id`/`data-*`（写入 `docs/p2-11-dom-contract.md` 一页表）。  
视觉：可用现有 `public/` 风格变量，避免紫渐变/重阴影；可读优先。

**验收**：Gemini 只填数据不上改 DOM 结构。

### P2-E — Gemini：前端逻辑

`public/monitoring.js`：
- `fetch('/api/monitoring/dashboard')` + Basic Auth 同源即可（浏览器已登录）  
- 5s `setInterval`；`document.visibilityState` 隐藏时降频或暂停  
- 按 status 上色；请求失败显示横幅，不白屏  
- **零** 写接口调用  

**验收**：Cursor 审安全性与 DOM 契约符合。

### P2-F — Cursor：路由与鉴权

`scripts/web_runner.js`：
- `GET /monitoring` → 静态页（或 redirect）  
- 确认 `dashboardBasicAuthMiddleware`：**`/monitoring` 与静态资源需鉴权**；`/health` 仍免鉴权  
- 本地：`ROLE=web_dashboard node scripts/web_runner.js` 手测（勿碰 GCP）

**验收**：Gemini 确认与线框「生产看板」一致且无裸奔。

### P2-G — 单测（分头）

| Owner | 文件 | 内容 |
|---|---|---|
| Gemini | `test/test_dashboard_api.js` | payload 字段、无 stub 假 P95、只读 |
| Cursor | `test/test_monitoring_page.js`（新建） | 静态文件存在；可选用轻量 HTTP 断言 `/monitoring` 200 |

互审对方测试是否过宽/过窄。

### P2-H — 本地联调清单（不上机）

Cursor 起草 `docs/p2-11-local-verify.md`：
1. 起本地 web_runner（可用只读库）  
2. 浏览器打开 `/monitoring`  
3. 对照 API JSON 与 UI  
4. 断 monitoring.db / 空告警时 UI 降级  

Gemini 补充边界用例后双方勾选。

---

## 3. 交叉审阅协议

1. **每完成一个 ID**：Owner `git push`，在 PR/对话里 @ 对方「请审 P2-x」。  
2. **审阅人只做**：缺口、假数据、只读违规、DOM/契约漂移；不顺手大改对方文件。  
3. **阻塞级**：假绿灯、可写 DB、未鉴权暴露看板、上机部署。  
4. **合并节奏**：G0 审过再进 G1；G2 全部本地绿再进 G3。  
5. **上机**：另开「P2 上机窗口」，须 P1 观察满约定时长且双方签字 P2-H。

---

## 4. 建议立即开干顺序

**现在（G0）**
1. Cursor → **P2-A**  
2. Gemini → **P2-B**（`git pull` 后改线框）

**G0 互审通过后进 G1**（P2-C ∥ P2-D）

---

## 5. 与 P1 观察的隔离

- 生产双进程继续观察；本清单全部本地。  
- 若需对照真实 `monitoring.db` 形状：可 **只读 scp/sqlite3 查询**，禁止改 GCP 进程。  
- Tunnel / 推送问题仍归 P1 观察轨，不塞进 P2 实现。
