# REQ-058: 延迟跟单历史回测 v0（E-layer · 假设到达 Δ 扫）

> **状态**：`done-eng`（accepted-with-gap · Plan B fail-closed）· 研究专用 · **不是**自主 alpha · **不是**「赵哥本人那笔赚多少」  
> **关联**：CHG-051 跟单轨 Intent 字段；`follow_execution_spec.md` 滑点带；L2a 离线账本只读（仅显式反例）  
> **禁止**：接入 HUD / L2a 自动上柜 / `place_order` / `AUTO_SUBMIT`

---

## 0. 横幅（先读）

**近端 = 到达字段 + 真时钟校准**

历史账通常有 `t_msg` + `px_zhao`，**没有**观测到的 `t_arrive`。本回测第二时钟是**假设到达**：

`t_arrive_hat = t_msg + Δ`，Δ ∈ {0, 1, 3, 5} 分钟（轮询箱，不是从 K 线反推成交秒）。秒级 Δ **未实现**（`--delta-secs` 仅保留名）。

- `arrival_kind = hypothesized`。行内**没有** `t_arrive`、**没有** `t_fill`。
- `px_arrive` = 包含 `t_arrive_hat` 的那根 bar 的 **open**。禁止口播/`px_zhao` 冒充到达价。禁止「价在某根 K 线出现过」= 成交秒。
- `--t-msg-kind message_clock`（默认）：必须只读 archive + `messages.created_at`；缺一则 **fail-closed 非零退出**，**禁止**静默回退 L2a `session_anchor`。
- L2a `session_anchor` **仅** `--allow-session-anchor-counterexample`：只写 `summary_session_anchor_counterexample.json`（`not_for_strategy`）；该路径永不写 `summary_message_clock.json`。
- 5m coalesce：Δ=0/1/3 常落同一根 5m bar；Δ=5 才可能跨到下一根 open（箱边界，不是成交秒）。
- 时区：`America/New_York`。默认 Yahoo `includePrePost=false`（**不含盘前**；`--include-prepost` 才对齐盘前/盘后同一 unix 轴）。
- 1m：Yahoo 通常只有约 7 个会话；v0 默认 **5m / range=60d**。

---

## 1. 治理落点（与用户合同的路径冲突）

用户原文曾写 `scripts/research/` 或 `research/delayed-follow/`。本仓库：

| 决策 | 路径 | 依据 |
|------|------|------|
| 脚本 | `scripts/knowledge/backtest_delayed_follow_e_v0.js` | 既有 `backtest_*.js`（050/057/CHG-050）；`.gitignore` 只放行 `scripts/knowledge/`，**不**放行 `scripts/research/` |
| 纯函数 | `scripts/knowledge/lib/delayed_follow_e_v0.js` | 同目录 `exploratory_is_oos.js` |
| 报告 | `docs/project/058-delayed-follow-e-v0-report.md` | 049–057 编号报告惯例；**未**新建平行 `research/delayed-follow/`（梯子子树是另一类公式归档） |
| jsonl | `data/runs/delayed_follow_e_v0/` | L2a `data/runs/` 惯例；Yahoo `bars/` 与全量 `events.jsonl` gitignore |
| CI 夹具 | `test/fixtures/delayed_follow_e_v0/` + `test/test_delayed_follow_e_v0.js` | `node --test`，对齐 CHG-050 |
| 账本 | 优先只读 `trade_signals`（`getReadOnlyArchiveDb`）；本环境无 SQLite 则只读 L2a jsonl | `ASSET_USAGE`：1195/incr01 **只读**；`db-readonly.js` |

**语义合同（用户）优先于命名习惯**：CHG-051 / 01 的 live Intent 字段叫 `t_arrive`；历史没有观测到达，故本 v0 只写 `t_arrive_hat`。

其他冲突见 §6。

---

## 2. 复现命令

```bash
# CI / 无网：夹具（7 笔 BUY × 4 Δ = 28 行）→ summary_message_clock.json
node scripts/knowledge/backtest_delayed_follow_e_v0.js \
  --t-msg-kind message_clock --delta-mins 0,1,3,5 --bar 5m --symbols IREN,SOXL,MU,CRWV,COHR \
  --events test/fixtures/delayed_follow_e_v0/events.jsonl \
  --bars-dir test/fixtures/delayed_follow_e_v0/bars \
  --no-fetch --lookback-days all \
  --out-dir data/runs/delayed_follow_e_v0

npm run test:delayed-follow-e-v0
```

Windows（checkout 根目录已有 `whop_archive.db`；`message_clock` 硬路径，缺库或无 `messages.created_at` 则非零退出）：

