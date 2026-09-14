# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

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
| REQ-015 | L0/L4 | 生产 C2 HITL Runbook | `agent:gemini` | Doing | 骨架：`runbooks/hitl-c2.md` |
| REQ-016 | L0/L2 | 事故响应+回滚 Runbook | `agent:gemini` | Doing | 骨架：`runbooks/incident-rollback.md` |
| REQ-001 | L4 | Push 本地 commits → origin | `human`→pushing | Doing | 含 6099c6d + docs + gex latest |
| REQ-002 | L4 | 生产 ff 对齐 | `human` | Todo | 依赖 push；判据见 REQ-019 |
| REQ-003 | L3 | 开盘 GEX 计划任务 | — | Todo | 可抢 |

状态枚举：`Todo` | `Doing` | `Blocked` | `Review` | `Done`

---

## 2. 子 Checklist（仅复杂项）

### REQ-014 文档树入库

- [x] 01–07 + README + 跳转页 + AGENTS/rule  
- [x] 独立 docs commit（无 GEX HTML）→ `0dc31ea`

### REQ-015（Gemini）建议大纲

- [ ] human-approve 谁可执行 / 超时 / 失败  
- [ ] 禁止 Agent 代跑（REJ-007）  
- [ ] 每次 C2 回写本页「Ops 审计」或 audit id  
- [ ] 与 REQ-020 字段对齐  

### REQ-016（Gemini）建议大纲

- [ ] 事故分级与宣布人  
- [ ] 止血 vs 回滚；旧 SHA / 单体镜像  
- [ ] 验证清单；禁止临场通用 SSH  

---

## 3. Ops 审计行（生产 C2，human 填写）

| 时间 | human | 动作 | 目标 | 结果 | 备注 |
|------|-------|------|------|------|------|
| — | — | — | — | — | （空） |

---

## 4. 最近完成

| ID | Owner | 日 | 结果 |
|----|-------|-----|------|
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

---

## 6. 会话交接（2026-09-14 Cursor）

- 治理已落地：根 `AGENTS.md` + `CLAUDE.md` + `.cursor/rules/agent-governance.mdc`  
- 总控：`docs/project/README.md`  
- Gemini 续：REQ-015/016 runbook 正文  
- Human：本轮 push 后做 REQ-002 生产 ff  
