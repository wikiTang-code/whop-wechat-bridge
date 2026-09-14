# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

## 0. 处理中高优队列（双 Agent · Priority In-Flight）

> 人令跑完后自主接续（`CHG-014`）。每次同步重读本页（`CHG-013`）。

### 0.A 队列 `agent:cursor`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | — | — | （空；REQ-034 Done。REQ-035 等 gemini 释放 `follow-replay-engine.js`） | — | — |
| 2 | **REQ-035** | L1 | 回放纠错与 `trade_signals` 流水自动校准联动 | `follow-replay-engine.js` · `database.js` | Queued（热点互斥） |

### 0.B 队列 `agent:gemini`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-033** | L1/L4 | 历史大V交易单回放与企微纠错反馈 | `server.js` · `follow-hitl.js` · `follow-replay-engine.js` | **Doing** |
| 2 | — | — | （空位） | — | — |

### 0.H Human

| ID | 任务 | 状态 |
|----|------|:----:|
| REQ-002 | 生产 ff | 等待 |
| Q-001 | GEX→GCP 通道选型 | open |

### 0.R

| 审修方 | 批次 | 状态 |
|--------|------|:----:|
| §0.R-A cursor | PKG-FOLLOW-FULL | **Done** |
| §0.R-B gemini | PKG-CURSOR-WAVE（003/022/031/032/005/006） | **Done** |

### 共享候选池

1. `REQ-004` 同步通道实现（待 Q-001）
2. `REQ-035`（已入 §0.A 顺位2；等 033 热点释放）
3. （已出队）003 · 005 · 006 · 008 · 021 · 022 · 027～032 · 034 · CHG-009

## 1. 主看板

| ID | 车道 | 任务简述 | Owner | 状态 | 依赖/阻碍 |
|----|------|----------|-------|:----:|-----------|
| REQ-014 | L0 | 文档树+协同框架入库 | `agent:cursor` | Done | `0dc31ea` |
| CHG-005 | L0/L4 | 作废方案中「企微点 C2」旧表述 | `agent:cursor` | Done | local-ops 计划已改 |
| REQ-018 | L4 | 企微冻结清单文档化 | `agent:cursor` | Done | `wecom-freeze.md` · `38662c4` |
| REQ-026 | L0 | 多端统一 Agent 治理规则 | `agent:cursor` | Done | `AGENTS.md` + 指针 · `611213c` |
| REQ-019 | L4 | 发布 go/no-go + 重启判据 | `agent:cursor` | Done | `runbooks/deploy-restart.md` · `de288d5` |
| REQ-023 | L0 | 进度文档并发协议写入 06 | `agent:cursor` | Done | 见 06 §3 |
| REQ-024 | L3/L0 | data/gex 提交硬规则 | `agent:cursor` | Done | 见 04 §1 / 06 §4 |
| REQ-015 | L0/L4 | 生产 C2 HITL Runbook | `agent:gemini` | Done | `runbooks/hitl-c2.md` |
| REQ-016 | L0/L2 | 事故响应+回滚 Runbook | `agent:gemini` | Done | `runbooks/incident-rollback.md` |
| REQ-017 | L0/L4 | 密钥与企微运维变更控制 | `agent:gemini` | Done | `runbooks/secret-rotation-and-ip.md` |
| REQ-020 | L4 | C2 审计与看板闭环 | `agent:gemini` | Done | `gateway.js` 审计 + `runbooks/c2-audit-loop.md` |
| CHG-006 | L0/L4 | 扩写 06 §6 发布/HITL 可执行清单 | `agent:cursor` | Done | `06-process.md` §6 |
| CHG-008 | L0 | 收工自动 commit+push+文档树 | `agent:cursor` | Done | AGENTS.md §6 |
| REQ-001 | L4 | Push 本地 commits → origin | `agent:cursor` | Done | `de872b0..1352705` |
| REQ-002 | L4 | 生产 ff 对齐 | `human` | Todo | 依赖 push；判据见 REQ-019 |
| REQ-003 | L3 | 开盘 GEX 计划任务 | `agent:cursor` | Done | WhopGexOpenSession0940ET Ready |
| REQ-027 | L1 | 三账本隔离+看板分源 | `agent:gemini` | Done | `9d06fef` · 入 §0.R-A Queued |
| REQ-028 | L1 | Paper TTL/滑点状态机 | `agent:gemini` | Done | 五大状态机闭环落库，实盘安全红线阻断 |
| REQ-029 | L1/L4 | 移动端跟单确认卡片 | `agent:gemini` | Done | follow-hitl.js |
| CHG-009 | L4 | 企微业务跟单 HITL 回调 | `agent:gemini` | Done | 随 REQ-029；wecom-freeze 专节 |
| REQ-021 | L1 | L1 跟单沙盒/实盘检查表+门禁 | `agent:gemini` | Done | `runbooks/follow-sandbox-to-live-gate.md` · 专题包关闭 |
| REQ-008 | L2 | P2-16 主库增长治理（~867MB） | `agent:gemini` | Done | `db-maintenance.js` · 保留策略与清理脚本 |
| REQ-030 | L1 | 大V即时推送实事求是（去假跟单后缀） | `agent:gemini` | Done | monitor.js · CHG-010 |
| REQ-031 | L1 | 解析即写 signal 流水 | `agent:cursor` | Done | trade_signals · test_trade_signals_req031 |
| REQ-032 | L1 | arrivalPrice 真实盘口 | `agent:cursor` | Done | fetchTickerKlineData |
| REQ-033 | L1/L4 | 历史回放+企微纠错 | `agent:gemini` | Doing | replay-review-runner |
| REQ-022 | L3 | GEX→GCP 同步安全专节 | `agent:cursor` | Done | runbooks/gex-gcp-sync-security.md |

