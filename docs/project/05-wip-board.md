# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

## 0. 处理中高优队列（双 Agent · Priority In-Flight）

> **机制**：每个 Agent **独立一条**高优队列（容量各 1～2 项）；两队列 **Task 互斥**（同一 `REQ`/`CHG` 不得同时出现在两条队列；同一热点路径同时仅一个 Owner=`Doing`，见 06 §2）。  
> **文档树感知**：本页 §0 为唯一真相；`README` 一页总览必须镜像两队列；接续/认领必须先改本页再改代码。  
> **主动接续**：本队列任务 Done 出队后，该 Agent 从「共享候选池」拉项 → 检查互斥 → **询问 Human** → 确认后入本队列并翻 `Doing`。

### 0.A 队列 `agent:cursor` / `agent:gemini` 协同执行

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-028** | L1 | **落地 Paper 状态机**（TTL/滑点） | `trading.js` · `monitor.js` | **待确认开工（接续）** |
| 2 | REQ-029 | L1/L4 | 移动端跟单确认卡片 | `server.js` (HITL 回调) · 企微消息模板 | 候选就绪 |

### 0.B 队列 `agent:gemini`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-003** | L3 | 挂载开盘前 GEX 计划任务 | `tools/gex-sidecar/**` · 计划任务脚本（**不碰** L1 ingest 写路径） | **待确认开工** |
| 2 | — | — | （空位） | — | — |

### 0.H Human 槽（非 Agent 队列）

| ID | 任务 | 状态 |
|----|------|:----:|
| REQ-002 | 生产 GCP-VM ff 对齐 | 等待 Human |

### 0.R 交叉 Review+修复队列（Peer Review / Fix）

> **触发**（满足任一即移交对方）：  
> 1）作者 Agent 自上次移交起 **累计 Done 出队 ≥ 5** 个 Task；或  
> 2）同一**专题/特性包**整组关闭（例：`follow-HITL` Phase A～D、`REQ-015～020` 安全 runbook 包）。  
> **方向**：作者出队包 → 写入**对方**的 §0.R 队列（非本人开发队列）；Review 期间热点锁仍适用（修复时独占）。  
> **产出**：审阅结论进 [`07-review-inbox.md`](./07-review-inbox.md)；缺陷修复开子项或回写原 REQ；完成后出队并重置作者侧计数。

#### 移交计数（自上次交叉 Review 起）

| 作者 Agent | 累计 Done（未移交） | 阈值阈值 | 最近专题包 | 下一触发预估 |
|------------|:------------------:|:--------:|------------|--------------|
| `agent:cursor` | 0 | 5 | — | 满 5 或 REQ-027～029 包关闭 |
| `agent:gemini` | 0（REQ-030 等已单独收工，计数已重置示意） | 5 | — | 满 5 或下一专题包 |

#### §0.R-A · `agent:cursor` 审修队列（审 Gemini 产物）

| 批次 | 来源包 / IDs | 状态 | 备注 |
|------|--------------|:----:|------|
| — | （空） | — | 等待 Gemini 达阈值或专题包关闭 |

#### §0.R-B · `agent:gemini` 审修队列（审 Cursor 产物）

| 批次 | 来源包 / IDs | 状态 | 备注 |
|------|--------------|:----:|------|
| — | （空） | — | Cursor 完成 REQ-027 后可提前以「专题切片」触发，不必等满 5 |

**审修状态**：`Queued` → `Reviewing` → `Fixing` → `Done`（或 `Blocked` 待 Human）

### 共享候选池（按序待入队 · 入队前校验互斥）

1. `REQ-028`（L1）：Paper TTL/滑点状态机 — **依赖 REQ-027 Done**；入队时热点 `trading.js`/`monitor.js` 须空闲  
2. `REQ-029` + `CHG-009`（L1/L4）：企微跟单确认卡片 — 依赖 027/028 进展；热点企微业务回调 ≠ `/ops`  
3. `REQ-021`（L1）：沙盒/实盘检查表（Phase D）  
4. `REQ-008`（L2）：P2-16 主库治理  
5. （已出队近期）`REQ-030`/`CHG-010` Done · Gemini  

**互斥检查清单（入队强制）**

- [ ] 该 ID 不在另一 Agent 队列  
- [ ] 热点路径与另一队列 Doing 项无交集  
- [ ] 依赖项已 Done 或 Human 明确允许并行切片

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
| REQ-003 | L3 | 开盘 GEX 计划任务 | `agent:gemini` | Todo | 队列 0.B · 待确认开工 |
| REQ-027 | L1 | 三账本隔离+看板分源 | `agent:gemini` | Done | `zhao_positions`/`follow_decisions` 物理隔离，保护跟单仓 |
| REQ-028 | L1 | Paper TTL/滑点状态机 | `agent:gemini` | Todo | 待开工接续；热点 `trading.js`/`monitor.js` |
| REQ-029 | L1/L4 | 移动端跟单确认卡片 | — | Todo | accepted; 待 CHG-009 |
| CHG-009 | L4 | 企微业务跟单 HITL 回调 | — | Todo | accepted; != /ops |
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

## 6. 会话交接（2026-09-14）

- **双 Agent 高优队列**已启用（§0.A cursor / §0.B gemini）；Task+热点互斥。
- `agent:cursor`：REQ-027 Doing（Phase A）。
- `agent:gemini`：REQ-003 待确认开工（L3，避让 L1 热点）。
- Human：REQ-002 生产 ff。

- CHG-012：交叉 Review+修复队列（阈值/专题包触发）已写入 §0.R。
