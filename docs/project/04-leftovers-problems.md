# 04 — 遗留 · 开放问题 · 风险 · 技术债

> 上级：[`README.md`](./README.md) · 未立项记本页；成熟后 **Promote → [`03-requirements.md`](./03-requirements.md)**

**快照**：2026-09-20（数据资产结构问题与不足全盘建档 DEBT-017 ~ DEBT-020）

---

## 1. 硬规则（已拍板，同步 [`06`](./06-process.md)）

### 1.1 `data/gex` Git 策略（`REQ-024` + Q-003 已决）

| 路径 | Git |
|------|-----|
| `data/gex/latest.json` | **允许入库，但仅里程碑式提交**（见下） |
| `data/gex/*.html` | **严禁提交** |
| `data/gex/snapshot_*.json` 等大快照 | **严禁提交** |

**里程碑式 `latest.json`（严禁盘中例行 commit）**

- 日常/开盘/定时拉链：结果留**本地盘**；上云看板走 SCP/同步配方（REQ-004），**不要**每次 `git commit`。  
- **仅当**以下之一才允许 commit 一次 `latest.json`：基准打桩更新、版本发版验证、重大结构/schema 变动。  
- 提交前必须 `git status`；禁止 `git commit -a` 夹带 HTML/大文件。  
- **2026-09-21 里程碑（CHG-057/058）**：九标的矩阵首次拉链 `generated_at=2026-09-21T21:56:07` 入库；赵哥同日点位见 `chg057-*`。HTML 仍禁提交。

---

## 2. 遗留（滚动）

