# 03 — 需求与变更账本（REQ / CHG / REJ）

> 上级：[`README.md`](./README.md) · 未立项隐患先记 [`04`](./04-leftovers-problems.md) · 认领见 [`05`](./05-wip-board.md)  
> **04 成熟后升格（Promote）为本页正式行。** 聊天结论不算数。

---

## 1. 登记规则

| 类型 | ID | 状态机 |
|------|-----|--------|
| 需求 | `REQ-NNN` | `proposed`→`accepted`→`in_progress`→`done`（或 `deferred`/`dropped`） |
| 变更 | `CHG-NNN` | 写清 Before→After |
| 拒绝 | `REJ-NNN` | 固定 `rejected` |
| 优先级 | P0 / P1 / P2 / P3 | 立刻 / 近迭代 / 排期 / 暂缓 |

- 编号：全局递增，**不复用**。  
- Owner 以 [`05`](./05-wip-board.md) 为准（本页可不写 Owner，避免双源）。  
- 跨车道或改 `catalog.yaml`：必须独立 `REQ`/`CHG`。  
- 行模板建议含：摘要、车道、优先级、状态、热点路径、是否 HITL、备注。

---

## 2. 开放与在途

| ID | 优先级 | 车道 | 状态 | 摘要 | 热点/备注 |
|----|:------:|------|:----:|------|-----------|
| REQ-001 | P0 | L4 | `accepted` | Push `6099c6d` → `origin/main` | 需 `human` |
| REQ-002 | P0 | L4 | `accepted` | 生产 gcp-vm ff 对齐 | 勿无必要 restart；判据见 REQ-019 |
| REQ-003 | P1 | L3 | `accepted` | 挂载开盘前 GEX 计划任务 | `install_open_session_task.ps1` |
| REQ-004 | P1 | L3 | `proposed` | `latest.json` → GCP 看板同步约定 | 安全约束见 REQ-022；禁 GCP 跑 OpenD |
| REQ-005 | P2 | L5 | `accepted` | P5 券商只读 MCP | 无下单；建议 CI grep 门禁 |
| REQ-006 | P2 | L6 | `accepted` | P6 本机运维页 `:18789` | 仅 localhost |
| REQ-007 | P3 | L7 | `deferred` | NL 只读 Copilot | `/ops` 仍直达 |
| REQ-008 | P2 | L2 | `accepted` | P2-16 主库增长治理 | ~867MB |
| REQ-009 | P3 | L1 | `deferred` | uSMART 接入 | 远期 |
| REQ-010 | P3 | L1 | `deferred` | Python 回测引擎 | 远期 |
| REQ-014 | P0 | L0 | `done` | 文档树 + 协同框架入库 | `0dc31ea` |
| REQ-015 | P0 | L0/L4 | `in_progress` | 生产 C2 HITL Runbook | Owner=`agent:gemini`；骨架 `runbooks/hitl-c2.md` |
| REQ-016 | P0 | L0/L2 | `in_progress` | 事故响应 + 回滚 Runbook | Owner=`agent:gemini`；骨架 `runbooks/incident-rollback.md` |
| REQ-017 | P0 | L0/L4 | `accepted` | **密钥与企微运维变更控制**（`WECOM_OPS_*`、userid、推送 IP、隧道）；轮换与泄露应急（不写密文） | |
| REQ-018 | P1 | L4 | `done` | 企微能力面冻结清单 | `docs/project/wecom-freeze.md` · `38662c4` |
| REQ-019 | P1 | L4/L1 | `accepted` | **发布 go/no-go + 重启判据**（ff-only vs 必须 restart ingest/web；漏重启如何发现） | |
| REQ-020 | P1 | L4 | `accepted` | **C2 审计与看板闭环**（actor/channel/userid/sha/result ↔ 05 Ops 行） | |
| REQ-021 | P2 | L1 | `accepted` | **L1 跟单变更沙盒/实盘检查表** + human 门禁 | |
| REQ-022 | P2 | L3 | `accepted` | **REQ-004 安全专节**：只读产物同步、禁 OpenD、禁密钥随快照 | |
| REQ-023 | P0 | L0 | `done` | 进度文档并发协议 | 见 `06-process.md` §3 |
| REQ-024 | P1 | L3/L0 | `done` | `data/gex` 提交硬规则 | 见 04/06；human 已拍板 |
| REQ-025 | P1 | L0/L4 | `accepted` | **热点锁补强**：`catalog.yaml` 独占；Doing 行登记占用路径；跨 REQ 同路径禁止 | |

| ID | 状态 | 摘要 |
|----|:----:|------|
| CHG-001 | `done` | 企微推送经 GCP 固定 IP（防 60020） |
| CHG-002 | `done` | OpenD 预检 + collect 友好失败 |
| CHG-003 | `done` | WeCom 栈开机自启 |
| CHG-004 | `done` | `/ops gex status` → `gex.summarize` |
| CHG-005 | `done` | **修订** `local-ops-mcp-skill-plan.md`：作废「企微消耗 confirm_token / 企微点 C2」；P3/§10 对齐 REJ-001 | 2026-09-14 `agent:cursor` |
| CHG-006 | `accepted` | **扩写** `06-process` 发布/HITL 可执行清单（对齐→验证→具名 restart→记录） |
| CHG-007 | `accepted` | 统一开工必读：rule / AGENTS / README 均指向 `docs/project/` 全树 |

---

## 3. 已关闭（勿删行）

| ID | 车道 | 状态 | 摘要 | 关闭说明 |
|----|------|:----:|------|----------|
| REQ-011 | L4 | `done` | Local-Ops P0–P4.1 | PR #14 + `6099c6d` |
| REQ-012 | L3 | `done` | GEX v1 | 含 2026-09-14 拉链 |
| REQ-013 | L2 | `done` | 加固 P0–P2 主体 | P2-14 → REJ-005 |

---

## 4. 明确拒绝（REJ）

| ID | 摘要 | 理由 |
|----|------|------|
| REJ-001 | 企微开放 C2 | 手机最小权限 |
| REJ-002 | Agent 自治 restart/切流 | 须 HITL |
| REJ-003 | catalog `place_order`（含 disabled 占位） | 资金红线 |
| REJ-004 | 告警/看门狗/软降级调 C2 | R2 |
| REJ-005 | P2-14 RUM（本阶段） | 低优先跳过 |
| REJ-006 | VM 上 MCP/Agent 或 GCP 跑 OpenD | 边界 |
| REJ-007 | Agent 声称或代跑 `human-approve` 已完成 | 除非 human 在 05 Ops 行确认；禁止把 approve 命令当默认可执行交付物 |
| REJ-008 | 未经 CHG 扩大企微映射（新 C0 侦察/任何 C2/第二 C1） | 攻击面控制 |
| REJ-009 | 告警或 Agent 触发生产 C2 | 巩固 REJ-002/004 |
| REJ-010 | 多 Agent 无协议大段并行改总控文档 | 仅允许 06 并发协议内追加 |

---

## 5. 编号说明（审阅合并）

[security-ops](c715940a-391c-4d03-b32b-f129502363ee) 与 [cursor](bb147c2e-716e-4af9-bba1-9ff6cd68c349) 曾对 REQ-015～022 提出**不同语义**的重叠编号。本页已**重映射合并**为 REQ-015～025 + CHG-005～007 + REJ-007～010。以本页为准。
