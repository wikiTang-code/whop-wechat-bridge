# GEX sidecar（本机）

Windows 定时拉链，产出 `data/gex/latest.json` 与 HTML。**不要把拉链放到 GCP。** 交易仍走长桥 OpenAPI（`brokers/longbridge.js`），GEX 只读期权结构。

当前推荐数据源是 **富途 OpenD**（美股期权含 SPX/VIX 链）。指数现货 OpenAPI 没有，采集时用长桥 CLI `quote .SPX.US` 补现价。

## 来源

图示与 KING/FLOOR 读法来自长桥帖 [做末日的兄弟看过来！基于 longbridge CLI 实现 @LongbridgeAI](https://longbridge.com/zh-CN/topics/43511616?channel=OWNN00030)：

- [NineLooms/heatseeker-lb](https://github.com/NineLooms/heatseeker-lb) — SPY/QQQ 0DTE NetGEX 热图
- [NineLooms/gex-matrix-lb](https://github.com/NineLooms/gex-matrix-lb) — 个股 GEX 矩阵（多到期日）

本仓库是 sidecar 移植，不是这两个仓库的 fork。默认拉链走富途 OpenD（含指数期权链）；长桥 CLI 只补指数现货，交易仍走长桥。

## 采集状态（v1 已跑通）

`data/gex/latest.json` 当前里程碑是 **2026-09-21T21:56:07 富途 OpenD**（`source=futu-opend`，`errors=[]`，SPY/QQQ/SPX `0dte` + CHG-057 九标的矩阵）。不要把更早、**未入库**的长桥 `collect.py` 空快照（OPRA OpenAPI 未开通）当成现状。

## 环境

1. Python 3.11+，安装依赖：

```powershell
pip install -r tools/gex-sidecar/requirements.txt
```

2. **富途 OpenD** 已登录，监听 `127.0.0.1:11111`。美股期权权限必须是 API 商店的 OPRA 实时（约 $6），不是 App 行情商城 $2.99。`get_user_info.us_option_qot_right` 不能是 `NO`。GEX 不需要 OPRA 深度。

3. **长桥 CLI**（补指数现货；备选拉链也用它）。`LONGBRIDGE_REGION=global`。登录：

```powershell
$env:LONGBRIDGE_REGION='global'
longbridge auth login
```

token 在 `~/.longbridge`，不要提交。长桥 OpenAPI 的 OPRA 是另一张卡，当前拉链默认不靠它。

4. 可选环境变量见 `tools/gex-sidecar/env.example`。跟单用的 `LONGBRIDGE_APP_KEY` 三件套仍在仓库根 `.env`，sidecar 不读取。

## 运行

```powershell
$env:PYTHONIOENCODING='utf-8'
$env:LONGBRIDGE_REGION='global'
python tools/gex-sidecar/collect_futu.py
# 默认: --zero-dte SPY,QQQ,SPX --matrix TSLA,IREN,CRWV,MU,COHR,SOXL,COIN,NVDA,LITE --expiries 5

python tools/gex-sidecar/summarize.py
```

长桥备选（需 OpenAPI OPRA，无指数期权）：

```powershell
python tools/gex-sidecar/collect.py
```

## 盘前自动采集（本机 win-host + OpenD）

工作日（CHG-059）：**08:45 ET 唤醒 → 09:00 ET 才拉链 → 09:20–09:25 ET 写完 `latest.json`（截止 09:25，错过标 `preopen.deadline_status=late`）**。`spot_session=premarket`。OI 是前收 T+1 库存，时刻是为了赵哥约 09:32 之前有快照，不是新 OI。可选 09:31 只刷新现货，**禁止重拉 OI**（`collect_futu` 还不能拆开时，`--spot-only-refresh` 只打 stub，不调 OpenD）。不要把拉链迁到 GCP。

本机应用（更新已有任务 `WhopGexOpenSession0940ET`，名字沿用）：

```powershell
copy tools\gex-sidecar\open_session_config.example.json tools\gex-sidecar\open_session_config.json
python tools/gex-sidecar/open_session_run.py --dry-run
powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1
Get-ScheduledTask -TaskName WhopGexOpenSession0940ET | Format-List TaskName,State
python test/test_open_session_preopen.py
python test/test_open_session_dst.py
```

安装器把夏令 08:45 ET（12:45 UTC）换成本机墙钟。Python 用 `America/New_York` 等到 09:00。应用本变更时重跑一次安装器；季节切换不用重装。09:31 现货刷新先不要另挂计划任务。

- `notify_then_auto`：企微预告；预告等待不会把拉链推过 09:00。本机创建 `data/gex/.skip_open_session` 可跳过本次。
- `auto`：等到 09:00 后拉链。
- `ask_console`：仅手动确认。
- `--spot-only-refresh`：不拉链。已有 `latest.json` 只写 `spot_refresh.repull_oi=false`。

看板「完整信息」按钮可打开 `/gex-html/heatseeker_gex.html` 与矩阵 HTML。

## 产物

| 文件 | 用途 |
|---|---|
| `data/gex/latest.json` | 给后续嵌入用的结构快照 |
| `data/gex/heatseeker_gex.html` | SPY/QQQ/SPX 阶梯 |
| `data/gex/gex_matrix_TSLA.html` | TSLA 到期日 × 行权价 |
| `data/gex/snapshot_*.json` | 带时间戳备份（默认不入库） |

公式：`NetGEX = sign × gamma × OI × spot × 100`（Call+ / Put−）。OI 是 T+1。周末/闭市时 `kind=nearest`，不一定是 0DTE。

## 怎么读（解析）

阶梯图按标记扫，不要从上扫到下：

- **spot**：真实报价。**◀ PRICE** 只是吸到最近行权价的那一档。
- **FLOOR**：窗口内最强正 GEX（吸收）。正墙在上方像阻力，在下方像支撑。
- **KING**：窗口内最强负 GEX（翻转/加速）。负 GEX 放大波动，涨跌都会被放大。
- **PILLOW**：仅当 King 高于现价、且中间还有别的正档时出现。
- **现价附近 positive_gamma**：现价上下共五档合计 ≥ 0，局部吸收，不是看涨。
- **列合计**（矩阵底行）：该到期日窗口内各档 NetGEX 之和，不是成交单。先看最近一列正负，再看 King。Floor 只是最绿的一格，可以出现在净负列里，权重按「近、大、是否贴着现价」降。

Dashboard 只读入口：`GET /api/gex/latest?symbol=TSLL`（白名单字段，不含 ladder / 全量 matrix[]）。对照赵哥点位用，不自动下单。盘中墙的位置几乎不动，强度会变；开盘 5–10 分钟后重跑即可。

JSON 字段（嵌入时读这些即可）：

- `zero_dte.<TICKER>.{spot,spot_strike,expiry,kind,king,floor,pillow,local_gex,regime,ladder}`
- `matrix.<TICKER>.{spot,spot_strike,king,floor,column_totals,matrix[].by_expiry}`

第一版样例快照：`2026-09-05T23:49:49`（周末，最近到期 2026-09-08）。
