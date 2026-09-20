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
| REQ-002 | P0 | L4 | `done` | 生产 gcp-vm ff 对齐 + 双进程 restart | Human 2026-09-19 确认已 `pm2 restart`；ff=`e2733cf` 波次 · 判据 REQ-019 |
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
| REQ-036 | P1 | L3 | `active` | **大V交易语义专有轻量 AI (SLM) 微调方案与数据飞轮**（长期常驻主线：V1闭环已就绪；自迭代飞轮引擎落地 `flywheel_engine.js`，增量水位自动感知编排，单测全绿） | 常驻维护 · `scripts/slm/*` · `models/zhao_slm_1.5b_lora` · `test_slm_flywheel_req036.js` |
| REQ-037 | P2 | L3 | `done` | **大V全频道多模态图文对齐与交易知识本体图谱**（P1–P3 Done：批蒸馏全库扫描 + 防游标 `ontology_distill_scanned` + Layer4 只读检索；默认 `--sender xiaozhaolucky` 过滤大V，提炼 1995 张大V纯正卡片并将 `sender_name` 沉淀入 `schema_json`；支持 `--all-senders`；**P4 企微盘中参谋仍冻结** `REJ-008`） | 双Agent协同 · `knowledge:distill` · `ontology_query_engine` · 单测全绿 |
| REQ-038 | P1 | L3 | `done` | **战法卡归因与黄金提纯**：扩展至 12 核心标的池，修复候选富集，真实回测 166 张（n_scored=147，5D胜率57.1%），门禁提纯固化 108 张黄金战法 Playbook | 2026-09-20 `agent:gemini1` · `card_attribution*` · `data/runtime/golden_playbook.json` · 单测全绿 |
| REQ-039 | P1 | L0/L3 | `done` | **知识/GPU 产物自动到达规划 SoR**。Gemini §0.R-B **Accepted**。蒸馏 auto-dump；C2 `knowledge.promote.apply` HITL（CHG-027） | `knowledge_promote.js` · 禁 wecom |
| REQ-040 | P2 | L3 | `done` | **T2 扩样本与黄金提纯收官**：修复 source_text 预富集，全库扫描赵哥卡片，归因样本从 7 跃升至 147，门禁提纯 108 张并固化 Playbook，单测 contract 绿灯 | 2026-09-20 `agent:gemini1` · `test/test_golden_playbook.js` · 闭环 |
| REQ-041 | P1 | L3 | `done` | **盘口微观大单与四维共振检测引擎（Tape & Block Order Confluence Detector）**：融合 GEX 做市商引力场 + 赵哥多模态预判 + 457笔第一人称真实单佐证 + 尾盘微观大单通吃；**支持正股（Underlying）分析与 2x/多倍做多杠杆 ETF（TSLL, NEBX, LITX, COHX, CONL, TQQQ, SPYU, SNXX, MUU 等）关键点位动态折算**；单测 `test_tape_confluence_detector_req041.js` 100分王炸共振全绿通过 | 纯只读参谋 · `tools/knowledge/tape_confluence_detector.js` · 禁接 L2a / 禁下单 |
| REQ-042 | P1 | L3/L5 | `done` | **真实券商行情/K线数据空间印证引擎与长桥/富途双通道实测就绪**：落实「量化容不得半点马虎，一切用数据说话」人令；富途 OpenD 127.0.0.1:11111 美股期权全链 (24到期日/单日384合约) + L2 五档盘口 100% 跑通；长桥模拟仓凭证入库 `.env`，解码核验为 `lb_papertrading_20525807`（100% 守牢资金隔离红线），TradeContext/QuoteContext 双通；落地空间印证引擎 `real_market_confluence_verifier.js` 与单测全绿 | `brokers/longbridge.js` · `tools/knowledge/real_market_confluence_verifier.js` · 单测绿灯 |
| REQ-043 | P1 | L3/L5 | `done` | **自动驾驶感知总线 (Live Sensor Hub) 与四维共振在线决策驱动器**：建立仿自动驾驶感知-融合-决策流水线；毫秒级拉取长桥模拟仓真实正股行情与五档买卖盘口深度（`depth`），融合富途做市商 Gamma 墙与大V纯正战法，驱动四维共振实时自动计算并输出 2x 杠杆做多 ETF 动态折算点位；单测 `test/test_live_tape_feed.js` 全绿通过 | `tools/knowledge/live_tape_feed.js` · `test/test_live_tape_feed.js` · 单测绿灯 |
| REQ-044 | P1 | L3/L5 | `done` | **美股交易时段感知哨兵守护进程与低功耗休市待机机制**：落实人令「默认不间断持续监测，除美股休市时间」；落地 `market_session.js` 精准识别 ET 时区工作日盘前、RTH 盘中、15:30 尾盘强平窗口与周末/夜间休市；守护进程 `live_radar_sentinel.js` 盘中 15~30 秒不间断巡检，休市自动待机防空耗，高共振自动写入 `confluence_radar_events`；单测全绿 | `market_session.js` · `live_radar_sentinel.js` · `test/test_live_radar_sentinel.js` · 单测绿灯 |
| REQ-045 | P1 | L3/L5 | `done` | **美股微观结构与四维共振量化决策驾驶舱（含高胜率战法矩阵）与只读 API**：全面规范为金融量化专业命名；共振检测器全面挂载 gemini2 固化的 108 张黄金战法（`golden_playbook.json`）并实现优先加权（历史 3D/5D 胜率回测指标入显）；在 `scripts/web_runner.js` 暴露 `/api/radar/latest`、`/api/radar/events` 与 `/hud` 页面；打造极简暗黑金融微观决策座舱；单测 `test/test_radar_hud_api.js` 全绿 | `tools/knowledge/*` · `public/radar_hud.html` · `monitoring/readonly-api-router.js` · 单测全绿 |
| REQ-046 | P1 | L3/L4 | `done` | **盘中高置信度四维共振预警企微卡片推送（Confluence Radar Alert Pusher）**：当四维共振打分达到王炸/高共振（或命中黄金战法），自动向企微告警群/应用推送微观结构深度预警卡片；具备标的级防抖与防刷屏冷却窗口；100% 只读参谋，严禁下单指令与 L2a 接入 | `tools/knowledge/radar_alert_pusher.js` · 单测全绿 |
| REQ-047 | P1 | L3/L5 | `done` | **美股工作日全时段（夜盘/盘前/盘中/尾盘/盘后）全天候在线感知与 SPX/SPY/TradingView 极速多源指数引擎**：突破盘中限制，实现工作日全天候 24H 持续监控（含周日夜盘）；解决 SPX 夜盘/盘外停止更新痛点，实现 TradingView 直接极速直连、券商盘中直通与 SPY 动态等效折算（`SPX ≈ SPY * ratio`）三级阶梯；自动动态调频；单测 `test_spx_spy_converter.js` 与全仓 50 套单测全绿 | `market_session.js` · `index_equivalent_converter.js` · `live_tape_feed.js` · `live_radar_sentinel.js` · 单测全绿 |
| REQ-048 | P1 | L3/L5 | `done` | **赵哥科技七姐妹（M7）盘口广度与单边下跌战法探测器（M7 Breadth & Unilateral Downtrend Playbook Detector）**：落地真实大V战法（原单 `post_1CVX4DWL2PiXoXG51a4vES`）；开盘首小时 M7 普跌（跌数≥5）判定为单边下跌，早盘严禁接飞刀，推迟至尾盘三点到四点（15:00~16:00）强平再买/捡漏；单测 `test_m7_breadth_detector.js` 100% 绿灯 | `tools/knowledge/m7_breadth_detector.js` · `test/test_m7_breadth_detector.js` · 单测全绿 |
| REQ-049 | P1 | L3 | `done` | **战法本体无监督流形聚类与四态弱检验方案（049 A~D 全生命周期收工）**：吸纳 Grok 审阅意见，严格执行赵哥身份硬锁（1,850张）、物理分桶、无监督流形网格扫描（34稳定簇）、Fail-Closed 校验器拦截伪造点位、四态弱检验（1 supportive, 5 insufficient）、四层正交本体图谱重构，成果与 REQ-038 黄金战法并行隔离保存 | `docs/project/049*` · `scripts/knowledge/*` · 审阅全闭环 |
| REQ-050 | P1 | L3 | `done` | **战法本体事件驱动自适应窗口短周期微观复验引擎（REQ-049-C2 落地）**：落实 Grok 审阅裁决，突破日K粗筛失配瓶颈；以 $t_0$ 消息时间为锚点，自适应拉取短周期 $[t_0-30\text{m}, t_0+\text{Horizon}]$ 分钟/小时窗口，针对日内时钟敏感战法（10:30分批减、夜盘做T、散户止损大单吞噬、窄硬止损保护）计算微观 MFE/MAE 代理指标，继续执行四态弱检验 | `scripts/knowledge/backtest_adaptive_window_050.js` · `docs/project/050*` |
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
| CHG-018 | `done` | **统一 WSL2 AI 运行时**：Step 1–3 + **Q-007 Human 确认关 LMS 切流 OK**（2026-09-19）；残留代码债 DEBT-014（Supervisor sleep-mock→真实二进制，P2） | 2026-09-19 `agent:gemini` 落地 · `agent:cursor` 抽审/回写 |
| CHG-019 | `done` | **`saveTradeSignal` ON CONFLICT 补齐 `ticker`/`action`/`source`/`stop_loss`/`speaker_*` 等**（二次纠错改标的不残留旧字段；来自 07 REQ-035 抽审尾巴） | 2026-09-19 `agent:cursor` 落地 (`52f2ed9`) · `agent:gemini` 抽审通过 |
| CHG-020 | `done` | **/health 暴露 process.gitCommit + gcp_health_bundle 探测 restart_drift（闭环 Q-002 漏重启发现信号）** | 2026-09-19 `agent:gemini` · `monitoring/health.js` · `test_health_git_commit_q002.js` · 单测全绿 |
| CHG-021 | `done` | **跨项目 GPU 独占调度协议契约与 GpuArbiter 融合落地**（骨架：v1 HTTP 代理 Arbiter、TTL、release 异步恢复 14B）。**Cursor 2026-09-19 抽审 `accepted-with-gates`**：`monitor.js` 仍改写 `global.gpuLock`；acquire 未按 `vram_mb_estimate`/`exclusive` 探测共存；未显式 keep 1.5B；默认 adapter 仍 `lms` 且 `:18080` 可能不通。残留见 07 置顶。 | 2026-09-19 `agent:gemini` 骨架 · `agent:cursor` 冻结 §7 |
| CHG-022 | `done` | **闭环 CHG-021 门禁项**（`monitor.js` 接入统一 Arbiter 消除裂痕；`exclusive`/`vram_mb_estimate` ≤4GB 轻量共存决策；卸 14B 显式 keep 1.5B 快车道保活；GAME 模式一秒排空与 CLI 联动；暴露 `restore_pending` 与动态模型状态） | 2026-09-19 `agent:gemini` · `monitor.js` · `tools/gpu-arbiter.js` · `scripts/lms_load.js` · `test/test_gpu_cli_arbiter.js` · 33 项单测全绿 |
| CHG-023 | `done` | **WSL AI 切流锁定**：Windows `127.0.0.1:8080` 独占指向 WSL `llama-server`；默认 `AI_RUNTIME_BACKEND=wsl`；废 8081 bridge；开机 `cutover`→`ssh -R 8080`；方案 §7 拓扑权威 | 2026-09-19 `agent:cursor` 落地 · `agent:gemini` 抽审通过 · `tools/wsl-ai-cutover.js` · `tools/wsl-localhost-bridge.js` · 单测全绿 |
| CHG-024 | `done` | **GPU 控制面加固（gemini1 审视落地）**：协议 **v0.1.3** §4.3；`WslLlamaAdapter` 解析 WSL IP 达 `:18080`；cutover 同步桥 `:18080`；独占 unload 失败回滚（禁假成功）；Wan14/`vram>16GB` 服务端拒载；release 后延迟恢复防 ROCm 贴脸 | 2026-09-19 `agent:cursor` · Gemini 抽审通过 · 34 项单测全绿 |
| CHG-025 | `done` | **协议 v0.1.4 Whop 对齐**：status `mode`/`locked`/`free_vram_mb`；`GAME_MODE` 去掉 `retry_after`；缺 owner → `INVALID_PAYLOAD`（HTTP 200）；acquire 透传 `model` | 2026-09-19 `agent:cursor` · `gpu-arbiter.js` · `server.js` · 单测全绿 |
| CHG-026 | `done` | **运行环境合同**：每种处理冻结 compute vs SoR（gcp-vm / win-host / wsl-gpu / cloud-vl）；LoRA SoR=WSL 不是缺口；知识表 SoR=gcp | 2026-09-19 `agent:cursor` · [`environments.md`](./environments.md) · `environments.json` |
| CHG-027 | `done` | **Local-Ops catalog HITL C2 `knowledge.promote.apply`**（plan=C0 dump=C1；apply 须 human-approve；禁企微 `/ops promote`；win-host dump+scp，ssh recipe 故意 fail-closed） | 2026-09-19 `agent:cursor` · `catalog.yaml` · `adapters/knowledge.js` · `test_knowledge_promote_adapter_chg027.js` |
| CHG-028 | `done` | **T2 方向/点位消歧**：结论行优先；拒概率%；异标的近邻价丢弃；TSLA 带 [50,900] | 2026-09-19 `agent:cursor` · `card_attribution.js` · 口径页 · dry-run n_scored=5 |
| CHG-029 | `done` | **流水线解耦与增量消费原则（Top 级流水原则）**：批量长任务与下游消费严禁完全等待；有阶段性有效产出即刻开启下游图文关联/点位对齐/归因雷达；依赖 `status='ok'` 状态机与游标防漏 | 2026-09-19 人令确立 · 写入 `AGENTS.md` §3 · `06-process.md` |
| CHG-030 | `done` | **T2 增量收 VL `level` 卡**：`ATTR_CARD_TYPES`+`level`；V型反弹方向启发式；首张 TSLL VL scored hit_5d | 2026-09-19 `agent:cursor` · n_scored=6 · gcp vision_meta=158 |
| CHG-031 | `done` | **T2 VL gaps 清单**：`listT2VisionGaps` + CLI `--gaps` → `req038-t2-vl-gaps.json`；对齐器增量+promote | 2026-09-19 `agent:cursor` · missing_sr=6 · gcp ont=4176 / vision≈185 |
| CHG-033 | `done` | **T2 赵哥 sender 硬锁**：`sourceSender.sender_id===user_4yeplXgbguTu4`；`--gaps` 增 ontology non_zhao/oob；消化 CHG-032 gates | 2026-09-19 `agent:cursor` · n_scored=4 · 剔周哥/群友 |
| CHG-034 | `done` | **多模态流式对齐器硬锁真赵哥发言与带内 SR 纯化**：SQL 强过滤 `m.sender_id = 'user_4yeplXgbguTu4'`，彻底剥离群友与周哥发图；`filterInBandSR` 过滤非标的与期权价噪点；单测 `test_multimodal_context_aligner_chg029.js` 绿灯通过；闭环 Cursor CHG-033 要求 | 2026-09-19 `agent:gemini` · `multimodal_context_aligner.js` · 单测全绿 |
| CHG-035 | `done` | **Cursor 接管 T1**：aligner 脏卡 DELETE；`--reprocess-empty-sr` 重提赵哥空 SR；VL prompt 强制读 Y 轴；证实多数 TSLA「图」为聊天截图 | 2026-09-19 `agent:cursor` · `batch_vision*` · `multimodal_context_aligner.js` |
| CHG-036 | `done` | **T2 扩标的**：ATTR_TICKERS+=SOXL/IREN/NBIS/QQQ/SPY/NVDA；分标的价带；persist **n_scored=7** | 2026-09-19 `agent:cursor` · `card_attribution*` · 口径页 |
| CHG-037 | `done` | **T2 扩标池全量回测与 Golden Playbook 固化**：扩展 TSLA/TSLL/SPY/QQQ/NVDA/IREN/NBIS/CRWV/LITE/COHR/MU 等 12 标的；修复 `enrichedCards` 候选集丢失赵哥卡片根因；全量回测 n_scored=147；门禁提纯固化 `data/runtime/golden_playbook.json` (108张)；新增 `test/test_golden_playbook.js` 契约单测 | 2026-09-20 `agent:gemini1` · `card_attribution*` · `package.json` |
| CHG-038 | `done` | **消费 gemini2 固化的 Golden Playbook 产物，四维共振雷达与 Web 驾驶舱全面融合高胜率战法矩阵**：命名规范化为「美股微观结构与四维共振量化决策驾驶舱」，暴露 `/api/radar/latest`、`/api/radar/events` 与 `/hud`；通过全套回归单测与 API 单测 | 2026-09-20 `agent:gemini` · `tools/knowledge/*` · `public/radar_hud.html` · 单测全绿 |
| CHG-039 | `done` | **生产 VM Golden Playbook 自动部署通道 + 维度4期权大单扫盘特征库扩充 + bf8d14b 交叉抽审**：`knowledge_promote.js` 扩展支持 `--golden` 部署 `golden_playbook.json` 至生产 VM `data/runtime/`；`tape_confluence_detector.js` 扩充 `TAPE_BLOCK_PATTERNS` 期权跨所扫盘与巨额大宗识别模型；完成主干 `bf8d14b` 交叉抽审并在 07 回写意见 | 2026-09-20 `agent:gemini1` · `knowledge_promote*` · `tape_confluence_detector*` |
| CHG-040 | `done` | **美股工作日全时段在线感知 + 盘中首尾两小时 15s 高频捡漏扫盘 + SPX 跨时段动态换算与 TradingView 极速直连闭环**：`market_session.js` 扩展 OVERNIGHT_TRADING 与周日夜盘覆盖；实现盘中首尾两黄金战法时区（开盘 09:30-10:30 回踩捡漏 + 尾盘 15:00-16:00 机构强平扫单）15 秒极速高频巡检；落地 `index_equivalent_converter.js` 实现 TradingView 极速直连（<500ms）/ 券商盘中 / SPY 动态比率折算三级高精阶梯；`collect_futu.py` 防崩溃兜底；单测 `test_spx_spy_converter.js` 与 `test_live_radar_sentinel.js` 验证，全仓 50 套单测 100% 绿灯 | 2026-09-20 `agent:gemini` · `market_session.js` · `index_equivalent_converter.js` · `live_tape_feed.js` · `live_radar_sentinel.js` · `tape_confluence_detector.js` · `package.json` |
| CHG-041 | `done` | **开盘回踩与尾盘强平时段扫盘频率跃升至 5 秒超高频 + 接入 M7 科技七姐妹单边下跌战法模式**：响应人令「15s 是不是太低频了？可以 5s 吗？」「开盘一个小时七姐妹基本都跌的话当天走单边下跌模式，收盘再买」；首尾两小时调优为 5 秒超高频轮询；落地 `m7_breadth_detector.js` 探测七姐妹广度，与四维共振决策器和企微卡片深度联动；单测全绿 | 2026-09-20 `agent:gemini` · `market_session.js` · `live_radar_sentinel.js` · `m7_breadth_detector.js` · `live_tape_feed.js` · `tape_confluence_detector.js` · `radar_alert_pusher.js` |
| CHG-042 | `done` | **数据资产结构缺陷补全落地（DEBT-017 ~ DEBT-020 阶段性清账）**：扩评标的池（新增 AMD/PLTR/SMCI/MSTR/CONL/DRAM 等）并强化空头抽取，n_scored 达 173，提纯 118 张战法成功同步生产（空头占比 23.7% 突破门禁）；落地 `tape_block_events` 表与大单持久化归档引擎（单测全绿）；研发 `historical_signals_lifecycle_analyzer.js` 摸清 8,379 条专属发言，沉淀 172 对闭环交易配对账本与 484 笔孤立平仓底账 | 2026-09-20 `agent:gemini1` · `tools/trade/*` · `tools/knowledge/*` · `test/*` |
| CHG-043 | `done` | **数据资产结构缺陷 DEBT-017 与 DEBT-019 全面清账落地**：落地 `sync_paired_trades_to_signals.js`，将 172 对（344 笔）真实开平仓闭环交易单标准化落库至 `trade_signals`（总信号达 801 笔，单测 `test:trade-lifecycle` 全绿）；落地 `long_article_distill.js`，针对 2025 年早期长文复盘完成细颗粒度重蒸馏，沉淀 172 张深层策略与心法卡片至 `ontology_card`（总卡片数达 4,328 张，单测 `test:long-article-distill` 全绿） | 2026-09-20 `agent:gemini1` · `tools/trade/*` · `tools/knowledge/*` · `test/*` |
| CHG-044 | `done` | **黄金战法库与归因回测达标闭环（DEBT-018 全盘清账）**：拓标至 Top 30（含 NVDL/AAPL/AMZN/META/GOOGL/INTC/RDDT 等），引入 `direction_only` 方向信号评测模式，修复 `cardTickers` 结构化 tickers_json 漏读缺陷；`n_scored` 突破至 **767 张**（门禁 ≥600），战法池固化 **485 张**（门禁 ≥250，含 level 与 direction 细分），空头占比 **36.1%**（门禁 ≥20%），大V硬锁 0 泄露，成功同步推产至 GCP VM，单测 `test:golden-playbook` 全绿 | 2026-09-20 `agent:gemini1` · `tools/knowledge/card_attribution*` · `data/runtime/golden_playbook.json` |
| CHG-045 | `done` | **早期长文本深层重蒸馏与交易信号闭环达标（DEBT-017 & DEBT-019 全盘清账）**：`long_article_distill.js` 扩展 7 大模式，扫描 830 篇长文（覆盖率 100%），提纯 **657 张**深层策略/心法卡片入库（总卡片 4,816 张，门禁 ≥300），生成 **1,314 组** SLM 问答对（门禁 ≥500）；`sync_paired_trades_to_signals.js` 扩充期权暗语与别名映射，闭环配对 **713 对**交易单（配对率 **84.0%**，门禁 ≥70%），落库后 `trade_signals` 达 **1,925 笔**（门禁 ≥1,500）；全套测试 100% 绿灯 | 2026-09-20 `agent:gemini1` · `tools/knowledge/long_article_distill.js` · `tools/trade/*` · `test/*` |
| CHG-046 | `done` | **消化 Grok 审阅意见，实施黄金战法 tier 分级物理门禁与抽检验真闭环**：落实外部审阅意见，杜绝粗细战法混淆与虚假共振；`card_attribution.js` 导出结构显式标注 `tier: 'golden_level'` (175张带点位高精战法) 与 `tier: 'golden_direction'` (310张宏观多空方向战法)；四维共振雷达 `tape_confluence_detector.js` 设物理门禁，仅 `golden_level` 享受 D2 顶格加权（25分），`golden_direction` 降档为方向情绪参考（最高 15 分，绝不顶格）；带 tier 的 `golden_playbook.json` 重新推产至 GCP VM；抽检验真产出 `sample_audit_report.json`（DEBT-017 配对 8 组、DEBT-018 战法 20 张抽检，时序/标的/大V硬锁 100% 达标）；单测全绿 | 2026-09-20 `agent:gemini1` · `tools/knowledge/*` · `data/runtime/*` · `test/*` |


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
