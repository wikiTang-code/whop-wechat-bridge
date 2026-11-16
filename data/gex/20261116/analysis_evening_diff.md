# GEX晚场 2026-11-16 — 无新快照

- 拉链按计划在美东 08:00（北京时间 21:00）触发，OpenD 在 `127.0.0.1:11111` 在线（进程 FutuOpenD 仍在监听）。
- `collect_futu.py` 失败：`us_option=NO`（`us_stock=LV3`）。报错原文：美股期权权限仍是 NO。请买 Futu API 商店的 OPRA 实时（不是 App 那张），然后重启 OpenD。
- 未写入 `snapshot_20261116_*.json`，也未更新 `latest.json`。当前 latest 仍是周五盘后 `data/gex/20261113/snapshot_20261113_202539.json`（generated_at `2026-11-13T20:15:00-05:00`）。
- 因此本场无法做「相对早场基准的差异」分析，不编造、不复用周五图。
- 采集日志：`/tmp/gex_evening_20261116.log`
- 副作用：失败后 `post_collect_pipeline` 仍对周五目录 `data/gex/20261113/analysis_daily.md` 追加了一段重复的 Session digest，并推送 commit `079e35d`（`manifest.updated_at` 改为 2026-11-16T21:00:01）。周五原始 JSON 与已写的早晚场报告、一周总结未被覆盖。
