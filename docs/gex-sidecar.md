# GEX sidecar 接入说明（v1）

本机 Windows 拉链，GCP 只消费产物。这一版只落地采集 + JSON/HTML + 读法，**尚未挂到 dashboard / 跟单 / 微信推送**。

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
