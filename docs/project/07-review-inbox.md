# 07 — 审阅意见台（Review inbox）

> 上级：[`README.md`](./README.md) · 落地必须变成 [`03-requirements.md`](./03-requirements.md) 的 REQ/CHG/REJ（文件尚未定稿前，先以本页建议表为准）。  
> 规则：聊天里的审阅**不算数**；签字结论写这里。  
> **交叉审修批次调度**：见 [`05-wip-board.md`](./05-wip-board.md) §0.R（`CHG-012`）；本页只收意见正文。

---

## 1. 待消化审阅

### 2026-09-14 · Cross-review PKG-FOLLOW-FULL（`agent:cursor` · §0.R-A）

**范围**：`REQ-027` / `REQ-028` / `REQ-029`+`CHG-009` / `REQ-021`（Gemini 专题包）  
**测试**：`test_ledger_isolation_req027.js` · `test_follow_state_machine_req028.js` · `test_follow_hitl_req029.js` · `test_follow_gate_req021.js` — **全绿**

| 级别 | 结论 |
|------|------|
| 通过 | 三账本物理表隔离、Paper 五大状态机、实盘禁自动、HITL 卡片签名/超时/防重放/白名单、沙盒准入门禁 |
| 通过 | `wecom-freeze.md` 已分立「业务跟单 HITL」≠ `/ops` |
| 已修 | `/api/zhao-positions` 去掉对个人 `positions` 的空表 fallback（防再缠绕） |
| 中危→新 REQ | 解析路径仍未落独立 **signal 流水表**；赵哥仓依赖 `recalculate_ledger`/`trade_review_pool`，盘中即时 signal 账本不完整 → **REQ-031** |
| 中危→新 REQ | `monitor.js` 调用 `processFollowDecision` 时 `arrivalPrice: price`（喊单价当现价）→ 滑点常为 0 → **REQ-032** |
| 低 | GEX 计划任务已装；CN 主机用美东→本地墙钟；DST 后须重装安装器 |

**审修状态**：`Reviewing` → `Fixing`（fallback 已修）→ **`Done`**（缺口已升格 REQ-031/032）

### 2026-09-14 · Cross-review PKG-CURSOR-WAVE（`agent:gemini` · §0.R-B）

**范围**：`REQ-003` / `REQ-022` / `REQ-031` / `REQ-032` / `REQ-005` / `REQ-006`（Cursor 交付包）  
**测试**：`test_trade_signals_req031.js` · `test_broker_readonly_req005.js` · `test_ops_ui_req006.js` · `test_gex_sync_security_req022.js` — **全绿 (PASS)**

| 级别 | 结论 |
|------|------|
| **通过** | **REQ-031**：落地独立 `trade_signals` 表，解析时写入 signal 流水，与跟单/个人仓彻底解耦； |
| **通过** | **REQ-032**：`monitor.js` 真实调用盘口行情作为 `arrivalPrice`，回退机制与 warn 日志完备； |
| **通过** | **REQ-005**：P5 券商只读 catalog 严格约束 C0，无 `place_order`，防越权与只读单测全部通过； |
| **通过** | **REQ-006**：P6 本机运维页 `/ui` 挂载正常，仅允许本机回环 IP 调用； |
| **通过** | **REQ-003/022**：开盘前定时任务转换本地墙钟、GEX 同步安全规程入库； |
| **中危→新 REQ** | **Localhost Ops 端口 `:18789` CSRF/Origin 防护缺失**：目前仅校验 `remoteAddress` 为回环 IP，若用户在浏览器打开恶意网站，网页跨域发起的本地 fetch 同样属于回环 IP，可能被窃取券商只读敏感信息 → **立项 REQ-034**； |
| **体验→新 REQ** | **历史纠错与 `trade_signals` 联动**：REQ-033 纠错提交后，应向 `trade_signals` 同步插入/更新修正后的记录（打标 `source: 'manual_correct'`），保持 signal 底册与回放纠错最新事实一致 → **立项 REQ-035**。 |

**审修状态**：**`Done`**（新缺口已升格 REQ-034 / REQ-035 进入队列）


### 2026-09-14 · [Security/ops 审阅](c715940a-391c-4d03-b32b-f129502363ee)

**总评**：三层能力面与 REJ 方向正确；HITL/回滚/密钥·IP 变更/C2 审计仍是流程空洞；权威方案仍暗示「企微可确认 C2」，与 `REJ-001` 漂移。

| 级别 | 缺口摘要 |
|------|----------|
| 高危 | 生产 C2 HITL 无 runbook（human-approve 资格/超时/何时 restart） |
| 高危 | 事故回滚/切流无指针 → 易临场通用 SSH |
| 高危 | Agent 可纸面冒充「已 HITL」；缺 audit 回写 |
| 高危 | `local-ops-mcp-skill-plan.md` 旧文与现行企微窄面不一致 |
| 高危 | 密钥 / userid / 推送 IP 变更无变更控制 |
| 中危 | 企微 C0 即生产侦察面；扩面无 CHG 门禁 |
| 中危 | `commands.js` 与文档冻结清单未强制同步 |
| 中危 | collect DoS/限流未进协同验收；deploy go/no-go；L1 跟单检查表；REQ-004 同步安全专节 |

