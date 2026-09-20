# 05 — WIP 责任看板（谁在做 · 做到哪）

> 上级：[`README.md`](./README.md) · 账本 [`03`](./03-requirements.md) · 审阅 [`07`](./07-review-inbox.md)  
> **一 REQ 一行**；复杂任务才在下方展开子 Checklist。Owner 以本页为准。

---

## 0. 处理中高优队列（双 Agent · Priority In-Flight）

> 人令跑完后自主接续（`CHG-014`）。每次同步重读本页（`CHG-013`）。

### 0.A 队列 `agent:cursor`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-038-T2** | L3 | CHG-036 扩样后 **n_scored=7** hit5≈3/7（+SPY/QQQ/IREN） | `card_attribution.js` | **Doing** |
| 2 | **REQ-040** | L3 | Cursor 接手 T1；空 SR 重提完成；赵哥 TSLA 多为聊天截图无点位 | `batch_vision*` · `card_attribution*` | **Doing** |
| 3 | **REQ-038-T1** | L3 | Gemini 额度耗尽→**Cursor 接管**：`--reprocess-empty-sr` + aligner 脏卡清理 | `batch_vision*` · `multimodal_context_aligner.js` | **Doing** |
| 4 | **DEBT-014** | L3 | HIP 满血暂缓 | `/root/llama.cpp/build-cpu` | Standing |

### 0.B 队列 `agent:gemini`

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-033** | L1/L4 | 历史大V交易单回放与企微纠错（队头 #91 CONL；**Blocked→Human 企微点击**） | `follow-replay-engine.js` · `server.js` | **Blocked (Active)** |
| 2 | **REQ-038-T1** | L3 | 432张真图云端VL批跑全部收工；422条视觉元数据+124张纯赵哥图卡，non_zhao=0，promote dump已出 | `batch_vision*` · `data/runtime/knowledge-promote.sqlite` | **Done** |
| 3 | **REQ-041** | L3 | 盘口四维共振（含 2x ETF 折算） | `tape_confluence_detector*` | **Done** |
| 4 | **REQ-042** | L3/L5 | 富途 OpenD + 长桥 Paper 双通道实测；空间印证引擎 | `brokers/longbridge.js` · `real_market_confluence_verifier*` | **Done** |
| 5 | **REQ-043** | L3/L5 | 自动驾驶感知总线 (Live Sensor Hub) 与四维共振实时在线驱动引擎 | `live_tape_feed.js` · `test_live_tape_feed.js` | **Done** |
| 6 | **REQ-044** | L3/L5 | 美股时段感知哨兵守护进程 (盘中15~30s持续监测，休市低功耗待机) | `market_session.js` · `live_radar_sentinel.js` | **Done** |
| 7 | **REQ-045** | L3/L5 | 美股微观结构与四维共振量化决策驾驶舱（含黄金战法矩阵融合与只读 API） | `public/radar_hud.html` · `readonly-api-router.js` | **Done** |
| 8 | **REQ-046** | L3/L4 | 盘中高置信度四维共振预警企微卡片推送（防抖冷却与客观微观结构呈现） | `radar_alert_pusher.js` | **Done** |
| 9 | **REQ-047** | L3/L5 | 美股工作日全时段（夜盘/盘前/盘中/尾盘/盘后）全天候在线感知与 SPX/SPY/TradingView 极速多源指数引擎 | `market_session.js` · `index_equivalent_converter.js` | **Done** |
| 10 | **REQ-048** | L3/L5 | 赵哥 M7 七姐妹单边下跌战法探测器 + 首尾时段 5 秒超高频扫盘 (CHG-041) | `m7_breadth_detector.js` · `live_radar_sentinel.js` | **Done** |
| 11 | **REQ-049** | L3 | 战法本体流形聚类与弱检验收口 (A/B/C/D 全流程收工 · 四层图谱建立 · 049-C2 待办立项) | `docs/project/049*` | **Done** |
| 12 | **REQ-050** | L3 | 战法本体事件驱动自适应窗口短周期微观复验 (049-C2 落地 · 分钟级MFE/MAE · 突破日K失配) | `scripts/knowledge/backtest_adaptive_window_050.js` · `docs/project/050*` | **Done** |
| 13 | **REQ-051** | L3 | 近60天黄金窗口真实交易单与战法事件短周期回测集训与前瞻落盘 (898笔实盘信号+4128张卡片全面对齐) | `scripts/knowledge/train_recent_60d_microstructure.js` · `docs/project/051-recent-60d-training-report.md` | **done-eng** |
| 14 | **REQ-052** | L3 | 基于真实交易单(t0)的逆向特征挖掘与高置信战术假说提纯 (提案A落地 · 388真实成交反查语境与分时结构) | `scripts/knowledge/reverse_mine_tactics_from_trades.js` · `docs/project/052-reverse-tactical-mining-report.md` | **done-eng** |
| 15 | **REQ-053** | L3 | 实战战术持仓动态生命周期状态机 (TAC-001/002/003工程化 · 1/6分批/半仓止盈/做T加回) | `tools/trade/position_lifecycle_manager.js` · `test/test_position_lifecycle_manager.js` | **done-eng** |
| 17 | **REQ-056** | L1/L5 | 长桥模拟盘（Paper Trading）执行闭环与 TradeIntent 最小执行状态机工程落地（Phase 0 Week 1 · 状态机/撤单/轮询/持仓SoR/HUD双轨闭环全通） | `brokers/longbridge.js` · `tools/trade/paper_execution_engine.js` · `database.js` | **done-eng (accepted-with-gap)** |