| 债 ID | 摘要 | 关联 | 严重度 |
|-------|------|------|:------:|
| DEBT-001 | 生产 gcp-vm ff 对齐 | REQ-002 | **Done**（Human 2026-09-19 确认 pull + pm2 restart） |
| DEBT-014 | **CHG-018/023 Supervisor+切流**：CPU `llama-server` + Win bridge 已满血可用；HIP 编译仍缺完整 ROCm | CHG-018/023 | **P3 残留**（HIP） |
| DEBT-015 | **知识资产只在本机、未进生产库**（见 §2.2） | REQ-039 表级 promote **Done**（gcp `ontology_card=4032` / `message_vision_meta=73`，`messages=109159` 仅 ingest 增长） | **Done** |
| DEBT-017 | **历史交易信号底池标准化回放与生命周期断链**（713对真实开平仓闭环落库，`trade_signals` 达 1,925 笔，配对率 84.0%，经抽检时序与标的一致性 100% 达标，单测 `test:trade-lifecycle` 全绿） | `tools/trade/*` · `trade_lifecycle_summary.json` · `sample_audit_report.json` | **Done** |
| DEBT-018 | **黄金战法库标的覆盖与多空时域分布失衡**（拓标Top 30并支持方向信号；`n_scored` 达 767 张，提纯 485 张战法分级管理：175张 `golden_level` 独占雷达顶格加权、310张 `golden_direction` 隔离为宏观参考，空头占比 36.1%，经抽检点位真实性 100% 达标，单测 `test:golden-playbook` 全绿，详见 §2.3.2） | `card_attribution*` · `golden_playbook.json` · `sample_audit_report.json` | **Done** |
| DEBT-019 | **早期历史长文本发言细颗粒度重蒸馏盲区**（扫描 830 篇长文，提纯 657 张深层策略/心法卡片入库，生成 1,314 组 SLM 微调问答对，单测 `test:long-article-distill` 全绿） | `tools/knowledge/long_article_distill.js` · `slm_qa_pairs.json` | **Done** |
| DEBT-020 | **微观盘口大单流高频持久化缺口与海外低延迟迁移**（`tape_block_events` 表与持久化引擎落地，单测全绿；海外低延迟部署待实施，详见 §2.3.4） | `tape_confluence_detector.js` · `tape_block_events` | **P2 结构就绪 (Partial)** |
| DEBT-021 | **交易单人工审核未完工与利润重算联动债**（当前企微人工审核进行中；**严禁将未完工利润视作绝对定论**；已通过 `REQ-054` 落地 `audit_linked_pnl_pipeline.js` 联动流水线，实现人工纠偏权威优先覆盖、动态 FIFO 配对与胜率重算，并自动沉淀 90 组 SLM 微调问答对，单测 `test:audit-linked-pnl` 全绿） | `tools/trade/audit_linked_pnl_pipeline.js` · `054-audit-linked-pnl-report.md` | **Done (REQ-054)** |
| DEBT-022 | **CHG-050 残留笔记（不挡收口）**：每标的单独冻参=多重选择；置换未保时段结构；cooldown=12 未按周期折算；历史文件名仍含 walk_forward；§4 检出率≠§6 precision；单测不证明 OOS 表。Grok 明确不要用滚动多折救期望（REJ-011） | `exploratory_is_oos.js` · 057 §6.3 | **P3 笔记** |
| DEBT-023 | **REQ-058 假设到达时钟（不挡 done-eng）**：历史仍无观测 `t_arrive`（Appendix A = `t_arrive_hat` / `message_clock` 5m N=196 主校准；校准门禁 passed，`done-strat` 未过）。Appendix B = 1m resolution diagnostic（`n_scored=33`，Yahoo 约 7 个会话；不是 196 笔 1m 全样本；禁止与 5m 的 196 笔逐格当「同一批更精细」）。CHG-052 仅给**新** ingest 打观测 `t_arrive`（#16=`e54ffd70`），禁止回填历史。禁止把 C-rate / bar open 当成交秒或 alpha；禁止用 Appendix A/B 改 20/40 / HUD | `backtest_delayed_follow_e_v0.js` · 058 Appendix A/B · `observed_arrival.js` | **P3 笔记** |
| DEBT-024 | **REQ-059 轨 2 G2 已粘（负对照；不挡 done-eng）**：GCP 主跑 `n_events=27` ≠ E-layer N=196。S 30m prec≤~1%、perm p~0.5–1；R OOS PF≤~1；独立期望门未过。**轨 3 封**。禁止绿表改 `T2R-*`；禁止合并 S/R 头条；**非 done-strat** | `059-dual-ledger-track2-report.md` §2.3 · 09 合同 | **P3 笔记（G2 闭环为负对照）** |
| DEBT-025 | **CHG-056 1s hot 未上 GCP live**（不挡 Cloud done-eng）：采集器+夹具在 #21/`969a175`；CHG-056b 只补 dotenv + subscribe isFirstPush fallback。当前 hot IREN/SOXL 为夹具行，**尚无非夹具 live bar**。采集进程不接 rclone、`cold_path=null`。合并后由 **Gemini 部署**。空秒不写行；禁止 1m/5m 插值 1s | `collect_1s_ohlcv.js` · `chg056-market-1s-ohlcv.md` | **P2 部署** |
| DEBT-026 | **RTH 赵哥点位**：2026-09-24 回填 9/21 开盘 6 笔（两频道各一行，共 12，`source=zhao_print`，`px_arrive` 空，`t_arrive=poll_seen`）。卖出 Intent 因无底仓拒绝；买入 NBIS/CRWV/IREN=`PENDING_HITL`，不是 `zhao_follow`、未 submit。今日新口播仍 0。刀 2 仍要 `zhao_follow`∧FILLED | CHG-060 · `zhao_print_persist.js` | **P1 回填过，实时落表未证** |
| DEBT-LLM-L2 | **禁止 LLM / L2a 文本 / 战法卡进入 OHLCV 检测器**（方法债；不是「AI 扫单」项目）。解冻须独立 REQ | 09 合同 §5 | **冻** |


### 2.2 本机 vs git vs 生产（2026-09-19 Cursor 盘点）

**禁止**把本机 ~294MB `whop_archive.db` 整文件盖掉生产 ~950MB 库（生产 `messages` 109159 > 本机 90456）。

