# GEX早场 2026-11-16 — 无新可用快照

- 目标场次：美东 2026-11-16 盘后清算（目标 20:15 ET / 北京时间 2026-11-17 09:15）。拉链按计划在 20:15:00 EST 触发。
- `collect_futu.py` 运行约 1440 秒后子进程超时，未写入新快照。采集日志几乎全是 `init connect fail` / `on_disconnect ... reason=RemoteClose`（OpenD 连接被对端关闭）。与 11-16 晚场不同：晚场是连上后 `us_option=NO`（`us_stock=LV3`）；本场是采集全程连不上。
- 当时 OpenD 进程在跑。本场分析时（北京时间 09:56 左右）`127.0.0.1:11111` 仍在监听（`FutuOpenD` 进程于北京时间 08:48 启动）。采集本身已结束，无残留 `collect_futu` 进程。
- 未写入 `snapshot_20261116_*.json`，也未更新 `latest.json`。当前 latest 仍是周五盘后 `data/gex/20261113/snapshot_20261113_202539.json`（generated_at `2026-11-13T20:15:00-05:00`）。仓库 `feat/chg064-offline` 在本场前最新相关提交仍是 `6825990`（晚场缺口说明）。
- 因此本场无法做盘后清算分析，也没有同一交易日的晚场/盘前对照，不编造、不复用周五数字和图。这是连续第二场（周一盘前 + 周一盘后）没有新链。
- 采集日志：`/tmp/gex_morning_20261117.log`
- 本场 `post_collect_pipeline` 被 guard 跳过（latest.json 未变），没有再给周五目录追加 Session digest。
- 建议检查：Futu OpenD 连接稳定性与美股期权权限（晚场仍是 `us_option=NO`）；API 商店 OPRA 实时是否已开通并在重启后生效；OpenD 日志里 RemoteClose 的原因。本助手未改采集脚本或计划任务。