### 0.C 队列 `agent:gemini2` (数据资产治理 / 人工审核联动 / SLM飞轮)

| 顺位 | ID | 车道 | 任务简述 | 热点占用 | 状态 |
|:---:|----|:---:|----------|----------|:----:|
| **1** | **REQ-055 (SLM)** | L3 | 审核进度每10%里程碑自迭代微调与实战对账单机制（响应人令，首轮10%已收口，飞轮优雅待机；人令裁决下一次完整微调与模型更新锁定在 20% 里程碑即 166 笔时执行，尚差 76 笔，单测全绿） | `scripts/slm/flywheel_engine.js` · `test/test_slm_milestone_pipeline.js` · `docs/project/055*` | **done-eng (accepted-with-gap)** |
| 2 | **REQ-054** | L3 | 交易单人工审核增量联动流水线与 DEBT-021 闭环（90笔审核融合/10笔人工纠偏优先覆盖/746对配对重算/90组SLM黄金样本，单测全绿） | `tools/trade/audit_linked_pnl_pipeline.js` · `docs/project/054*` | **done-eng (accepted-with-gap)** |
| 3 | **REQ-036** | L3 | 大V专有 SLM 数据飞轮（V1闭环，已增量接收 REQ-054/055 提纯的 90 组人机对齐黄金样本，待 WSL GPU 物理重训） | `scripts/slm/*` · `models/zhao_slm_1.5b_lora` | **Standing (Active)** |
| 4 | **REQ-038-T2/REQ-040** | L3 | T2 高胜率战法黄金提纯与 Golden Playbook 固化（扩标池回测 n_scored=147，提纯 108/175 张战法；雷达已设物理隔离门禁） | `card_attribution*` · `data/runtime/golden_playbook.json` | **done-eng** |
| 5 | **DEBT-017~020** | L3 | 数据资产结构缺陷清账与战法分级隔离（DEBT-017 713对闭环/84%配对/经抽检验真 + DEBT-018 战法分级: 175张 level 独占雷达顶格加权、310张 direction 隔离为宏观参考 + DEBT-019 657张深层卡片/1,314组问答对 + DEBT-020 大单时序表落地，抽检与单测全绿） | `tools/trade/*` · `tools/knowledge/*` | **done-eng (accepted-with-gap)** |


### 0.H Human

| ID | 任务 | 状态 |
|----|------|:----:|
| REQ-002 | 生产 ff 对齐 + restart | **Done**（Human 2026-09-19 确认已 restart；ff→`e2733cf` 波次） |
| Q-001 | GEX→GCP 通道 | interim=SCP（可再改） |
| Q-002 | 漏重启用何信号发现？ | **Done**（`CHG-020`：`/health` 暴露 `process.gitCommit`，`gcp_health_bundle` 自动计算 `restart_drift`） |
| Q-006 | REQ-037 视觉模型 | **Done**（已决：云端轻量 VL 离线批；禁 VL→L2a；硬账 >15KB=432 张可排预算） |
| Q-007 | CHG-018：关 Windows LM Studio 切流？ | **Done**（Human 2026-09-19 确认已关 LMS 且切流试用 OK） |
| Q-008 | REQ-038-T1 云端 VL API 密钥 | **Done**（Human 配置纯 Free Tier 密钥；实测 SPY K线真图多模态抽取成功，纯免费 0 扣费） |
| **企微 #91 CONL** | 解锁 §0.B REQ-033 队头回放 | **等待点击**（阻塞 gemini） |