| 资产 | 本机 | git | gcp-vm | 处置 |
|------|-----:|-----|--------|------|
| `ontology_card` | **4032** | 不入库（`*.db` ignore） | **4032**（REQ-039 表级 promote） | 日常蒸馏后 auto-dump，HITL apply |
| `ontology_distill_scanned` | 3154 | 不入库 | **3154** | 同上 |
| `message_vision_meta` | 73 | 不入库 | **73** | VL 仍写本机，跑完 promote（跳过 100.5/120 fixture） |
| `semantic_cu` | 0 | — | 0 | 两边都空 |
| `strategy_assets` | 5 | 不入库 | 0 | 随跟单资产，勿覆盖生产消息 |
| `zhao_positions` | 27 | 不入库 | 0 | 本机账本切片，生产以 ingest 为准 |
| `trade_signals` | 457 | 不入库 | 91 | 生产回放进度不同，禁止覆盖 |
| `messages` | 90456 | 不入库 | **109159（ingest 自然增长）** | **生产为准** |
| `data/media/zhao` | **441** | 近月 untracked | **568**（本机缺图已上；prod-only 127 保留） | SoR=gcp；不 git add |
| `models/zhao_slm_1.5b_lora/*.safetensors` | **17MB** 权重 | **gitignore**（只跟踪 tokenizer/config） | **无权重**（仅 config） | **符合 CHG-026**：SoR=wsl-gpu，不上 gcp |
| `data/gex/latest.json` | 有 | 里程碑可提交 | 有（SCP） | 维持 REQ-024，禁盘中 commit |
| REQ-038-T2 实跑 | candidates=16 / n_scored=6 / hit_5d=1（CHG-030 收 VL level） | 口径在 git | promote 后 gcp vision_meta=158 | **增量进行中**；继续吃 TSLA SR |

**T2 结论**：已按 CHG-029 增量开工。首张多模态 TSLL `level` 卡 **hit_5d=true**。§0.X REQ-040=**Partial**。

合同见 [`environments.md`](./environments.md)。**自动流**（REQ-039）：知识表/媒体走 promote·rsync；禁止整库覆盖；禁止无门禁「同步 1995 张卡」。盘点：`npm run env:inventory`。

### 2.3 数据资产结构问题与不足全盘建档（DEBT-017 ~ DEBT-020 详述）

> **建立目的**：为后续增量补全、回放清洗与流水分批推进立下确凿底账。全面摸清数据资产底数、结构性断点与系统性影响，杜绝「凭感觉补数」，严格依循状态机与门禁指标分阶段消除技术债。

#### 2.3.1 DEBT-017：历史交易信号底池标准化回放与生命周期断链

- **资产现状与底数**：
  - **专属交易频道严格物理限定**（AGENTS.md §6 规则 10）：仅采「历史股票期权记录区」(`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`) 与「不用翻墙期权」(`chat_feed_1CTrCEx44dP13jW3RVkYiS`) 两大频道，累计历史原始消息达 **8,382 条**；
  - **待审与排队底池**：历史交易审核候选池 `trade_review_pool` 累计 **2,321 笔**，跟单回放队列 `follow_replay_queue` 累计 **830 笔**；
  - **标准化落库现状**：经严密规范化落库至 `trade_signals` 的仅 **457 笔**（生产 VM 历史环境仅存 **91 笔**）。
- **结构性缺陷与断点**：
  1. **开平仓生命周期断裂**：大量历史记录仅提取出「开仓建仓（BUY/OPEN）」，后续止盈平仓（SELL/CLOSE）、移动止损、分批止盈往往散落在后续非结构化讨论或口头补充中，导致约 **65%** 的交易信号处于「无平仓状态」；
  2. **期权关键合约要素缺失**：早期 SPY/QQQ 末日期权与中小盘期权单，部分缺乏规范化的到期日（Expiration `YYYY-MM-DD`）与行权价（Strike Price），影响期权 Delta 与内在价值的准确重放；
  3. **非核心标的覆盖稀疏**：历史单聚焦于 SPY, QQQ, TSLA, NVDA，近期赵哥重点交易的云光存（IREN, NBIS, CRWV, COHR, LITE, MU）等交易单回放未完全覆盖，导致维度 3（真实交割单）在此类标的上命中率偏低。
- **系统影响**：
  - 维度 3（真实交割单微观印证）在二线标的与小盘异动股上产生严重的数据稀疏（Coverage Sparsity），打分时无法有效激发共振加权。
- **增量补全路径与门禁**：
  - **步骤 1**：编写 `tools/trade/historical_trade_replayer.js`，按两专属频道时间序列执行上下文增量回放；
  - **步骤 2**：引入启发式开平仓状态机匹配算法（同标的 + 期权到期日/行权价 + 时间窗口临近匹配），自动关联 `PARENT_SIGNAL_ID`；
  - **门禁指标**：`trade_signals` 标准化有效记录扩充至 ≥1,500 笔；两专属频道交易单抽取覆盖率 ≥85%；开平仓对齐闭环率提升至 ≥70%。

