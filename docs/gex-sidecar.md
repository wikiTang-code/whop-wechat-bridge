# GEX sidecar 接入说明（v1）

本机 Windows 拉链，GCP 只消费产物。这一版只落地采集 + JSON/HTML + 读法，**尚未挂到 dashboard / 跟单 / 微信推送**。

图示来自长桥帖 [做末日的兄弟看过来！基于 longbridge CLI 实现 @LongbridgeAI](https://longbridge.com/zh-CN/topics/43511616?channel=OWNN00030)，对应开源 [heatseeker-lb](https://github.com/NineLooms/heatseeker-lb)（SPY/QQQ 热图）与 [gex-matrix-lb](https://github.com/NineLooms/gex-matrix-lb)（个股多到期日矩阵）。本 sidecar 对齐其公式与读法，拉链默认用富途 OpenD。

## 采集状态（v1 已跑通）

入库的 `data/gex/latest.json` **不是空壳**。它是 2026-09-05 23:49 用 `collect_futu.py` 在本机富途 OpenD 上跑通的快照：

- `source`: `futu-opend`（不是 longbridge-cli）
- `errors`: `[]`
- `zero_dte`: SPY / QQQ / SPX 均有 ladder，期权覆盖 102/102
- `matrix`: TSLA × 5 个到期日
- `kind`: `nearest`（周末代理，到期 2026-09-08，**不是** 0DTE）

同日更早的空文件 `snapshot_20260905_181759.json` / `182010.json` 是长桥 **OpenAPI OPRA 未开通** 时 `collect.py` 的失败日志（`zero_dte: {}` + errors）。它们**没有进 git**，不能当成当前采集状态。长桥 CLI 现在只用来补 `.SPX.US` 现货；期权链走富途 API 商店 OPRA（`us_option=LV1`），不是 App 行情那张 $2.99。

## 边界

| 在 Windows | 不在 GCP |
|---|---|
| `tools/gex-sidecar/collect_futu.py` | 不要装 OpenD、不要买云上 OPRA |
| 富途 OpenD `:11111` + 长桥 CLI 指数现货 | 交易仍用现有 `brokers/longbridge.js` |
| 写出 `data/gex/latest.json` | 以后若要给云端看，同步 JSON，不搬拉链 |

## 给后续嵌入的契约

稳定入口：`data/gex/latest.json`。摘要命令：`python tools/gex-sidecar/summarize.py`。

建议消费方只依赖：

- `generated_at` / `session` / `source` / `disclaimer`
- 每个标的的 `spot`、`spot_strike`、`king`、`floor`、`regime`（阶梯）或 `column_totals`（矩阵）

不要把 GEX 当买卖指令。叠加赵哥点位时：墙对齐才加权；负 GEX 只表示波动放大。

环境与读图细节见 `tools/gex-sidecar/README.md`。第一版样例在 `data/gex/latest.json`（2026-09-05 周末快照）。