**建议登记（待 human 批准写入 03）：**

| ID | 优先级 | 摘要 |
|----|:------:|------|
| REQ-015 | P0 | 生产变更 HITL Runbook + 每次 C2 回写审计行 |
| REQ-016 | P0 | 事故回滚/切流人工 Runbook（禁临场通用 SSH） |
| REQ-017 | P0 | 密钥与企微运维变更控制（含推送 IP） |
| REQ-018 | P1 | 企微能力面冻结清单 = `commands.js`；扩面须 CHG |
| REQ-019 | P1 | 发布 go/no-go（对齐后是否 restart） |
| REQ-020 | P1 | C2 审计与看板闭环 |
| REQ-021 | P2 | L1 跟单变更沙盒/实盘检查表 |
| REQ-022 | P2 | REQ-004 GEX→GCP 只读同步安全专节 |
| CHG-005 | P0 | 修订权威方案：作废「企微消耗 confirm_token / 企微点 C2」 |
| CHG-006 | P1 | 扩写发布步骤为可执行清单 |
| REJ-007 | — | 禁止 Agent 声称/代跑 human-approve 已完成 |
| REJ-008 | — | 禁止未经 CHG 扩大企微映射 |
| REJ-009 | — | 巩固：告警/Agent 禁止触发生产 C2 |

**状态**：`digested` — human 已拍板树结构；建议项已合并写入 [`03-requirements.md`](./03-requirements.md)（REQ-015～025 等，**编号已重映射**）。

---

### 2026-09-14 · [reviewer:cursor](bb147c2e-716e-4af9-bba1-9ff6cd68c349)（流程框架）

**总评**：日常认领够用；作生产唯一协同依据仍不够——事故回滚、密钥轮换、重启判据、L1 沙盒、进度文档并发、`catalog.yaml` 热点锁是硬伤。

| 级别 | 缺口摘要 |
|------|----------|
| Critical | 事故/回滚几乎空白（分级、宣布人、验证、人工路径） |
| Critical | 生产「何时必须 restart」无正判据 |
| Critical | 密钥/Token 生命周期与 60020 IP 变更 SOP 缺失 |
| Critical | 进度文档并发协议不可执行（易撞车） |
| Critical | 双 Owner / 跨 REQ 抢热点；`catalog.yaml` 未进热点表 |
| Critical | L1 跟单无沙盒/实盘可验收门禁 |
| Important | `data/gex` 提交硬规则；REQ-004 安全；HITL 工件定义；P5 CI grep 门禁 |

**建议账本行（与 security-ops 编号有重叠，入库 03 前由 human 统一编号）：**

| 建议 ID（cursor） | 摘要 |
|-------------------|------|
| REQ-015 | 事故响应+回滚专节 |
| REQ-016 | 重启判据表 |
| REQ-017 | 密钥/企微 IP/HITL 轮换 SOP |
| REQ-018 | 进度文档并发协议 |
| REQ-019 | L1 跟单沙盒/实盘检查表 |
| REQ-020 | `data/gex` 默认不进 commit |
| REQ-021 | 收紧 REQ-004 只读同步 |
| REQ-022 | 热点锁补强含 `catalog.yaml` |
| CHG-005/006 | 开工必读对齐；重写回滚残句+HITL 定义 |
| REJ-007 | 拒绝无锁大段并行改总控文档 |

**状态**：`pending-human` — 已写入本页；旧单体 `project-progress.md` 上的零星补丁可忽略，以**本树 `07`** 为准。

---

## 2. 查漏清单（滚动）

| # | 检查项 | 结论 | 来源 |
|---|--------|------|------|
| 1 | 三层能力面无「全能 MCP」暗示 | pass | 初稿 |
| 2 | HITL/回滚可执行 | **gap** | security-ops + cursor |
| 3 | 密钥/IP 变更控制 | **gap** | 同上 |
| 4 | 旧方案企微 C2 漂移 | **gap** → CHG-005 | security-ops |
| 5 | C2 审计归因 | **gap** | security-ops |
| 6 | `data/gex` 提交策略 | **gap** | cursor |
| 7 | 进度文档并发协议 | **gap** | cursor |
| 8 | `catalog.yaml` 热点锁 | **gap** | cursor |
| 9 | L1 沙盒/实盘门禁 | **gap** | 同上 |
| 10 | 重启 go/no-go | **gap** | 同上 |

---

## 3. 签字栏

| Reviewer | 日期 | 总评（≤5 行） | 已落 REQ/CHG |
|----------|------|---------------|:------------:|
| [security-ops](c715940a-391c-4d03-b32b-f129502363ee) | 2026-09-14 | 流程层薄壳；先补 HITL/回滚/密钥与 CHG 作废旧企微 C2 | 待 human |
| [cursor](bb147c2e-716e-4af9-bba1-9ff6cd68c349) | 2026-09-14 | 认领可用；生产依据不够；并发与热点锁硬伤 | 待 human |
| reviewer:gemini | | | |
