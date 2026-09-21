# 09 — 开发规划合同（2026-09-21）

> **状态**：`accepted`（规划合同；本刀只切轨 2 脚手架）· **不是** `done-strat`  
> **基准 HEAD**：`e1656af`（CHG-054 ingest 落库观测 `t_arrive` · `#18`）  
> **账本**：[`03-requirements.md`](./03-requirements.md) `CHG-055` / `REQ-059` · 看板 [`05-wip-board.md`](./05-wip-board.md)  
> **姊妹合同**：[`dual-track-operating-contract.md`](./dual-track-operating-contract.md)（CHG-051）· [`058-delayed-follow-e-v0-report.md`](./058-delayed-follow-e-v0-report.md) · [`057-turning-point-microstructure-report.md`](./057-turning-point-microstructure-report.md) §6（CHG-050 负对照）  
> **本页不是总进度**。禁止把本文件写成「复现赵哥 / AI 扫单 / 工业级 walk-forward」交付单。

---

## 0. 背景（现在站在哪）

仓库已有三层能力面（业务守护 / Local-Ops / 企微窄面）和三角色运行合同（CHG-051）：

| 角色 | 事实 | 不是 |
|------|------|------|
| 跟单轨 | 赵哥开口才动；专属频道 + `speaker_id` 硬锁 | 预告、口播价成交 |
| 周哥 QQQ 模拟仓 | 持续播、可回测、`hint_only` | 赵哥实盘、`trade_signals` |
| 自研参考轨 | 只许 OHLCV / 波动 / 量能；默认 `REFERENCE_ONLY` | 发令枪、`AUTO_SUBMIT`、`place_order` |

近端事实（截至 `e1656af`）：

- **REQ-058** E-layer v0：`t_arrive_hat = t_msg + Δ`。主校准 Appendix A / 5m N=196；Appendix B 是 1m 诊断。**`done-strat` 未过**。禁止再用本表改 20/40 / HUD。
- **CHG-052 / CHG-054**：新 ingest 写观测 `t_arrive`（first-see）；禁口播 / K 线回填；历史不回填。
- **CHG-050**：exploratory IS/OOS holdout。Grok 拍板 B：**负对照**。禁止称 Walk-Forward / 工业级 / alpha。禁止滚动多折救期望（`REJ-011`）。
- 赵哥单是**成交后广播**。`px_zhao` 是他的成交锚点（监督标签），**不是**我方入场价。

Cloud Agent 环境通常**没有** `whop_archive.db`。本机 / GCP 才有只读 archive。规划必须把「云上能交什么」和「带库机能跑什么」切开，禁止云上假装全量回测已完成。

---

## 1. 缺口（Gaps · 写死，勿用叙事填）

1. **没有可上柜自主 alpha。** CHG-050 不能当发令枪；黄金战法卡是 HITL 说明书，不是开仓公式。
2. **风格像不像赵哥 ≠ 规则有没有期望。** 混成一个 PF 标题会重演 CHG-050。必须两本独立账。
3. **历史仍无观测到达时钟。** E-layer 的 `t_arrive_hat` 不是 `t_arrive`。禁止用 bar high/low 反推成交秒。
4. **口播价泄漏。** 任何把 `px_zhao` 写成 entry / `px_arrive` 的路径都是红线（`REJ-012`）。
5. **文本 / LLM 特征进检测器。** 大V正文、ontology 卡、L2a `session_anchor` 不是 OHLCV 规则输入（见 DEBT-LLM-L2）。
6. **Cloud 无 archive。** 缺库时只许夹具；全量 60d 必须在本机或 GCP 跑完再把摘要粘回报告。
7. **跟单执行链未到 FILLED 真源闭环。** Paper 夜盘仍等时钟。回测不证明柜台。

---

## 2. 目标 / 非目标

### 2.1 目标（Goals）

| ID | 目标 | 成功样子 |
|----|------|----------|
| G-S | 风格账 S | 预注册冻结 OHLCV 规则触发后，赵哥是否在 5/15/30min 开口；TP/FP/FN + 时间戳置换；禁止 ±2h 当命中窗 |
| G-R | 期望账 R-precursor | 次根开入场、10bp 成本；固定 12 根 vs 回撤出场**分列**；日历 holdout 前 40 / 后 20 交易日；**无视赵哥是否开口** |
| G-C | 因果 | 规则只用 `t_msg` **之前**已收盘的 OHLCV；口播价永不入场 |
| G-D | 双账不合并 | 两份 event-level jsonl；摘要禁止一个 PF 头条 |
| G-K | 云上合同 | Cloud 交付脚本 + 夹具 + 报告骨架；全量 archive 跑在本机/GCP |

