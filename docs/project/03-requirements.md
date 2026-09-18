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
| REQ-001 | P0 | L4 | `done` | Push 本地 commits → `origin/main` | `de872b0..1352705` |
| REQ-002 | P0 | L4 | `accepted` | 生产 gcp-vm ff 对齐 | 勿无必要 restart；判据见 REQ-019 |
| REQ-003 | P1 | L3 | `done` | 挂载开盘前 GEX 计划任务 | Owner=`agent:cursor`；Task=`WhopGexOpenSession0940ET` Ready；ET→本地墙钟安装器 |
| REQ-004 | P1 | L3 | `done` | `latest.json` → GCP 看板同步（默认 SCP） | Owner=`agent:cursor`；`sync_latest_to_gcp.js`；Q-001 interim=SCP；`test_gex_sync_scp_req004.js` |
| REQ-005 | P2 | L5 | `done` | P5 券商只读 MCP | Owner=`agent:cursor`；broker.lb.* + futu.opend_probe；catalog 无 place_order；test_broker_readonly_req005 |
| REQ-006 | P2 | L6 | `done` | P6 本机运维页 `:18789` | Owner=`agent:cursor`；GET /ui + POST /api/ops/invoke；test_ops_ui_req006 |
| REQ-007 | P3 | L7 | `deferred` | NL 只读 Copilot | `/ops` 仍直达 |
| REQ-008 | P2 | L2 | `done` | P2-16 主库增长治理 | Owner=`agent:gemini` · `db-maintenance.js` · `runbooks/db-maintenance-p2-16.md` |
| REQ-009 | P3 | L1 | `deferred` | uSMART 接入 | 远期 |
| REQ-010 | P3 | L1 | `deferred` | Python 回测引擎 | 远期 |
| REQ-014 | P0 | L0 | `done` | 文档树 + 协同框架入库 | `0dc31ea` |
| REQ-015 | P0 | L0/L4 | `done` | 生产 C2 HITL Runbook | Owner=`agent:gemini`；`runbooks/hitl-c2.md` |
| REQ-016 | P0 | L0/L2 | `done` | 事故响应 + 回滚 Runbook | Owner=`agent:gemini`；`runbooks/incident-rollback.md` |
| REQ-017 | P0 | L0/L4 | `done` | **密钥与企微运维变更控制**（`WECOM_OPS_*`、userid、推送 IP、隧道）；轮换与泄露应急（不写密文） | Owner=`agent:gemini`；`runbooks/secret-rotation-and-ip.md` |
| REQ-018 | P1 | L4 | `done` | 企微能力面冻结清单 | `docs/project/wecom-freeze.md` · `38662c4` |
| REQ-019 | P1 | L4/L1 | `done` | 发布 go/no-go + 重启判据 | `runbooks/deploy-restart.md` |
| REQ-020 | P1 | L4 | `done` | **C2 审计与看板闭环**（actor/channel/userid/sha/result ↔ 05 Ops 行） | Owner=`agent:gemini`；`runbooks/c2-audit-loop.md` |
| REQ-021 | P2 | L1 | `done` | **L1 跟单变更沙盒/实盘检查表** + human 门禁 | `runbooks/follow-sandbox-to-live-gate.md`；Owner=`agent:gemini` |
| REQ-022 | P2 | L3 | `done` | **REQ-004 安全专节**：只读产物同步、禁 OpenD、禁密钥随快照 | Owner=`agent:gemini` · `gex-sync-validator.js` · `runbooks/gex-gcp-sync-security.md` |
| REQ-023 | P0 | L0 | `done` | 进度文档并发协议 | 见 `06-process.md` §3 |
| REQ-024 | P1 | L3/L0 | `done` | `data/gex` 提交硬规则 | 见 04/06；human 已拍板 |
| REQ-026 | P0 | L0 | `done` | 多端统一 Agent 治理：`AGENTS.md` 精炼版 + `CLAUDE.md` 指针 + `.cursor/rules/agent-governance.mdc` | 2026-09-14 |
| REQ-027 | P1 | L1 | `done` | **三账本隔离**：赵哥 signal ≠ 跟单 decision ≠ fill；看板分源 | Owner=`agent:gemini`；`zhao_positions`/`follow_decisions` 物理隔离，`recalculate_ledger` 保护跟单仓 |
| REQ-028 | P1 | L1 | `done` | **落地 Paper 状态机**（TTL/滑点）；停解析后直连实盘 | 对齐 `follow_execution_spec.md`；五大状态机闭环落库，实盘安全红线阻断 |
| REQ-029 | P1 | L1/L4 | `done` | **移动端跟单确认卡片**（执行/放弃/解析错误）+ 90s 超时 | `follow-hitl.js` + `/api/follow/hitl-callback` 独立通道；Owner=`agent:gemini` |
| REQ-030 | P1 | L1 | `done` | **大V即时推送实事求是**：剥离「已同步处理量化跟单」硬编码；发言通知与交易通知正交 | 热点 `monitor.js`；Owner=`agent:gemini` |
| REQ-031 | P1 | L1 | `done` | **解析即写 signal 流水**（独立于 follow/decision）；盘中赵哥账本不依赖事后 recalculate | Owner=`agent:cursor`；`trade_signals` + `saveTradeSignal`；`test_trade_signals_req031.js` |
| REQ-032 | P1 | L1 | `done` | **arrivalPrice 取真实盘口**（禁用喊单价冒充现价）；滑点状态机才可信 | Owner=`agent:cursor`；`fetchTickerKlineData` → processFollowDecision |
| REQ-033 | P1 | L1/L4 | `in_progress` | **历史大V交易单回放与企微移动端纠错反馈**（进度以 **05 §0.B** 为准，约 #83+；应用「本机运维」私信推送；SLM/级联细节随 gemini 回写） | 队列 0.B · Owner=`agent:gemini` · `follow-replay-engine.js` · `wecom/push.js` |
| REQ-034 | P2 | L6 | `done` | **Localhost Ops 端口 `:18789` CSRF/Origin 与 DNS Rebinding 阻断** | Owner=`agent:cursor` · `http-guard.js` · `test_http_guard_req034.js` |
| REQ-035 | P1 | L1 | `done` | **历史回放纠错与 `trade_signals` 流水自动校准联动**（纠错后幂等写入一条 `source=manual_correct` 的 signal） | 2026-09-18 `agent:gemini` · `follow-replay-engine.js` · `database.js` · `test_replay_signal_sync_req035.js` |
| REQ-036 | P1 | L3 | `active` | **大V交易语义专有轻量 AI (SLM) 微调方案与数据飞轮**（长期常驻主线：V1闭环已就绪，随企微人工纠错 Golden 增量持续自动化滚动微调与热更新） | 常驻维护 · `scripts/slm/*` · `models/zhao_slm_1.5b_lora` |
| REQ-037 | P2 | L3 | `in_progress` | **大V全频道多模态图文对齐与交易知识本体图谱**（P1 Done；**P2 脚手架落地**：`semantic_cu`+heuristic 切分+单测；待黄金集评测；P3 未开；P4 冻结） | 队列 0.A · Owner=`agent:cursor`；`test_semantic_cu_req037_phase2.js`；Q-006 不影响 P2 |
| CHG-016 | P1 | L2 | `done` | **看板日期过滤强绑定北京时间 (+08:00) 闭环**：解决宿主机 UTC 8小时漂移，消除次日混入并补齐凌晨发言；生产单进程热载生效 | `database.js` · `test/test_date_filter_timezone.js` |

