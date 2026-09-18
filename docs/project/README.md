# 项目文档树（总索引）

> **多 Agent / 人机协同的文档根。** 进度、需求、WIP、流程都以本树为准；禁止另起平行「总进度」。  
> Cursor 规则：`.cursor/rules/project-progress-sync.mdc` · 仓库入口：[`AGENTS.md`](../../AGENTS.md)

| 字段 | 值 |
|------|-----|
| 最后审阅 | 2026-09-19 |
| 审阅基准 HEAD | 以 `git log -1` 为准；**每次同步必重读 §0 队列**（`CHG-013`） |
| Agent 治理真相源 | 根目录 [`AGENTS.md`](../../AGENTS.md)（Claude→`CLAUDE.md` 指针；Cursor→`.cursor/rules/agent-governance.mdc`） |
| 权威方案 | [`../local-ops-mcp-skill-plan.md`](../local-ops-mcp-skill-plan.md) · [`../system-hardening-and-monitoring-plan.md`](../system-hardening-and-monitoring-plan.md) · [`../gex-sidecar.md`](../gex-sidecar.md) · [`zhao-knowledge-multimodal-plan.md`](./zhao-knowledge-multimodal-plan.md) · [`wsl-unified-ai-runtime-plan.md`](./wsl-unified-ai-runtime-plan.md) |

---

## 树形结构

```
docs/project/                          ← 你在这里（总索引）
├── README.md                          ← 本文件：导航 + 一页总览
├── BOOTSTRAP.md                       ← 新会话启动词（CHG-007）
├── 01-background-vision.md            ← 背景 / 目标 / 展想 / 非目标
├── 02-current-state.md                ← 现状：四主线与能力面事实
├── 03-requirements.md                 ← 需求与变更账本 REQ/CHG/REJ
├── 04-leftovers-problems.md           ← 遗留 / 开放问题 / 风险 / 已知债
├── 05-wip-board.md                    ← 谁在做、做到哪（WIP 看板）
├── 06-process.md                      ← 开发流程框架 + 文档维护 SOP
├── 07-review-inbox.md                 ← 多 Agent 审阅意见与查漏清单
├── follow-hitl-plan.md                ← L1 跟单三账本/确认/Paper 对齐方案（accepted）
├── zhao-knowledge-multimodal-plan.md  ← REQ-037 多模态知识图谱（accepted·P1/P2/P3 Done）
└── wsl-unified-ai-runtime-plan.md     ← CHG-018 统一 WSL2 AI 运行时（门禁达标·待 Q-007 切流）

专题权威方案（不重复当总进度，只被引用）：
docs/local-ops-mcp-skill-plan.md       ← Local-Ops / 企微 / MCP
docs/system-hardening-and-monitoring-plan.md
docs/gex-sidecar.md
docs/project/zhao-knowledge-multimodal-plan.md ← REQ-037 多模态知识图谱方案
docs/project/wsl-unified-ai-runtime-plan.md    ← CHG-018 统一 WSL2 AI 运行时方案
docs/project-progress.md               ← 兼容跳转页（指向本树）
```

---

## 按阅读目的导航

| 你想… | 去读 |
|------|------|
| **新开对话快速切入** | [`BOOTSTRAP.md`](./BOOTSTRAP.md)（复制通用提示词） |
| 理解为什么做、做到哪一步愿景 | [`01-background-vision.md`](./01-background-vision.md) |
| 知道现在系统实际跑成什么样 | [`02-current-state.md`](./02-current-state.md) |
| 登记/查找需求与变更 | [`03-requirements.md`](./03-requirements.md) |
| 看坑、遗留、风险、未决策项 | [`04-leftovers-problems.md`](./04-leftovers-problems.md) |
| 认领任务、看谁在做 | [`05-wip-board.md`](./05-wip-board.md) |
| 按流程开发、维护文档 | [`06-process.md`](./06-process.md) |
| 提交/消化审阅意见 | [`07-review-inbox.md`](./07-review-inbox.md) |

---

## 一页总览（状态快照）

| 主线 | 状态 | 一句话 |
|------|:----:|--------|
| L1 核心业务 Whop→AI→微信→跟单 | ✅ | 双进程生产闭环 |
| L2 加固与监测 P0–P2 | ✅ | 主体收官；**P2-16=`REQ-008` Done** |
| L3 GEX 结构传感器 | ✅ | v1 可用；开盘任务已挂；SCP 同步脚本就绪 |
| L4 Local-Ops / 企微回控 | ✅ 联调 | P5/P6/REQ-034 Done；生产 ff 待 human（REQ-002） |
| L5 券商只读 P5 | ✅ | REQ-005 Done |
| L6 本机运维页 P6 | ✅ | REQ-006 Done · http://127.0.0.1:18789/ui |
| L7 NL Copilot | ⏸ | 暂缓（只读参谋构想） |

**三层能力面**：① 业务守护流水线 ② 本机 Local-Ops catalog ③ 企微极窄 `/ops`（C0 + `gex.collect`）。详见 [`01`](./01-background-vision.md) / [`02`](./02-current-state.md)。

**当前高优执行队列（双 Agent · 互斥）**：唯一准绳 [`05-wip-board.md`](./05-wip-board.md) §0  

| 队列 | 顺位 1 | 状态 |
|------|--------|:----:|
| **§0.A `agent:cursor`** | （空 · CHG-018 抽审 + 037 CU 工具 Done） | — |
| **§0.B `agent:gemini`** | **REQ-033** Doing + **CHG-018** Step1–3全通（待Q-007切流） | Doing |
| **§0.C `agent:gemini1`** | **REQ-036** SLM 飞轮 | Standing |
| **§0.H `human`** | REQ-002；Q-001；Q-006；**Q-007** 关 LMS 切流 | 等待 |
| **§0.R-A** | CHG-018 方案审阅 + `7da433a` 门禁抽审 | Done |

**交叉审修 / 自主跑队**：`CHG-012` / `CHG-014`。

**审阅建议编号**：已合并进 [`03`](./03-requirements.md)（REQ-015～025）。

---

## 维护口令（最短）

1. **新需求/变更/拒绝** → 写 [`03-requirements.md`](./03-requirements.md)  
2. **开干** → 认领 [`05-wip-board.md`](./05-wip-board.md)  
3. **发现坑/遗留** → 写 [`04-leftovers-problems.md`](./04-leftovers-problems.md) 并可升格为 REQ  
4. **联审结论** → [`07-review-inbox.md`](./07-review-inbox.md)，落地必须进 03  
5. **流程怎么走** → [`06-process.md`](./06-process.md)  
6. **审阅意见** → [`07-review-inbox.md`](./07-review-inbox.md)（已收入 security-ops 高危缺口与建议 REQ-015～022）
