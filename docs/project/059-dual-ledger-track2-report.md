# REQ-059: Track 2 双账本最小集（风格 S × 期望 R-precursor）

> **状态**：`done-eng`（脚手架 + GCP G2 摘要已粘）· **负对照**（CHG-050 兄弟）· **`done-strat` 未过** · **轨 3 未开** · **不是** copytrade · **不是** 自主 alpha  
> **合同**：[`09-development-plan-contract-20260921.md`](./09-development-plan-contract-20260921.md) §8  
> **CHG-050 兄弟**：[`057-turning-point-microstructure-report.md`](./057-turning-point-microstructure-report.md) §6 = **负对照**（禁止当调参起点）  
> **横幅**：`REFERENCE_ONLY` / `hint_only` / `not_copytrade` / `not_done_strat`  
> **Grok 拍板 A（2026-09-21）**：GCP 主跑摘要粘回；停在 `REFERENCE_ONLY` / `hint_only`。`T2R-*` **未改**。禁止绿表改参。禁止开轨 3 叙事。

---

## 0. 横幅（先读）

本刀交 **轨 2 脚手架 + GCP G2 摘要**。Cloud / CI **没有** `whop_archive.db` 时只跑夹具。全量 60d 已在 **GCP** 跑完，summary 粘在 **§2.3**；禁止在无库环境编造 N / PF。**GCP 生产 archive 是主跑；本机 deep-extract 是另一张表/另一本账，禁止混池。** (GCP production archive is the primary run; local deep-extract is a separate table/ledger and must not be pooled.)

两本账**禁止**合成一个 PF 头条：

| 账本 | 问什么 | 不问什么 |
|------|--------|----------|
| **S 风格** | 规则触发后赵哥是否在 5/15/30min 开口（TP/FP/FN + 置换） | 这笔赚不赚 |
| **R 期望前体** | 次根开、10bp、ExitA=12 根 vs ExitB=回撤；日历 40/20 | 赵哥开没开口 |

口播 `px_zhao` **永不**作为 `entry_px`。±2h 风格窗禁止。

---

## 1. 冻结规则 id（预注册 · 禁止为绿表改）

| rule_id | side | volume 进 if | 谓词（冻结） |
|---------|------|:------------:|--------------|
| `T2R-VOL_EXPANSION_UP` | BUY | 是 | close>open AND close>prev.close AND **volume > 1.5×volEMA[i-1]** |
| `T2R-VOL_EXPANSION_DOWN` | SELL | 是 | close<open AND close<prev.close AND **volume > 1.5×volEMA[i-1]** |
| `T2R-RANGE_BREAK_VOL` | BUY | 是 | close>max(high[-12:-1]) AND **volume > 1.2×volEMA[i-1]** |
| `T2R-ATR_SHOCK_VOL` | BOTH | 是 | (high-low)>1.5×ATR[i-1] AND **volume > 1.2×volEMA[i-1]**；方向由阴阳线 |

其他冻结：cooldown=12 根；往返 10bp；HoldA=12 根；HoldB 回撤 = 1.0×ATR 止损否则时间停；日历前 40 / 后 20 个 ET 交易日；说话人 `user_4yeplXgbguTu4`；频道两专属。

---

## 2. 复现命令

### 2.1 CI / Cloud / 无 archive（夹具）

```bash
node --test test/test_dual_ledger_track2_req059.js
npm run test:dual-ledger-track2

node scripts/knowledge/backtest_dual_ledger_track2.js \
  --events test/fixtures/dual_ledger_track2/events.jsonl \
  --bars-dir test/fixtures/dual_ledger_track2/bars \
  --no-fetch --lookback-days all \
  --symbols IREN,SOXL,MU,CRWV,COHR \
  --out-dir data/runs/dual_ledger_track2
```

产出：`style_ledger_s.jsonl` · `expectancy_ledger_r.jsonl` · `summary.json`（必含 `db_path` / `n_messages` / `n_events` / `events_source`）。缺库非零退出，禁止静默空成功。

### 2.2 本机 / GCP（有 `whop_archive.db`）

```bash
node scripts/knowledge/backtest_dual_ledger_track2.js \
  --db whop_archive.db --lookback-days 60 --bar 5m \
  --symbols IREN,SOXL,MU,CRWV,COHR \
  --out-dir data/runs/dual_ledger_track2
```

只读 archive；`t_msg` = `messages.created_at`（JOIN）。缺库或缺 `created_at` → 非零退出，禁止静默 L2a。

**粘贴区（G2）**：见下方 **§2.3**（已粘；Cloud 仍无 archive，不在 Cloud 重跑）。