| ID | 状态 | 摘要 |
|----|:----:|------|
| CHG-001 | `done` | 企微推送经 GCP 固定 IP（防 60020） |
| CHG-002 | `done` | OpenD 预检 + collect 友好失败 |
| CHG-003 | `done` | WeCom 栈开机自启 |
| CHG-004 | `done` | `/ops gex status` → `gex.summarize` |
| CHG-005 | `done` | **修订** `local-ops-mcp-skill-plan.md`：作废「企微消耗 confirm_token / 企微点 C2」；P3/§10 对齐 REJ-001 | 2026-09-14 `agent:cursor` |
| CHG-006 | `done` | **扩写** `06-process` §6 发布/HITL 可执行清单（对齐→验证→具名 restart→记录） | 2026-09-14 `agent:cursor` · 热点 `docs/project/06-process.md` |
| CHG-007 | `done` | 统一开工必读：rule / AGENTS / README / BOOTSTRAP 均指向 `docs/project/` 全树；BOOTSTRAP 对齐 CHG-014 自主跑队 | 2026-09-14 `agent:cursor` |
| CHG-008 | `done` | **收工默认自动** commit（带 REQ/CHG）+ `push origin HEAD` + 回写文档树；禁夹带密钥/GEX HTML/scratch；生产 ff/C2 仍 HITL | 2026-09-14 `agent:cursor` · `AGENTS.md` §6 · `06` §8 · progress-sync rule |
| CHG-009 | `done` | **企微业务跟单 HITL 回调**（卡片 EXECUTE/SKIP/PARSE_ERROR）；与 `/ops` 冻结表分立专节；禁运维 C2 | 见 `follow-hitl-plan.md`；须威胁说明+单测 |
| CHG-010 | `done` | **Before**：即时推送硬编码「已同步处理量化跟单」· **After**：大V发言卡仅事实字段；交易由 `trading.js` 独立推送 | 落地 REQ-030 · `monitor.js` |
| CHG-011 | `done` | **双 Agent 高优队列**：05 §0.A/`cursor` + §0.B/`gemini` 互斥；共享候选池；README 镜像；06 §1.1 SOP | 2026-09-14 `agent:cursor` |
| CHG-012 | `done` | **交叉 Review+修复队列**：累计 Done≥5 或专题包关闭 → 移交对方 §0.R；07 收意见；06 §1.2 | 2026-09-14 `agent:cursor` |
| CHG-014 | `done` | **人令「跑完队列」后双 Agent 自主开发↔审修闭环**，中间勿打断确认（仍守互斥/HITL/红线） | 2026-09-14 |
| CHG-013 | `done` | **每次同步文档树必须重读并镜像最新 §0 队列**（禁会话记忆排班；README↔05 同提交一致） | 2026-09-14 `agent:cursor` · AGENTS/06/rules |
| CHG-015 | `done` | **LM Studio 显存守卫与绝对防重复加载机制**：`tools/lms-guard.js` 强幂等装载+自动排重巡检+显存预算核算+npm脚本；杜绝 `:2` 冗余副本挤爆显存 | 2026-09-15 `agent:gemini1` |
| CHG-016 | `done` | **看板日期过滤强绑定北京时间 (+08:00) 闭环**：`database.js` 统一 `parseDateFilterToMs`，解决宿主机 UTC 8小时漂移，消除次日混入并补齐凌晨发言；生产单进程热载 `whop-web-dashboard` 生效 | 2026-09-15 `agent:gemini` · `database.js` · `test_date_filter_timezone.js` |
| CHG-017 | `done` | **方案 A 双模型分流与动态生命周期调度架构**：快车道 1.5B 永久常驻零冷启动摩擦；深车道 14B 采用 3600s 迟滞保活防频繁换入换出摩擦 + JIT 懒加载唤醒 (`ensureModelReady`)；全仓模型配置、文档、LM_STUDIO_OPTIMIZATION 及 Local-Ops 白名单同步对齐 | 2026-09-15 `agent:gemini1` · `tools/lms-guard.js` · `ai-router-policy.js` · `LM_STUDIO_OPTIMIZATION.md` |

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