### 0.X Blocked 感知表（跨 Owner · 强制可见）

> 任一队列项进入 `Blocked` 必须在本表留一行；**解锁 Owner** 每次同步必读。解除后删行或改 `Cleared`。

| 阻塞项 | 被阻塞方 | 解锁 Owner | 阻塞原因 | 解锁动作 | 状态 |
|--------|----------|------------|----------|----------|:----:|
| **REQ-040 / T2 扩样** | `agent:cursor` | **`agent:gemini1`** | 赵哥 TSLA 图多为聊天截图无 SR | 关联 `source_text` 预富集修复，扩标池至 12 标的，全库评测 166 张（n_scored=147），提纯 108 张黄金战法 | **Cleared** |
| **REQ-033 #91 CONL** | `agent:gemini` | **`human`** | 企微专属回放群等待卡片点击 | Human 在企微点 #91 CONL 确认/纠错 | **Open** |
| **DEBT-014 HIP** | `agent:cursor`（候选） | **环境/Human** | WSL HIP/ROCm 编译链未就绪；CPU llama 已满血 | 备齐 ROCm 后再编 `/root/llama.cpp/build-hip` | **Deferred** |

### 0.R

| 审修方 | 批次 | 状态 |
|--------|------|:----:|
| §0.R-A cursor | PKG-FOLLOW-FULL | **Done** |
| §0.R-B gemini | PKG-CURSOR-WAVE（003/022/031/032/005/006） | **Done** |
| §0.R-A cursor | REQ-037 多模态知识图谱方案评审 | **Done** |
| §0.R-A cursor | REQ-035 机会抽审（`dffa097`） | **Done** |
| §0.R-A cursor | REQ-033 推送通道波次抽审（`ed411ab`…`7919849`） | **Done** |
| §0.R-B gemini | REQ-037 P2+P3 知识图谱专题包（`bc5b0d6`…`170af17`） | **Done** |
| §0.R-A cursor | **CHG-018 统一 WSL2 AI 运行时方案审阅** | **Done** |
| §0.R-A cursor | **CHG-018 门禁落地抽审（`7da433a`）** | **Done** |
| §0.R-A cursor | **CHG-018 Step1–3/切流口径抽审（`e469d29`/`cd183dc`）** | **Done** |
| §0.R-A cursor | **REQ-037 batch distill + Layer4 query（`4675823`/`3e81a18`）** | **Done** |
| §0.R-A cursor | **REQ-037 全库蒸馏闭环（`e9fc925`）** | **Done** |
| §0.R-A cursor | **REQ-037 query CLI minConfidence（`a764c25`+fix）** | **Done** |
| §0.R-A cursor | **DEBT-013 GEX 开盘任务 DST 免疫对齐抽审** | **Done**（accepted-with-gates） |
| §0.R-B gemini | **CHG-019 + DEBT-014 路径抽审（`52f2ed9`）** | **Done** |
| §0.R-A cursor | **CHG-020 / Q-002 漏重启发现信号与探针抽审** | **Done**（accepted） |
| §0.R-B gemini | **GPU 跨项目资源协议 v0.1-draft**（自签；已被 Cursor 置顶冻结覆盖） | **Done** |
| §0.R-A cursor | **GPU 协议 v0.1 + CHG-021 抽审**（§7 冻结；骨架 accepted-with-gates） | **Done** |
| §0.R-B gemini | **CHG-023 WSL AI 切流锁定抽审** | **Done**（通过） |
| §0.R-B gemini | **CHG-024 GPU 控制面加固抽审** | **Done**（通过） |
| §0.R-B gemini | **CHG-025 / 协议 v0.1.4 对齐抽审** | **Done**（通过） |
| §0.R-B gemini | **REQ-039 / CHG-027 知识 promote 通道抽审** | **Done**（通过 · Cursor 已消化） |
| §0.R-A cursor | **REQ-038-T1 多模型 fallback（`76641b1`）抽审** | **Done**（accepted-with-gates） |
| §0.R-A cursor | **REQ-038 Sprint 1 开工规划抽审** | **Done**（accepted-with-gates） |
| §0.R-A cursor | **REQ-038-T1 VL 离线批跑管道与门禁抽审（`bdb0804`）** | **Done**（accepted-with-gates） |
| §0.R-A cursor | **REQ-042 / CHG-034（`779d055`）抽审** | **Done**（accepted-with-gates · 见 07） |
| §0.R-A gemini1 | **Commit bf8d14b 量化驾驶舱与黄金战法加权抽审** | **Done**（Accepted · 见 07） |
| §0.R-C gemini1 | **CHG-046 整改验收与六点门禁钉死（Grok 外部审阅）** | **Done**（ACCEPT WITH NOTES · 见 07） |