### 2.3 GCP 主跑摘要（G2 · 2026-09-21 · Grok 拍板 A）

> **横幅**：`REFERENCE_ONLY` / `hint_only`。本段只记 provenance 与用户口述读法。**禁止**编造未给出的逐格数字。**禁止**把 S 与 R 合成一个 PF 头条。

| 项 | 值 |
|----|----|
| Merge | PR #19 → `d902722` |
| `db_path` | `/home/wikitang628/whop-wechat-bridge/whop_archive.db` |
| `n_messages` | 109333 |
| `n_events` | 27 |
| `events_source` | `sqlite-ro#messages.created_at` |
| Banner | `REFERENCE_ONLY` / `hint_only` |
| 主跑 | GCP 生产 archive |
| 禁混池 | 本机 deep-extract **不**与本表混池 |

**契约对照（显式）**：`n_events=27` **≠** E-layer Appendix A `N=196`。两套合同不同：本跑是轨 2 双账本事件（JOIN `messages.created_at`）；196 是 REQ-058 延迟跟单 E-layer 主校准。禁止并读成「同一批更精细」。GCP prod 是主跑。

#### S 账本（风格 · 不问赚不赚）

用户口述（本回合未附分标的精确网格；**不编造** TP/FP/FN 逐格）：

| 口径 | 读法 |
|------|------|
| 30m precision | ≤~1% |
| permutation p-values | ~0.5–1 |
| 结论 | 风格匹配 **没有**高于随机 |

#### R 账本（期望前体 · 无视开口；禁止合成头条）

用户口述（分标的 ExitA / ExitB **OOS PF**；本回合未附精确逐格表，**不编造** IREN/SOXL/MU/CRWV/COHR 数值）：

| 口径 | 读法 |
|------|------|
| ExitA OOS PF（分标的） | **全部低于或约等于 1** |
| ExitB OOS PF（分标的） | **全部低于或约等于 1** |
| 独立期望门禁 | **未过** |

禁止把 S 的 precision 写成 R 的期望，禁止把 R 的 PF 写成「像赵哥」。禁止单一 `profitFactor` / `merged_pf` 头条。

#### 门禁关闭

- **轨 3 封**：独立期望门未过；失败按合同闭环。禁止为绿表改 `T2R-*`。禁止开轨 3 叙事。
- `T2R-VOL_EXPANSION_UP` / `DOWN` / `RANGE_BREAK_VOL` / `ATR_SHOCK_VOL` **未改**。
- 未改 HUD / 20/40 / Δ / `place_order` / 市场采集。
- **不是** `done-strat`。

---

## 3. 夹具路径核验（Cloud 已跑）

夹具是合成 60 个 ET 会话、量能脉冲预埋，**不是**实盘样本。用于证明：口播价不入场、因果截断、双账不合并、硬锁说话人、±2h 禁窗、缺库 fail-closed。

数值见当次 `data/runs/dual_ledger_track2/summary.json`（gitignore）。单测不把夹具 PF 当战略门禁。

---

## 4. Strategic Gap Audit

**North Star（立项）**：搞清「像不像赵哥」与「规则自己有没有期望」是两件事；给参考轨一个可复现的冻结骨架。

**当前与实战差距**：

- G2 已在 GCP 粘摘要：`n_events=27`；S 30m precision ≤~1%、置换 p ~0.5–1 → 风格不高于随机；R OOS PF 全部低于或约等于 1 → **独立期望门未过**。这是 **负对照**，不是 alpha。
- `n_events=27` ≠ E-layer `N=196`（不同合同）。禁止混池本机 deep-extract。
- 冻结 `T2R-*` **未改**、**未经**正期望证实，禁止当发令枪。
- **轨 3 未开**（观测到达 + Paper FILLED 执行账仍未授权）。
- 未改 HUD / 20/40 / 雷达加权。

**暗伤**：Yahoo 5m 60d 覆盖随标的而变；1m 更短；风格置换未保时段结构（与 CHG-050 同样限制）。本回合未附分标的精确 PF 网格，报告只记用户口述上下界，避免编造。

**A/B/C 下一步（Human 拍板）**：

- **A（已执行）**：GCP 跑 §2.2，粘摘要，停在 `REFERENCE_ONLY` / `hint_only`。
- B：否决某条 `T2R-*`（冻改，另开 CHG，禁止绿表改参）。**本刀未做 B。**
- C：不进轨 4。禁止 HUD / `place_order`。**轨 3 封。**

**话术**：本交付是 `done-eng` + **负对照**。禁止「复现赵哥」「AI 扫单」「工业级 walk-forward」「已可实盘指导」。Grok 拍板 A：停。