---

#### 2.3.2 DEBT-018：黄金战法库标的覆盖局限性与多空时域分布失衡

- **资产现状与底数**：
  - **全量本体卡片池**：`ontology_card` 全库共有 **4,218 张**已结构化卡片；
  - **归因评测样本**：当前仅对 12 个重点美股标的（TSLA, TSLL, SPY, QQQ, NVDA, IREN, NBIS, CRWV, LITE, COHR, MU, AMD）的 **147 张**候选卡片执行了 3D/5D 历史 K 线价格回测（`n_scored = 147`）；
  - **黄金战法当前产物**：经 3D胜率 ≥60% 且 5D胜率 ≥50% 的双重门禁提纯，固化出 **108 张**黄金战法（`golden_playbook.json`，93,639 字节），且已同步至生产 VM。
- **结构性缺陷与断点**：
  1. **全库覆盖率极低**：归因评测覆盖率仅 **3.48%**（147 / 4,218），全库超过 4,000 张包含精准支撑/阻力/形态预测的卡片尚未跑通回测打分，沉睡在数据库中；
  2. **严重多头偏向（Long-Biased）**：现有 108 张黄金战法中，**92.6%**（100/108）为多头做多支撑位（Support / Dip-Buy），空头阻力/做空破位战法不足 **7.4%**（8/108），在美股大盘单边杀跌、科技股深度回调时缺乏足够的黄金空头指引；
  3. **时间窗口粒度单一**：目前归因仅评测 3D 与 5D 窗口，缺失日内超短线（0DTE / 1D）以及波段中线（10D / 20D）的胜率标注；
  4. **杠杆 ETF 映射规则静态化**：除 TSLA→TSLL 外，其余小盘股对应杠杆 ETF（如 CRWV、NBIS、IREN 等）缺乏动态 Beta 调整与换算通道。
- **系统影响**：
  - 在空头行情或二线科技股触发共振时，维度 2（大V多模态与黄金战法优先加权）极易脱靶，退化为普通卡片检索，错失顶格 25 分的高置信度印证。
- **增量补全路径与门禁**：
  - **步骤 1**：扩展 `card_attribution_cli.js` 标的池至 Top 30（新增 AAPL, AMZN, MSFT, META, GOOGL, PLTR, SMCI, MARA, RIOT 等）；
  - **步骤 2**：强化看跌阻力位、假突破反手做空、跳空缺口反抽战法的特征识别算法，提高空头样本权重；
  - **门禁指标与清账事实**：归因打分卡片 `n_scored` 扩充至 **767 张**（超额达成门禁 ≥600）；固化战法 **485 张**（空头占比 36.1%）；
  - **Grok 外部审阅整改闭环（CHG-046）**：
    1. **质量分级隔离**：杜绝战法粗细混淆，结构体显式标注 `tier: 'golden_level'`（175 张，含显式点位与归因胜率）与 `tier: 'golden_direction'`（310 张，宏观多空方向信号）；
    2. **四维雷达物理门禁**：`tape_confluence_detector.js` 严格硬锁：**仅 `golden_level` 享受 D2 顶格加权（25分）**；`golden_direction` 降档为纯方向情绪参考（最高 15 分，绝不顶格），严防虚假共振；
    3. **双重抽检验真**：落盘 `data/runtime/sample_audit_report.json`，完成 DEBT-017 配对 8 组（时序/标的/大V硬锁 100% 通过）与 DEBT-018 战法 20 张（点位/胜率 100% 真实）抽检；
    4. **六大收紧点钉死（ACCEPT WITH NOTES）**：① tier 为消费端加权准入权限而非绝对 Alpha；② 抽检定性为工程 Smoke 验收，非统计完备，建立持续抽样协议；③ ≤3% 空间偏差定义写死（基准成交价/中间价 vs 战法 level，杠杆 ETF 经 Beta 动态折算）；④ direction 维度硬锁封顶 15 分且防叠加；⑤ 推产严格受限 C2 HITL；⑥ REQ-049 保持 `proposed_pilot` 物理隔离。


---

#### 2.3.3 DEBT-019：早期历史长文本发言细颗粒度重蒸馏盲区