```bat
node scripts/knowledge/backtest_delayed_follow_e_v0.js --t-msg-kind message_clock --db whop_archive.db --delta-mins 0,1,3,5 --bar 5m --symbols IREN,SOXL,MU,CRWV,COHR --lookback-days 60 --out-dir data/runs/delayed_follow_e_v0
```

可选反例（`not_for_strategy`；只写 `summary_session_anchor_counterexample.json`）：

```bash
node scripts/knowledge/backtest_delayed_follow_e_v0.js \
  --t-msg-kind session_anchor --allow-session-anchor-counterexample \
  --delta-mins 0,1,3,5 --bar 5m --symbols IREN,SOXL,MU,CRWV,COHR \
  --lookback-days 60 --out-dir data/runs/delayed_follow_e_v0
```

Archive 路径：`speaker_id = user_4yeplXgbguTu4` 硬锁（缺 id 丢行；禁止 `LIKE '%赵%'`）；`INNER JOIN messages` 取 `messages.created_at`。本 Cloud 环境无该库。

---

## 3. N events

### 3.1 夹具（可复现、CI）

| 标的 | N BUY |
|------|------:|
| IREN | 3 |
| SOXL | 1 |
| MU | 1（窗外 → `NO_BAR`） |
| CRWV | 1 |
| COHR | 1 |
| 拒收 | 周哥 speaker、非交易频道 各 1（不入库） |

### 3.2 L2a session_anchor 反例（`not_for_strategy`；2026-09-20）

仅 `--allow-session-anchor-counterexample`。只读 `l2a_broadcast_candidates_1195_cleaned.jsonl` + `l2a_cleaned_20260828_incr01.jsonl`，账本 `status=filled` BUY 过滤（**不是**柜台证明）。jsonl **无** `speaker_id`，按交易频道假定赵哥（缺口，见 §7）。**不可**当作 `message_clock` 结果。

| 标的 | N BUY（60d） |
|------|-------------:|
| IREN | 11 |
| SOXL | 6 |
| MU | 12 |
| CRWV | 11 |
| COHR | 5 |
| **合计** | **45**（原始 113，lookback 截断） |

Yahoo：`interval=5m range=60d includePrePost=false`，每标的 4681 根。时间戳 unix UTC，墙钟标签 `America/New_York`。

---

## 4. 每 Δ 表

A/B/C stub（`policy_status=provisional`，常量只在 `DELAYED_FOLLOW_POLICY`）：

- A：不利滑点 ≤ 20bp（或有利）→ reconnect-pull，成交价=`px_arrive`
- B：20bp < 不利 ≤ 40bp → limited-slip chase，成交价=`px_arrive`
- C：不利 > 40bp → abandon；`exit`/`costs` 为空
- `NO_BAR` **不计入** C-rate

滑点相对 `px_zhao`（口播锚），**不是** mid。出场 stub：到达 bar 后 12 根 close；成本 stub 10bp round-trip。二者与入场分列。

### 4.1 夹具

| Δ min | n_scored | A rate | C rate | mean slip bp | median slip bp | mean residual after costs bp |
|------:|---------:|-------:|-------:|-------------:|---------------:|-----------------------------:|
| 0 | 6 | 50% | 16.7% | 19.26 | 20 | 37.83 |
| 1 | 6 | 50% | 16.7% | 19.26 | 20 | 37.83 |
| 3 | 6 | 50% | 16.7% | 19.26 | 20 | 37.83 |
| 5 | 6 | 33.3% | 33.3% | 29.38 | 31.25 | 31.80 |

Δ=0/1/3 落在同一根 5m bar；Δ=5 跨到下一根 open（合同允许的箱边界，不是反推成交秒）。

### 4.2 L2a 60d 反例（描述性；`not_for_strategy`；**不可当跟单胜率**）

| Δ min | n_scored | n_A | n_C | n_no_bar | A rate | C rate | median slip bp | median residual (A/B) bp |
|------:|---------:|----:|----:|---------:|-------:|-------:|---------------:|-------------------------:|
| 0 | 38 | 3 | 33 | 7 | 7.9% | 86.8% | 512 | −43.5 |
| 1 | 38 | 3 | 33 | 7 | 7.9% | 86.8% | 512 | −43.5 |
| 3 | 38 | 3 | 33 | 7 | 7.9% | 86.8% | 512 | −43.5 |
| 5 | 38 | 6 | 32 | 7 | 15.8% | 84.2% | 458 | 140.5 |

Δ=0/1/3 数字相同：session_anchor 钉在 09:30 ET，三者同 bar。mean slip 被 MU 口播 8.18 vs 正股 ~840 的脏点拉爆（~1e6 bp）；**只报 median**。`NO_BAR`=盘前/盘后/夜盘锚 + RTH-only K 线。

