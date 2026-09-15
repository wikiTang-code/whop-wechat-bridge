# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

## 0. 处理中高优队列（双 Agent · Priority In-Flight）

> 人令跑完后自主接续（`CHG-014`）。每次同步重读本页（`CHG-013`）。

### 0.A 队列 `agent:cursor`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | — | — | （空；REQ-004 Done。035 仍等 033 热点） | — | — |
| 2 | **REQ-035** | L1 | 回放纠错与 `trade_signals` 流水自动校准联动 | `follow-replay-engine.js` · `database.js` | Queued（热点互斥） |

### 0.B 队列 `agent:gemini`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-033** | L1/L4 | 历史大V交易单回放与企微纠错反馈（修复全局批次穿插与空格容错，对齐LIFO栈） | `server.js` · `follow-hitl.js` · `follow-replay-engine.js` | **Doing** |
| 2 | — | — | （空位） | — | — |

### 0.C 队列 `agent:gemini1`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | — | — | （空 · REQ-036 Done） | — | — |
| 2 | — | — | （空位） | — | — |

### 0.H Human

| ID | 任务 | 状态 |
|----|------|:----:|
| REQ-002 | 生产 ff | 等待 |
| Q-001 | GEX→GCP 通道 | interim=SCP（可再改） |

### 0.R

| 审修方 | 批次 | 状态 |
|--------|------|:----:|
| §0.R-A cursor | PKG-FOLLOW-FULL | **Done** |
| §0.R-B gemini | PKG-CURSOR-WAVE（003/022/031/032/005/006） | **Done** |

### 共享候选池

1. `REQ-035`（等 033 释放 follow-replay-engine）
2. （已出队）003 · 004 · 005 · 006 · 008 · 021 · 022 · 027～032 · 034 · 036 · CHG-009 · CHG-015 · CHG-016 · CHG-017

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
| REQ-004 | L3 | latest.json→GCP SCP | `agent:cursor` | Done | sync_latest_to_gcp.js |
| REQ-027 | L1 | 三账本隔离+看板分源 | `agent:gemini` | Done | `9d06fef` · 入 §0.R-A Queued |
| REQ-028 | L1 | Paper TTL/滑点状态机 | `agent:gemini` | Done | 五大状态机闭环落库，实盘安全红线阻断 |
| REQ-029 | L1/L4 | 移动端跟单确认卡片 | `agent:gemini` | Done | follow-hitl.js |
| CHG-009 | L4 | 企微业务跟单 HITL 回调 | `agent:gemini` | Done | 随 REQ-029；wecom-freeze 专节 |
| REQ-021 | L1 | L1 跟单沙盒/实盘检查表+门禁 | `agent:gemini` | Done | `runbooks/follow-sandbox-to-live-gate.md` · 专题包关闭 |
| REQ-008 | L2 | P2-16 主库增长治理（~867MB） | `agent:gemini` | Done | `db-maintenance.js` · 保留策略与清理脚本 |
| REQ-030 | L1 | 大V即时推送实事求是（去假跟单后缀） | `agent:gemini` | Done | monitor.js · CHG-010 |
| REQ-031 | L1 | 解析即写 signal 流水 | `agent:cursor` | Done | trade_signals · test_trade_signals_req031 |
| REQ-033 | L1/L4 | 历史回放+企微纠错（全量830笔重筑，保护已审29笔，Tokenizer槽位引擎+LIFO级联推演） | `agent:gemini` | Doing | replay-review-runner |
| REQ-036 | L3 | 大V交易语义专有 SLM 微调与数据飞轮 | `agent:gemini1` | Done | 1030组SFT/DPO训练集+Unsloth微调+端侧抽取器 |
| REQ-022 | L3 | GEX→GCP 同步安全专节 | `agent:cursor` | Done | runbooks/gex-gcp-sync-security.md |
| CHG-016 | L2 | 看板日期过滤强绑定北京时间 (+08:00) 闭环 | `agent:gemini` | Done | `3dc07c2` · 生产单进程重启生效 |

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
| CHG-015 | `agent:gemini1` | 2026-09-15 | LM Studio 显存守卫与绝对防重加载机制落地，tools/lms-guard.js + 单测通过 |
| REQ-036 | `agent:gemini1` | 2026-09-15 | 1030组SFT/DPO训练集导出+Unsloth微调配方+端侧双轨抽取器+100%Benchmark |
| REQ-030 / CHG-010 | `agent:gemini` | 2026-09-15 | monitor.js 移除假跟单后缀，发言通知与交易解耦 |
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
6. **高优队列主动接续**：任务 Done 出队后，Agent 立即根据 03 账本与 §0 互斥规则认领下一项并开干（`CHG-014`）；**勿**中途打断 Human 确认。仅当候选需人拍板（如生产 ff / Q 开放题）时再问一句。

---

## 6. 会话交接（自主跑队续）

- cursor：REQ-004 Done；§0.A 空；035 互斥等待。
- gemini：REQ-033 Doing。
- Human：REQ-002；Q-001 interim=SCP。