### 2.2 非目标（Non-goals · 本刀与后续未授权前）

- **复现赵哥**、跟单可复制、口播价成交
- **AI 扫单**、把 LLM / 战法卡写入检测器 if
- **工业级 Walk-Forward**、滚动多折、对绿表重调参
- 改 20/40、HUD 自动、`place_order`、`AUTO_SUBMIT`、雷达自动加权
- 新的 Δ 扫描（REQ-058 Δ 集冻结）
- 把 S 的 precision 当 R 的期望，或把 R 的 PF 当「像赵哥」
- 宣称 `done-strat` / 可实盘指导

---

## 3. 冻结清单（Freezes）

| 冻结项 | 状态 | 解冻条件 |
|--------|------|----------|
| `place_order` / catalog 下单 | 永冻 | 无 |
| HUD 自动上柜 / `AUTO_SUBMIT` | 冻 | 另立 CHG + Human |
| 跟单 20/40 bp | 冻 | 另立 CHG；**禁止**用 058/059 表改 |
| REQ-058 Δ ∈ {0,1,3,5} | 冻 | 禁止本刀再扫 Δ |
| CHG-050 参数网格 | 负对照冻 | 禁止同一网格刷正期望（`REJ-011`） |
| 赵哥 `speaker_id = user_4yeplXgbguTu4` | 硬锁 | 禁止 `LIKE '%赵%'` |
| 交易单频道 | 硬锁两专属频道 | 见 AGENTS.md §6.10 |
| 周哥模拟仓 | `hint_only`，不进 `trade_signals` | 见 CHG-051 |
| 大V文本 → 检测器特征 | 冻（DEBT-LLM-L2） | 另立 REQ |
| `latest.json` 盘中 commit / GEX HTML | 冻 | REQ-024 |
| 生产 C2 | HITL | 禁 Agent 代跑 `human-approve` |

票池（本刀）：近 60 天高频 **IREN, SOXL, MU, CRWV, COHR**。Interval 默认 5m。

---

## 4. 方法（Method · 预注册）

1. **事件时钟**：`t_msg` = `messages.created_at`（`message_clock`）。缺 archive / 缺 `created_at` → fail-closed。夹具路径显式 `--events` + `--bars-dir` + `--no-fetch`。
2. **说话人**：`speaker_id === user_4yeplXgbguTu4` 绝对等式。周哥 / 群友丢行。
3. **因果 K 线**：规则在 bar `i` 只读 `≤ i` 的已收盘 bar；相对赵哥事件，只保留 `bar.time + interval ≤ t_msg` 的 bar。
4. **量能必须进 if**：每条冻结规则的触发条件**字面包含** volume 比较。禁止「先价后量当注释」。
5. **规则预注册后冻结**：3–5 条 OHLCV 规则，id 写入报告。**禁止**为绿表改阈值。
6. **账本 S（风格）**：规则触发后看赵哥是否在 {5, 15, 30} min 开口。TP / FP / FN。时间戳置换（seeded）。**±2h 命中窗禁止**（CHG-050 宽窗反例）。
7. **账本 R（期望前体）**：次根 **open** 入场；往返 10bp；ExitA = 固定 12 根收盘；ExitB = 回撤出场；两列分报。日历切分：**前 40 / 后 20** 个 ET 交易日。**不读赵哥是否开口**。
8. **入场价**：永远不是 `px_zhao`。口播价只做标签。
9. **CHG-050 是负对照兄弟**：同日历切分家族，不是本刀调参起点。
10. **输出**：`style_ledger_s.jsonl` + `expectancy_ledger_r.jsonl` + 分列 summary。横幅 `REFERENCE_ONLY` / `hint_only`。

---

## 5. 轨道 0–5 + DEBT-LLM-L2

| 轨 | 名称 | 状态 | 本刀？ |
|----|------|:----:|:------:|
| **0** | 时钟卫生：观测 `t_arrive` ingest、禁口播回填 | `done-eng`（CHG-052/054）；历史仍无观测钟 | 否 |
| **1** | 延迟跟单 E-layer v0（假设到达） | `done-eng`（REQ-058）；`done-strat` 未过；Δ 冻 | 否 |
| **2** | 双账本：风格 S × 期望 R-precursor | **本刀**：脚手架 + 夹具离线路径 + 报告骨架 | **是** |
| **3** | 跟单执行账（观测到达 + Paper FILLED + A/B/C） | 未授权；等夜盘 FILLED；不改 20/40 | 否 |
| **4** | 参考轨升级门（仍 `REFERENCE_ONLY` / HITL） | 仅当 R 的 OOS 门禁日后另立 CHG | 否 |
| **5** | 周哥 QQQ 模拟仓隔离回放 | standing · `hint_only` | 否 |
| **DEBT-LLM-L2** | 禁止 LLM / L2a 文本 / 战法卡进入 OHLCV 检测器 | 冻；不是「AI 扫单」项目 | 否（记债） |

