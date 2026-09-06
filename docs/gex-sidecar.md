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
| `open_session_run.py` 开盘计划任务 | 云上不跑采集 |

## 给后续嵌入的契约

稳定入口：`data/gex/latest.json`。摘要命令：`python tools/gex-sidecar/summarize.py`。

Dashboard **已挂只读消费**（v1）：

- `GET /api/gex/latest?symbol=TSLL|TSLA`：读文件、白名单裁剪后返回。`symbol` **只改 focus 映射**（TSLL → 看 TSLA 正股），不改指数/矩阵内容。
- 响应含 `reports[]` 与 `analysis`（规则引擎结构解读/结论，默认摘要条可见），**仍不含** `ladder` / 全量 `matrix[]`。
- UI：摘要条直接展示「结构解读 / 结论」；「详情与热图」展开元数据 + HTML 链接。
- POST/PUT/DELETE `/api/gex*` 一律 **403**。
- `oi_as_of=yesterday_close`；`kind=nearest` 标成「非 0DTE」。过期：RTH >60 分钟，闭市/周末代理 >12 小时。

建议消费方只依赖：

- `ok` / `stale` / `age_minutes` / `collection` / `disclaimer` / `oi_as_of` / `reports`
- 指数：`spot`、`spot_strike`、`kind`、`expiry`、`king`、`floor`、`regime`、`local_gex`
- 矩阵 TSLA：`spot`、`king`、`floor`、`column_totals`

不要把 GEX 当买卖指令。叠加赵哥点位时：墙对齐才加权；负 GEX 只表示波动放大。不要用 GEX 自动对齐或挡执行。

## 开盘本机自动采集

推荐时刻：**美东 09:40（开盘后约 10 分钟）周一至周五**。

1. 复制配置：`tools/gex-sidecar/open_session_config.example.json` → `open_session_config.json`（已 gitignore）
2. 改 `mode` / `zero_dte` / `matrix`（默认 SPY,QQQ,SPX + TSLA）
3. 试跑：`python tools/gex-sidecar/open_session_run.py --dry-run`
4. 安装计划任务：`powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1`

`mode`：

| 值 | 行为 |
|---|---|
| `auto` | 到点直接拉链，企微发结果 |
| `notify_then_auto`（默认） | 企微预告 → 等待 `ask_wait_seconds` → 若存在 `data/gex/.skip_open_session` 则跳过，否则拉链 |
| `ask_console` | 终端 Y/N（仅手动，勿给计划任务用） |

企微 webhook 读仓库 `.env` 的 `WECHAT_WORK_WEBHOOK_URL`（或配置里的 `webhook_env`）。机器人无法可靠收「回复同意」，故用 **预告 + skip 文件**。

环境与读图细节见 `tools/gex-sidecar/README.md`。第一版样例在 `data/gex/latest.json`（2026-09-05 周末快照）。