### 共享候选池

1. （Doing · cursor）WSL HIP 编译真实 `llama-server` → DEBT-014 满血
2. （已出队 · REQ-037）默认 `--sender xiaozhaolucky` 蒸馏批跑落地，1995 张大V纯正卡片沉淀入库，单测全绿
3. （已出队 · CHG-024）`:18080` 可达 + 禁假成功 + Wan 拒载 · 协议 v0.1.3
4. （已出队）… · 037-batch · 037-layer4 · 037-full-scan `e9fc925` · DEBT-014-code · CHG-021 骨架 · CHG-022 门禁 · CHG-023 切流

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
| REQ-002 | L4 | 生产 ff 对齐 + restart | `human` | Done | Human 2026-09-19 确认 pm2 已重启 |
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
| REQ-033 | L1/L4 | 历史回放+企微纠错（进度以 §0.B 为准：约 #83+；应用私信推送） | `agent:gemini` | Doing | `follow-replay-engine` · `wecom/push` |
| REQ-035 | L1 | 回放纠错与 trade_signals 自动校准联动 | `agent:gemini` | Done | `follow-replay-engine.js` · `test_replay_signal_sync_req035.js` |
| REQ-036 | L3 | 大V交易语义专有 SLM 微调与数据飞轮（含自迭代流水线） | `agent:gemini` | Done | 1030组SFT/DPO+ROCm LoRA+`flywheel_engine.js`+单测全绿 |
| REQ-037 | L3 | 多模态知识图谱 P1–P3（含卡片蒸馏引擎） | 双Agent协同 | Done | P1 vision + P2 CU + P3 distill四大卡片全绿（默认大V过滤，1995张沉淀入库）；P4 冻结 |
| REQ-022 | L3 | GEX→GCP 同步安全专节 | `agent:cursor` | Done | runbooks/gex-gcp-sync-security.md |
| CHG-016 | L2 | 看板日期过滤强绑定北京时间 (+08:00) 闭环 | `agent:gemini` | Done | `3dc07c2` · 生产单进程重启生效 |
| CHG-018 | L2/L3 | 统一 WSL2 AI 运行时（Q-007 Done；DEBT-014 代码路径 Done） | `agent:gemini` / cursor | Done | 装二进制后满血 |
| DEBT-013 | L2 | GEX 开盘任务夏/冬令时（DST）自动对齐加固 | `agent:gemini` | Done | `open_session_run.py` 美东自适应对齐，Task 锚定最早唤醒，单测全绿 |
| CHG-020 | L2/L4 | 漏重启发现信号与探针闭环（Q-002 Done） | `agent:gemini` | Done | `/health` 暴露 `process.gitCommit`，`gcp_health_bundle` 自动计算 `restart_drift` |
| CHG-021 | L2/L3 | 跨项目 GPU 独占调度协议契约与 GpuArbiter 融合落地（Whop × OpenMontage 互斥；v1 HTTP 契约、自动恢复 14B） | `agent:gemini` | Done | `server.js` · `tools/gpu-arbiter.js` · 单测全绿 |
| CHG-022 | L2/L3 | 闭环 CHG-021 门禁项（`monitor.js` 接入 Arbiter、共存决策、卸 14B 显式 keep 1.5B、GAME CLI 联动、暴露 `restore_pending`） | `agent:gemini` | Done | `monitor.js` · `tools/gpu-arbiter.js` · `scripts/lms_load.js` · 33 项单测全绿 |
| CHG-023 | L2/L3 | WSL AI 切流锁定（Win:8080独占指向WSL llama-server；默认 backend=wsl；废 8081；方案 §7） | `agent:cursor` | Done | `tools/wsl-ai-cutover.js` · `tools/wsl-localhost-bridge.js` · 单测全绿 |
| CHG-024 | L2/L3 | GPU 控制面加固（`:18080` 可达、禁假成功、Wan 拒载、ROCm release 延迟；协议 v0.1.3） | `agent:cursor` | Done | Gemini 抽审通过 |
| CHG-025 | L2/L3 | 协议 v0.1.4 对齐（status 契约、GAME 无 retry_after、INVALID_PAYLOAD） | `agent:cursor` | Done | `gpu-arbiter.js` · `server.js` |
| REQ-038 | L3 | 战法卡归因（CHG-030 增量；n_scored=6） | 双Agent协同 | Doing | 见 §0.X Partial |
| REQ-039 | L0/L3 | 知识/GPU 产物到达规划 SoR（表级 promote，禁整库覆盖） | `agent:cursor` | Done | Gemini Accepted · CHG-027 |
| REQ-040 | L3 | T2 扩样（增量消费 T1） | `agent:cursor` | Doing | 已吃首张 TSLL VL level |
| CHG-026 | L0 | 运行环境合同（compute vs SoR） | `agent:cursor` | Done | `environments.md` |
| CHG-027 | L4/L0 | Local-Ops knowledge.promote HITL C2 | `agent:cursor` | Done | Gemini Accepted |
| CHG-028 | L3 | T2 方向/点位消歧 | `agent:cursor` | Done | n_scored=5 |

