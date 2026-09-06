# GEX sidecar 接入说明（v1）

本机 Windows 拉链，GCP 只消费产物。采集 + JSON/HTML 已跑通；Dashboard 只读条已挂 `GET /api/gex/latest`（时间轴日级条 + 量化 Tab）。**不进跟单执行、不进微信推送、不改 L2a。**

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

Dashboard **已挂只读消费**（v1）：

- `GET /api/gex/latest?symbol=TSLL|TSLA`：读文件、白名单裁剪后返回。`symbol` **只改 focus 映射**（TSLL → 看 TSLA 正股），不改指数/矩阵内容。
- POST/PUT/DELETE `/api/gex*` 一律 **403**（只读，不写库、不入 L2a）。
- 时间轴页未登录也可拉：`/api/gex` 与 `/ticker_timeline.html` 一样走 auth bypass。
- UI：`ticker_timeline.html` 日级条 + 量化 Tab 结构条。**不**改顶栏系统风险色，**不** iframe HTML，**不**把 `ladder` / 全量 `matrix[]` 渲到页面。
- `oi_as_of=yesterday_close`；`kind=nearest` 标成「非 0DTE」。过期：RTH >60 分钟，闭市/周末代理 >12 小时。空快照只显示「暂无」，不当成持有。

建议消费方只依赖：

- `ok` / `stale` / `age_minutes` / `collection` / `disclaimer` / `oi_as_of`
- 指数：`spot`、`spot_strike`、`kind`、`expiry`、`king`、`floor`、`regime`、`local_gex`
- 矩阵 TSLA：`spot`、`king`、`floor`、`column_totals`

不要把 GEX 当买卖指令。叠加赵哥点位时：墙对齐才加权；负 GEX 只表示波动放大。不要用 GEX 自动对齐或挡执行。

环境与读图细节见 `tools/gex-sidecar/README.md`。第一版样例在 `data/gex/latest.json`（2026-09-05 周末快照）。
