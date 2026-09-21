# CHG-056 — 长桥 quote/trade 进程内聚合成 1s OHLCV（hot jsonl）

> 账本：[`03-requirements.md`](./03-requirements.md) · 看板 [`05-wip-board.md`](./05-wip-board.md) · 清单说明 [`../../data/manifest/README.md`](../../data/manifest/README.md)  
> **不是** alpha，**不是** 复现赵哥，**不是** Paper FILLED，**不是** 20/40 / HUD / T2R。  
> Cloud 只交采集器 + 夹具单测。**合并后 GCP 部署 = Gemini**（本 PR 不 SSH、不 merge、不装 systemd、不声称存储已在跑）。

## Before → After

| | Before | After |
|--|--------|--------|
| 1s 来源 | 无；长桥 `Period` 最小 `Min_1`；禁止把 Yahoo 1m 插成 1s | 订阅 `Quote` + `Trade` 推送，进程内切秒聚合成 OHLCV |
| 落盘 | 无规范 hot 路径 | `data/market/hot/{SYM}/1s/YYYY-MM-DD.jsonl` |
| 清单 | 无 | `data/manifest/market_1s.jsonl`（`cold_path=null`） |
| 断线 | — | 重连；**不回填**空洞秒 |

## 事实约束

- 长桥 LV1 行情可用；**没有 1s K 线枚举**。禁止 `subscribeCandlesticks` / `candlesticks(..., 1s)`。
- 标的锁 5 个：`IREN,SOXL,MU,CRWV,COHR`（禁 80 标的池、禁十档 Depth）。
- 日文件日历日 = `America/New_York`。字段：`ts`（unix 秒）+ OHLCV + 可选 `n_trades` / `volume`。
- 真实行情 gitignore：`data/market/`。夹具可入库：`test/fixtures/market_1s/`。
- rclone **未安装**；仓内不提交 `rclone.conf`。冷归档只给复制命令，不跑：

```bash
rclone copy data/market/hot/IREN/1s/2026-09-21.jsonl gdrive:whop-market/2026/09/IREN/1s/
```

- hot 在 GCP 保留 60–90 天（合并后由 Gemini 部署与运营）。本脚本**不**写 systemd unit，**不**声称盘已在生产转。
- Paper 夜盘 FILLED 仍是独立车道（§0.H）。

## 复现（无 live 凭证）

```bash
npm run test:market-1s
node scripts/market/collect_1s_ohlcv.js --dry-run --symbols IREN,SOXL,MU,CRWV,COHR --out-root data/market/hot
node scripts/market/collect_1s_ohlcv.js --once --fixture test/fixtures/market_1s/ticks.jsonl --out-root data/market/hot
```

Live（仅有长桥密钥的机器；Cloud 默认不跑）：

```bash
node scripts/market/collect_1s_ohlcv.js --symbols IREN,SOXL,MU,CRWV,COHR --out-root data/market/hot
```

## Strategic Gap Audit

- **North Star**：GCP 上对 5 标的持续写入真实 1s，并按 60–90d hot / 日后 rclone 冷归档运营。
- **当前**：工程路径 + 夹具切秒单测。无 live 长桥推送、无 GCP 进程、无冷路径。
- **暗伤**：断线后该秒可能被切成两行；空洞秒保持空洞（不插值）。
- **下一步**：A 合并后 Gemini 在 GCP 挂采集（非 systemd 宣称已 live）；B Human 拍板冷归档 rclone 远端；C 不把 1s 当跟单发令枪。
