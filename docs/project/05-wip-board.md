# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

## 0. 处理中高优队列（双 Agent · Priority In-Flight）

> **机制**：每个 Agent **独立一条**高优队列（容量各 1～2 项）；两队列 **Task 互斥**（同一 `REQ`/`CHG` 不得同时出现在两条队列；同一热点路径同时仅一个 Owner=`Doing`，见 06 §2）。  
> **文档树感知**：本页 §0 为唯一真相；`README` 必须镜像。  
> **主动接续**：本队列 Done 出队 → 共享候选池 → 互斥校验 → **问 Human** → 入队 `Doing`。  
> **交叉审修**：累计出队≥5 或专题包关闭 → 对方 §0.R（`CHG-012`）。

### 0.A 队列 `agent:cursor`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-003** | L3 | **挂载开盘前 GEX 计划任务** | `tools/gex-sidecar/**` · Task Scheduler（**不碰** L1） | **Doing** |
| 2 | — | — | （空位） | — | — |

### 0.B 队列 `agent:gemini`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-008** | L2 | **P2-16 主库增长治理**（~867MB/VACUUM/清理策略） | `whop_archive.db` · 清理维护脚本 | **Doing** |
| 2 | REQ-022 | L3 | REQ-004 GEX→GCP 只读同步安全专节 | `docs/project/**` | 候选就绪 |

### 0.H Human 槽（非 Agent 队列）

| ID | 任务 | 状态 |
|----|------|:----:|
| REQ-002 | 生产 GCP-VM ff 对齐 | 等待 Human |

### 0.R 交叉 Review+修复队列（Peer Review / Fix）

> **触发**：累计 Done≥5 或专题包关闭。意见进 07；修复进 03。

#### 移交计数（自上次交叉 Review 起）

| 作者 Agent | 累计 Done（未移交） | 阈值阈值 | 最近专题包 | 下一触发预估 |
|------------|:------------------:|:--------:|------------|--------------|
| `agent:cursor` | 0 | 5 | — | 满 5 |
| `agent:gemini` | 0（follow-HITL 全包关闭移交） | 5 | **follow-HITL 全组关闭** (Phase A～D) | 专题包整组关闭触发移交 §0.R-A |

#### §0.R-A · `agent:cursor` 审修队列（审 Gemini 产物）

| 批次 | 来源包 / IDs | 状态 | 备注 |
|------|--------------|:----:|------|
| **PKG-FOLLOW-FULL** | `REQ-027`, `REQ-028`, `REQ-029`, `REQ-021` + `CHG-009`（跟单三账本+状态机+移动端卡片+门禁） | `Queued` | **专题包整组闭环移交**；审修重点：账本隔离、滑点边界、90s 超时防重放 |

#### §0.R-B · `agent:gemini` 审修队列（审 Cursor 产物）

| 批次 | 来源包 / IDs | 状态 | 备注 |
|------|--------------|:----:|------|
| — | （空） | — | 等待 Cursor REQ-003 完成后移交 |

### 共享候选池（按序待入队 · 入队前校验互斥）

1. `REQ-029` + `CHG-009`（L1/L4）：企微跟单确认卡片 — 建议 028 后  
2. `REQ-021`（L1）：沙盒/实盘检查表（Phase D）  
3. `REQ-008`（L2）：P2-16 主库治理  
4. （已出队）`REQ-027` Done · Gemini · 已入 §0.R-A Queued  
5. （已出队）`REQ-030`/`CHG-010` Done · Gemini  

**互斥检查清单（入队强制）**

- [ ] 该 ID 不在另一 Agent 开发队列  
- [ ] 热点路径与另一队列 Doing 项无交集  
- [ ] 依赖项已 Done 或 Human 允许并行切片

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
| REQ-003 | L3 | 开盘 GEX 计划任务 | `agent:cursor` | Doing | 队列 0.A · install_open_session_task.ps1 |
| REQ-027 | L1 | 三账本隔离+看板分源 | `agent:gemini` | Done | `9d06fef` · 入 §0.R-A Queued |
| REQ-028 | L1 | Paper TTL/滑点状态机 | `agent:gemini` | Done | 五大状态机闭环落库，实盘安全红线阻断 |
| REQ-029 | L1/L4 | 移动端跟单确认卡片 | `agent:gemini` | Done | `follow-hitl.js` + `/api/follow/hitl-callback` 独立通道 |
| CHG-009 | L4 | 企微业务跟单 HITL 回调 | `agent:gemini` | Done | 独立于 /ops；单测 test_follow_hitl_req029.js |
| REQ-021 | L1 | L1 跟单沙盒/实盘检查表+门禁 | `agent:gemini` | Done | `runbooks/follow-sandbox-to-live-gate.md` · 专题包关闭 |
| REQ-008 | L2 | P2-16 主库增长治理（~867MB） | `agent:gemini` | Doing | 队列 0.B · SQLite 清理策略与治理 |
| REQ-030 | L1 | 大V即时推送实事求是（去假跟单后缀） | `agent:gemini` | Done | monitor.js · CHG-010 |
| CHG-010 | L1 | 发言推送与交易推送解耦 | `agent:gemini` | Done | 随 REQ-030 |

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


## 6. 会话交接（2026-09-14 双队列校正）

- §0.A=`agent:cursor`：**REQ-003** Doing（GEX 开盘任务）。
- §0.B=`agent:gemini`：**REQ-028** Doing（Paper 状态机；Human 已确认）。
- §0.R-A：批次 F-027-028 Queued，待 cursor 审修（不抢 server.js）。
- Human：REQ-002 生产 ff。

- CHG-013：每次同步文档树必须重读并镜像最新 §0 队列。