- **资产现状与底数**：
  - 生产主库历史消息总量达 **109,159 条**，其中包含赵哥自 2025 年 8 月以来的大量早盘定调、周末万字复盘与深度心法总结；
  - 现有本体卡片蒸馏主要覆盖 2026 年初以来的 **3,154 组**切窗单元（`ontology_distill_scanned`），早期消息处于粗提或未提状态。
- **结构性缺陷与断点**：
  1. **早期提取 Prompt 粗糙遗留**：2025 年底系统初建时，抽取 Prompt 偏向简单的关键词正则与短文本问答，遗漏了大量赵哥对于「宏观流动性推演」、「期权波动率 IV 研判」、「机构做市商洗盘手法」等深层策略逻辑；
  2. **机械固定切窗截断逻辑**：早期长文本按固定 1,000 Token 截断，割裂了逻辑完整的宏观复盘段落，导致生成的卡片往往断章取义、缺乏因果链（Cause-Effect）；
  3. **交易心法与风控铁律未结构化**：如赵哥反复强调的「仓位二分法」、「加仓不过三」、「不与趋势对抗」、「单日回撤熔断」等仓位风控理念，未被沉淀为可被量化雷达消费的规则约束。
- **系统影响**：
  - SLM 数据飞轮（REQ-036）在 LoRA 微调时缺乏深层次的长因果思维语料（Long CoT），生成回答偏向碎片化点位报数，缺乏大V特有的宏观波段大局观。
- **增量补全路径与门禁**：
  - **步骤 1**：研发长文本语义分段与长上下文重蒸馏工具（`tools/knowledge/long_article_distill.js`）；
  - **步骤 2**：按 2025-08 ~ 2025-12 时间范围对历史长文本实施增量蒸馏，严格遵循大V硬锁（`sender_id = 'user_4yeplXgbguTu4'`）；
  - **门禁指标**：历史长文本扫描覆盖率 100%；沉淀高质量深层策略与风控规则卡片 ≥300 张；SLM 训练集扩充优质问答对 ≥500 组。

---

#### 2.3.4 DEBT-020：微观盘口大单流高频持久化缺口与海外低延迟迁移

- **资产现状与底数**：
  - **特征识别引擎已就绪**：`tape_confluence_detector.js` 已成功构建 7 类机构期权大单与盘口行为模型（`TAPE_BLOCK_PATTERNS`：扫盘、大宗、尾盘挤压、恐慌承接、量比失衡等）；
  - **数据依赖现状**：目前微观盘口数据主要依赖长桥 OpenAPI、富途 OpenD 实时内存流或仿真回放。
- **结构性缺陷与断点**：
  1. **高频 Tick 级时序持久化缺失**：当前盘口大单事件（Tape Events）大多在内存中实时打分后即丢弃，缺少专用的 SQLite/时序表对逐笔成交（≥$100K）与跨所扫盘做本地持久化存储，导致无法离线回测验证各种扫盘形态的短线胜率；
  2. **物理网络长延迟与抖动**：长桥/富途行情 API 在国内网络环境下调用，平均延迟在 150ms ~ 350ms，且盘中偶发网络抖动；在开盘（09:30 ET）与尾盘强平（15:45 ET）等极端行情的 0DTE 期权扫盘中容易丢包或产生时间戳滞后；
  3. **缺少大单与行情联动对齐**：大宗成交（Block Trade）发生瞬间与底层正股 Bid/Ask 盘口深度缺乏微秒级精准对齐，难以判定其为「被动承接」还是「激进主动吃单」。
- **系统影响**：
  - 维度 4（微观盘口超级大单）无法形成闭环的离线胜率归因账本；国内单机运行哨兵进程面临网络不稳定风险。
- **增量补全路径与门禁**：
  - **数据层**：新建高频大单日志表 `tape_block_events`（字段包含 `event_time, ticker, event_type, price, size, premium, sentiment, pattern, raw_json`），每日盘后自动归档；
  - **架构层**：推进长桥 OpenAPI 盘口监听与聚合服务迁移至海外 GCP VM（实现 <30ms 极速直连美股行情机房）；富途 OpenD 继续保持盘前快照 SCP 同步安全隔离；
  - **门禁指标**：日均持久化高频机构大单 ≥5,000 笔；海外 GCP 节点盘口采集延迟稳定控制在 <50ms；断网重连与幂等去重率 100%。

