# CHG-056 — 长桥 **成交** 进程内聚合成 1s OHLCV（hot jsonl）

> 账本：[`03-requirements.md`](./03-requirements.md) · 看板 [`05-wip-board.md`](./05-wip-board.md) · 清单说明 [`../../data/manifest/README.md`](../../data/manifest/README.md)  
> Grok 验收钉死：OHLC **只来自 trades**；Quote 只可心跳；空秒不写行。  
> Cloud 只交采集器 + 夹具单测。**合并后 GCP 部署 = Gemini**。

## Before → After

| | Before | After |
|--|--------|--------|
| 1s 来源 | 无；`Period` 最小 `Min_1`；禁止 Yahoo 1m 插成 1s | `ctx.trades` / `subscribe(Trade)` 进程内切秒；**不用 quote mid** |
| 空秒 | — | **不写行**（无 volume=0 假K、不复制前收） |
| 清单 | — | `source=longbridge_trade_agg`，`cold_path=null` |
| rclone | — | **采集进程不调用**；hot 有文件后由操作员自行 copy |

## 事实约束

- 禁止 `subscribeCandlesticks` / `candlesticks(..., 1s)` / `Period.Second`。
- 同秒多笔成交 → 一根 OHLCV；日文件 `YYYY-MM-DD.jsonl`（ET）。
- 标的锁 5 个：`IREN,SOXL,MU,CRWV,COHR`。
- 真实行情 gitignore：`data/market/`。夹具：`test/fixtures/market_1s/`。
- 采集器不接 rclone。hot 有文件之后，操作员才可：`rclone copy data/market/hot/{SYM}/1s/YYYY-MM-DD.jsonl gdrive:whop-market/YYYY/MM/{SYM}/1s/`（不提交 `rclone.conf`）。

## CHG-056b — live 订阅补丁（跟进 #21 / `969a175`）

Paste-verified GCP dirty diff **only**。不自造 NAPI 行为。不改 `scripts/market/lib/ohlcv_1s.js`（GCP 上 clean）/ `brokers/longbridge.js`（GCP 另有无关 i64 dirty，本 PR 范围外）。

| | Before (#21) | After (CHG-056b) |
|--|--------|--------|
| `.env` | live 进程不读 cwd `.env` | `dotenv.config()`（cwd/repo root；**.env 不入库**） |
| subscribe | `ctx.subscribe(symbols, types)` 两参 | 先 `subscribe(symbols, types, true)`（Longbridge NAPI 第三参 **isFirstPush**，GCP live probe）；失败回退两参 |

**分离口径（强制）**

1. Fixture 验收已在 **#21**，本补丁不把夹具复称为 live。
2. 本变更 = live 订阅补丁 only（dotenv + subscribe 第三参 fallback）。
3. 当前 hot **IREN/SOXL 行是夹具**；尚无非夹具 live bar。无 alpha / 不复现赵哥。

## 复现（无 live 凭证）

```bash
npm run test:market-1s
node scripts/market/collect_1s_ohlcv.js --dry-run --symbols IREN,SOXL,MU,CRWV,COHR --out-root data/market/hot
node scripts/market/collect_1s_ohlcv.js --once --fixture test/fixtures/market_1s/ticks.jsonl --out-root data/market/hot
```

## Strategic Gap Audit

- **North Star**：GCP 对 5 标的按成交写入真实 1s。
- **当前**：`done-eng`（#21 夹具切秒 / 同秒合并 / 空秒不写 / 禁 1m·5m 插值；CHG-056b dotenv + isFirstPush subscribe fallback）。**无非夹具 live bar**；hot IREN/SOXL 仍是夹具。
- **暗伤**：无成交的秒就是缺行；断线不回填；Cloud 无 Longbridge 凭证，本补丁不证明 live 推送。
- **下一步**：A 合并后 Gemini 挂采集并核验非夹具 jsonl；B hot 有真实文件后再谈冷拷贝；C 1s 不是发令枪。