这 **不是**「延迟跟单工业级 C 率」。这是「会话桶时钟 × 口播价 × 开盘 5m open」的描述性错配。

---

## 5. 行字段（每事件）

`symbol, side, t_msg, px_zhao, delta_min, t_arrive_hat, px_arrive, exec_policy∈{A,B,C,NO_BAR}, slip_bps, arrival_kind=hypothesized`  
另有 `exit` / `costs` 分列、`t_msg_kind`（`message_clock` | `session_anchor`）、`exec_px_kind=hypothesized_bar_open`。

---

## 6. 文档冲突清单（治理路径 vs 用户合同）

| 项 | 文档 | 用户合同 | 本 v0 |
|----|------|----------|--------|
| 脚本目录 | `scripts/knowledge/` | `scripts/research/` | **跟文档树** |
| 报告 | `docs/project/058-*` | `research/.../REPORT.md` 亦可 | **跟 049–057** |
| live 到达字段名 | 01 / CHG-051：`t_arrive` | 禁止假装观测 `t_arrive` | 历史写 `t_arrive_hat` |
| B 语义 | spec=`SIZE_DOWN` 减半 | CHG-051=限滑追 | **A/B/C 标签 + 追价满额 stub**；阈值 20/40bp 引自 spec |
| TTL | 90s live | Δ 分钟箱 | 分钟箱是假设轮询，**不是** 90s TTL |
| 期权频道 | CHANNEL_REGISTRY：默认不进 L2a | AGENTS 交易单允许两条频道 | 交易单过滤跟 **AGENTS**；缺 `channel_id` fail-closed |
| P0 / 柜台 | 跟单合同另册 | 本任务 E-layer 研究 | **不替代柜台验收**；近端 = 到达字段 + 真时钟校准 |
| 路径 | `.gitignore` 只放行 `scripts/knowledge/` | `scripts/research/` | 见 §1；未新建顶层目录 |

---

## 7. 战略目标与实战对账单（Strategic Gap Audit）

| 维度 | North Star | 当前 | 暗伤 | 提案 |
|------|------------|------|------|------|
| 到达时钟 | 观测 `t_arrive` + 真 `messages.created_at` | `t_arrive_hat`；`message_clock` 缺库 fail-closed；L2a 仅显式反例 | 本环境无 archive；5m coalesce 使 Δ=0/1/3 同 bar | **A** Windows 对 `whop_archive.db` 跑 message_clock；**B** 维持夹具；**C** 把 session 锚当 t_msg（拒绝） |
| 到达价 | 盘口 `px_arrive` | bar open，未用口播 | 5m open ≠ 可成交价 | 1m/券商 bar 另开 REQ；禁止 K 线 high/low 当 fill |
| A/B/C | 降 C / 改善 A | stub 20/40bp 未改；反例 C 率不可读 | 无 90s TTL / 无真 reconnect-pull | 阈值保持 provisional；**不要**把 C 率写进 HUD |
| 账本 | 赵哥硬锁 + 专属频道 | sqlite `speaker_id=?` + JOIN `messages.created_at`；缺 id 丢行 | L2a 反例仍无 speaker_id | 禁止 `LIKE '%赵%'`；观测 `t_arrive` ingest 另开；**DEBT-023** |
| 柜台 | 非本任务 | 本 PR 零接线 | 回测≠成交 | 近端 = 到达字段 + 真时钟校准；不把回测当柜台证明 |

**Human 拍板**：收 `done-eng`（Plan B fail-closed）；禁止宣称可实盘指导 / 自筹资 / alpha。未做：真 reconnect-pull / 90s TTL、改 20/40、HUD、观测 `t_arrive` ingest、上传 DB。

---

## 8. 非目标（已遵守）

未改 `public/radar_hud.html`、L2a pipeline、`catalog.yaml`、`place_order`。HITL 默认不动。未实现真 reconnect-pull / 90s TTL、未改 20/40、无观测 `t_arrive` ingest、不上传 DB。

---

## 9. 本回合治理读盘（路径）

`AGENTS.md` · `docs/project/BOOTSTRAP.md` · `README.md` · `01`/`02`/`03`/`04`/`05`/`06` · `dual-track-operating-contract.md` · `follow-hitl-plan.md` · `data/specs/follow_execution_spec.md` · `L2A_OFFLINE_PIPELINE.md` · `ASSET_USAGE_AND_NEXT_STEPS_20260830.md` · `CHANNEL_REGISTRY.md` · `STAGE3_execution_spec.md` · `056-paper-execution-engine-report.md`（索引名）· `057-turning-point-microstructure-report.md` · `research/ladder-chaodi/README.md` · 既有 `scripts/knowledge/backtest_*.js` / `train_recent_60d_microstructure.js` / `monitoring/db-readonly.js`。