轨 2 细节见 [`059-dual-ledger-track2-report.md`](./059-dual-ledger-track2-report.md)。

**DEBT-LLM-L2（方法债，不是本刀实现）**：L2 工作台与 ontology / VL 卡继续只读 HITL。检测器输入集 = OHLCV（及由其衍生的均量 / ATR）。赵哥正文、周哥正文、LLM 标签、L2a `session_anchor` **不得**进入 if。解冻必须独立 REQ，且不得宣称 AI 扫单。

---

## 6. 阶段门（Stage gates）

| 门 | 内容 | 过门证据 |
|----|------|----------|
| **G0** | 本合同入库；03/05/README 镜像 | 本文件 + CHG-055 |
| **G1** | 轨 2 脚手架：lib + CLI + 夹具 + 单测绿灯 | REQ-059 `done-eng` |
| **G2** | 带 `whop_archive.db` 的 60d 全量跑（**本机或 GCP**） | 摘要粘回 059 报告；**Cloud 不声称 G2 已过** |
| **G3** | Human 读 S 与 R 两列，确认未合并头条 | 05 Ops / 07 |
| **G4** | 仍不进 HUD / 不改 20/40 / 不 `place_order` | 持续冻结 |

G1 ≠ G2。Cloud 过 G1 即可开 PR。G2 缺库则报告写「未跑；命令如下」。

---

## 7. 核验规则（Verification）

单测与报告必须能证明：

1. **口播价永不入场**：`entry_px` 来源是次根 open（扣成本），断言拒绝 `px_zhao` / `oral`。
2. **因果截断**：`t_msg` 当时未收盘的 bar 不进入该事件的规则 if。
3. **双账不合并**：summary 无顶层 `profitFactor` 头条；S 与 R 分键；测试失败若出现 `merged_pf` / `combined_profit_factor`。
4. **说话人硬锁**：`speaker_id` 等式；周哥行数为 0。
5. **量能在 if 内**：每条 `T2R-*` 的谓词源码含 `volume`。
6. **±2h 禁窗**：请求 120min 风格窗必须抛错。
7. **横幅**：`REFERENCE_ONLY`、`hint_only`、`not_copytrade`、`not_done_strat`、`chg050_sibling=negative_control`。
8. **无 archive**：`--no-fetch` + 夹具可跑；对缺失 db 的默认 archive 路径 fail-closed（除非 `--events`）。

---

## 8. 下一刀 = 只切轨 2

授权范围（仅此）：

- 落盘本合同（日期 **2026-09-21**，HEAD ≈ `e1656af`）。
- 实现轨 2 **最小集**：loader、3–5 条冻结规则、账本 S、账本 R-precursor、两份 jsonl、夹具、CLI、单测、059 报告骨架。

**Cloud 交付边界（强制写明）**：

- Cloud / CI **交付**脚本 + 夹具 + 报告骨架 + 复现命令。
- **全量 archive 回测发生在本机或 GCP**，读取只读 `whop_archive.db`（`message_clock` / `messages.created_at`）。
- 跑完后把 summary **粘回** [`059-dual-ledger-track2-report.md`](./059-dual-ledger-track2-report.md)，不要在无库环境编造 N 与 PF。
- 缺库时 CI 只跑夹具；文档给出本机/GCP 命令。

本刀不做：轨 3/4/5 实现、Δ 扫描、HUD、20/40、manage_pr 脚本、place_order、宣称复现赵哥 / AI 扫单 / 工业级 walk-forward。

复现（夹具 / CI）：

```bash
node --test test/test_dual_ledger_track2_req059.js
npm run test:dual-ledger-track2
node scripts/knowledge/backtest_dual_ledger_track2.js \
  --events test/fixtures/dual_ledger_track2/events.jsonl \
  --bars-dir test/fixtures/dual_ledger_track2/bars \
  --no-fetch --lookback-days all \
  --out-dir data/runs/dual_ledger_track2
```

全量（本机 / GCP · 有 `whop_archive.db`）：

```bash
node scripts/knowledge/backtest_dual_ledger_track2.js \
  --db whop_archive.db --lookback-days 60 --bar 5m \
  --symbols IREN,SOXL,MU,CRWV,COHR \
  --out-dir data/runs/dual_ledger_track2
```
