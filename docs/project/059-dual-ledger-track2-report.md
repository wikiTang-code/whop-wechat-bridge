# REQ-059: Track 2 双账本最小集（风格 S × 期望 R-precursor）

> **状态**：`done-eng`（脚手架 + 夹具离线路径）· **`done-strat` 未过** · **不是** copytrade · **不是** 自主 alpha  
> **合同**：[`09-development-plan-contract-20260921.md`](./09-development-plan-contract-20260921.md) §8  
> **CHG-050 兄弟**：[`057-turning-point-microstructure-report.md`](./057-turning-point-microstructure-report.md) §6 = **负对照**（禁止当调参起点）  
> **横幅**：`REFERENCE_ONLY` / `hint_only` / `not_copytrade` / `not_done_strat`

---

## 0. 横幅（先读）

本刀只交 **轨 2 脚手架**。Cloud / CI **没有** `whop_archive.db` 时只跑夹具。全量 60d 必须在**本机或 GCP** 跑，把 summary **粘回本节**；禁止在无库环境编造 N / PF。

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

产出：`style_ledger_s.jsonl` · `expectancy_ledger_r.jsonl` · `summary.json`。

### 2.2 本机 / GCP（有 `whop_archive.db`）

```bash
node scripts/knowledge/backtest_dual_ledger_track2.js \
  --db whop_archive.db --lookback-days 60 --bar 5m \
  --symbols IREN,SOXL,MU,CRWV,COHR \
  --out-dir data/runs/dual_ledger_track2
```

只读 archive；`t_msg` = `messages.created_at`（JOIN）。缺库或缺 `created_at` → 非零退出，禁止静默 L2a。

**粘贴区（G2 · 人工/本机跑完后填）**：

```
archive run: NOT RUN IN CLOUD
n_zhao / n_triggers / S.tp30 / S.fp30 / S.fn30 / S.perm_p30 / R.exitA_IS / R.exitA_OOS / R.exitB_IS / R.exitB_OOS
= (paste here)
```

---

## 3. 夹具路径核验（Cloud 已跑）

夹具是合成 60 个 ET 会话、量能脉冲预埋，**不是**实盘样本。用于证明：口播价不入场、因果截断、双账不合并、硬锁说话人、±2h 禁窗、缺库 fail-closed。

数值见当次 `data/runs/dual_ledger_track2/summary.json`（gitignore）。单测不把夹具 PF 当战略门禁。

---

## 4. Strategic Gap Audit

**North Star（立项）**：搞清「像不像赵哥」与「规则自己有没有期望」是两件事；给参考轨一个可复现的冻结骨架。

**当前与实战差距**：

- 全量 archive 未在 Cloud 跑（G2 未过）。
- 冻结规则是预注册脚手架，**未经**实盘 60d 证实，禁止当 alpha。
- 未接 Paper FILLED / 观测 `t_arrive` 执行账（轨 3）。
- 未改 HUD / 20/40 / 雷达加权。

**暗伤**：Yahoo 5m 60d 覆盖随标的而变；1m 更短；风格置换未保时段结构（与 CHG-050 同样限制）。

**A/B/C 下一步（Human 拍板）**：

- A：本机/GCP 跑 §2.2，粘摘要，停在 REFERENCE_ONLY。
- B：否决某条 `T2R-*`（冻改，另开 CHG，禁止绿表改参）。
- C：不进轨 4。禁止 HUD / place_order。

**话术**：本交付是 `done-eng`。禁止「复现赵哥」「AI 扫单」「工业级 walk-forward」「已可实盘指导」。