---

### 2.4 已闭环（勿再当开放债）

| 债 ID | 关闭说明 |
|-------|----------|
| DEBT-001 旧义「未 push」 | REQ-001 Done；`origin/main` 已含 local-ops+docs |
| DEBT-002 | REQ-003 Done；本机 Task `WhopGexOpenSession0940ET` Ready；DST 残留见 DEBT-013 |
| DEBT-003 | REQ-004/022 Done；SCP 脚本 + 安全专节；Q-001 interim=SCP |
| DEBT-004 | REQ-005/006/008 Done |
| DEBT-005 | REQ-015/016/017 Done；runbooks 已入库 |
| DEBT-006 | CHG-005 Done；方案已作废「企微点 C2」 |
| DEBT-007 | REQ-018 Done；见 `wecom-freeze.md` |
| DEBT-008 | REQ-020 Done；gateway 审计 + `runbooks/c2-audit-loop.md` |
| DEBT-009 | REQ-021 Done |
| DEBT-010 | REQ-023 Done；见 06 §3 |
| DEBT-011 | REQ-027～029 Done；031/032 亦 Done |
| DEBT-012 | REQ-031/032 Done |
| DEBT-013 | open_session_run.py 美东时区感知 (America/New_York) 与自适应等待闭环；install_open_session_task.ps1 锚定夏令时最早本地唤醒 (21:38)，免疫每年 DST 切换，单测全部 PASS |

---

## 3. 开放问题

| Q | 问题 | 决策人 | 状态 |
|---|------|--------|------|
| Q-001 | GEX→GCP：SCP / 制品 / 其它？ | human | **interim 已决：SCP**（`sync_latest_to_gcp.js`）；制品通道可再改 |
| Q-002 | 漏重启用何信号发现？ | human+L4 | **Done**（`CHG-020`：`/health` 暴露 `process.gitCommit`，`gcp_health_bundle` 自动计算 `restart_drift` 与 `drift_detail`） |
| Q-003 | 每次拉链是否 commit `latest.json`？ | — | **已决：否；仅里程碑**（§1.1） |
| Q-004 | P5 是否加 CI `place_order` grep？ | L5 | decided：单测+load-catalog 硬拒；catalog 文本禁 place_order |
| Q-005 | 跟单确认通道：企微业务卡片 vs Dashboard 移动页？ | human | **已决：企微业务确认卡片**（盘中 90s 时效；≠ `/ops`） |
| Q-006 | REQ-037 视觉模型：本地 VL vs 云端多模态？ | human | **已决：云端轻量 VL 离线批**（不占本地 14B/OM 显存时分；字段白名单 `ticker/timeframe/levels/pattern_notes`；禁进 L2a actions；磁盘 files=441 / uniq_sha=421 / >15KB=432） |
| Q-007 | CHG-018 门禁达标后是否关闭 Windows LM Studio 切到 WSL llama-server？ | human | **Done**（2026-09-19 Human 确认已关 LMS、切流试用无问题；cursor 本机见 `:8080/v1/models` 仍可列模型） |
| Q-008 | REQ-038-T1 云端 VL 实跑密钥 | human | **Done**（已配置纯 Free Tier 密钥；实测首张真实 K 线图抽取成功：标的 SPY、形态双底、支撑 675.98/阻力 682.44、手绘双红箭头精准识别；纯免费额度，0 扣费） |

---

## 4. 风险

| 风险 | 缓解 | 状态 |
|------|------|------|
| 家宽 IP→60020 | GCP 借道推送 | 已缓解 |
| 企微失陷→C0 侦察 | 白名单 + REQ-018 | 残留 |
| Agent 纸面 HITL | REJ-007 + REQ-015/020 + CHG-006 | **已缓解**（runbook+清单） |
| 多 Agent 改总控撞车 | 05/07 拆分 + REQ-023 | 部分缓解 |
| GEX HTML / 盘中 json 刷爆历史 | REQ-024 + 里程碑策略 | 已拍板 |
| 赵哥仓/跟单仓数据缠绕 + 无盘中确认 | REQ-027～032 | **已缓解** |
| GEX 开盘任务 DST 漂移 | open_session_run.py 美东对齐 + install_open_session_task.ps1 锚定最早唤醒 · DEBT-013 | **已缓解**（DEBT-013 Done） |