状态枚举：`Todo` | `Doing` | `Blocked` | `Review` | `Done`

---

## 2. 子 Checklist（仅复杂项）

### REQ-014 文档树入库

- [x] 01–07 + README + 跳转页 + AGENTS/rule  
- [x] 独立 docs commit（无 GEX HTML）→ `0dc31ea`

### REQ-015（Gemini）建议大纲

- [x] human-approve 谁可执行 / 超时 / 失败  
- [x] 禁止 Agent 代跑（REJ-007）  
- [x] 每次 C2 回写本页「Ops 审计」或 audit id  
- [x] 与 REQ-020 字段对齐  

### REQ-016（Gemini）建议大纲

- [x] 事故分级与宣布人  
- [x] 止血 vs 回滚；旧 SHA / 单体镜像  
- [x] 验证清单；禁止临场通用 SSH  
- [x] 灾难备用破窗 SOP 与事后补偿  

---

## 3. Ops 审计行（生产 C2，human 填写）

| 时间 | human | 动作 | 目标 | 结果 | 备注 |
|------|-------|------|------|------|------|
| — | — | — | — | — | （空） |

---

## 4. 最近完成

| ID | Owner | 日 | 结果 |
|----|-------|-----|------|
| REQ-030 / CHG-010 | `agent:gemini` | 2026-09-14 | monitor.js 移除假跟单后缀，发言通知与交易解耦 |
| REQ-020 | `agent:gemini` | 2026-09-14 | gateway audit + c2-audit-loop runbook |
| REQ-017 | `agent:gemini` | 2026-09-14 | secret-rotation-and-ip runbook |
| REQ-016 | `agent:gemini` | 2026-09-14 | incident-rollback runbook |
| REQ-015 | `agent:gemini` | 2026-09-14 | hitl-c2 runbook |
| CHG-006 | `agent:cursor` | 2026-09-14 | 06 §6 发布/HITL 清单 |
| REQ-026 | `agent:cursor` | 2026-09-14 | 多端治理 `AGENTS.md` |
| REQ-019 | `agent:cursor` | 2026-09-14 | deploy-restart runbook |
| REQ-018 | `agent:cursor` | 2026-09-14 | wecom-freeze |
| CHG-001～003 | `agent:cursor` | 2026-09-14 | GCP 推送 / OpenD 预检 / 自启 |
| REQ-011/012 | 多轮 | 2026-09-14 | Local-Ops P4.1 + GEX 拉链 |

---

## 5. 认领协议

1. 选 03 中 `accepted` → 改 `in_progress`。  
2. 本表改 Owner + `Doing`，登记占用路径（若动代码）。  
3. 同一热点路径同时仅一个 Doing（见 06）。  
4. 完成：`Done` → 03=`done` → 刷新 02 Git 快照。  
5. `>48h` 无更新标 `stale?`，human 可回收。  
6. **高优队列主动接续**：任务 Done 出队后，Agent 必须立即根据 03 账本评估队列外候选，将最高优 Task 调入队列顺位，并主动向 Human 询问确认是否继续开发。

---

## 6. 会话交接（2026-09-14 Cursor）

- 治理已落地：根 `AGENTS.md` + `CLAUDE.md` + `.cursor/rules/agent-governance.mdc`  
- 总控：`docs/project/README.md`  
- Gemini：REQ-016 runbook；Cursor：CHG-006（06 §6）已落地








## 6. 会话交接（自主跑队续）

- cursor：REQ-034 Done；§0.A 空；REQ-035 Queued（互斥等 033 释放 follow-replay-engine）。
- gemini：REQ-033 Doing；§0.R-B PKG-CURSOR-WAVE Done。
- Human：REQ-002 / Q-001。