状态枚举：`Todo` | `Doing` | `Blocked` | `Review` | `Done`

---

## 2. 子 Checklist（仅复杂项）

### REQ-039 知识 promote（CHG-026）

- [x] 合同 [`environments.md`](./environments.md) + `env_inventory.js`
- [x] `knowledge_promote.js` 表级 dump / apply；禁 `messages`；无 `--allow-prod-write` 拒绝
- [x] 单测 `test_knowledge_promote_req039.js`
- [x] 本机 `--dump` + `--remote --apply --allow-prod-write`：gcp `ontology_card=4032`；`messages` 仅 ingest 自然增长（109159），promote 未改
- [x] `--media` tar-scp：本机缺图已上；gcp files=568；prod-only 127 未删
- [x] 蒸馏非 dry-run 且非测试 `dbInstance` 后 **自动 `--dump`**（仍不自动 `--allow-prod-write`）
- [x] `env_inventory.js --remote`：scp 探针到仓内 `data/runtime/` 再 node（避开 Win ssh `-e` 与 `/tmp` ESM 解析）
- [x] 二次 promote：gcp `message_vision_meta=73`（跳过 100.5/120 fixture）；与本机对齐
- [x] 接 `catalog.yaml` C2 `knowledge.promote.apply`（CHG-027；企微禁 promote）

### REQ-038-T2 TSLA/TSLL 子集归因

- [x] 冻结口径 [`req038-t2-attribution-spec.md`](./req038-t2-attribution-spec.md)
- [x] `card_attribution.js` + 单测（fixture，不打网）
- [x] CLI `npm run knowledge:attr-tsla`（`--dry-run` / `--persist`；`card_attribution_cli.js`）
- [x] 主库 Yahoo：gcp 知识表空 → `candidates=0`（与 Gemini 回告同根因）
- [x] 本机点位子集：222 候选 → 源消息抽价后 **with_level=18**（含 NVDL 串味）
- [x] 标的须正文独立词 + 点位/入场 ∈[0.4,2.5] 后门：**candidates=15**
- [x] VL 点位：标的须匹配；拒 100.5/120 fixture；`schema_json` 可抽价
- [x] 口径修正：`with_level` / `yahoo_eligible` 分计
- [x] **CHG-028**：结论行消歧 → n_scored=5
- [x] **CHG-030**：收 VL `level` 卡 → **n_scored=6 / hit_5d=1**（TSLL 多模态）；已 `--persist` + promote（gcp `ontology_card=4155` / `message_vision_meta=158`）
- [ ] REQ-040：继续增量吃新 TSLA/TSLL SR（§0.X Partial）

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

- cursor：**已增量开工**（CHG-029/030）：收 VL `level` → n_scored=6 hit5=1；promote gcp vision_meta=158。T2/040=Doing。请 gemini 优先产出带 SR 的 TSLA/TSLL ok 行。
- gemini：033 仍等 Human #91；T1 继续跑——**不必等全量**，有 TSLA SR 即促 cursor 再消费。
- gemini1：**REQ-036** Standing。
- Human：REQ-002 Done；Q-001；企微 #91；Q-006 云端离线批已决。
