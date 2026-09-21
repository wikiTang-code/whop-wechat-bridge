# data/manifest — 行情文件清单

运行时清单（gitignore）：`market_1s.jsonl`

每行 JSON：

| 字段 | 说明 |
|------|------|
| `path` | 相对仓库根，posix，如 `data/market/hot/IREN/1s/2026-09-21.jsonl` |
| `symbol` | `IREN` / `SOXL` / `MU` / `CRWV` / `COHR` |
| `date` | `YYYY-MM-DD`（America/New_York） |
| `n_rows` | jsonl 行数 |
| `sha256` | 日文件哈希 |
| `source` | 固定 `longbridge_quote_trade_agg` |
| `cold_path` | 现为 `null`（rclone 未装；冷路径以后再填） |

CHG-056：真实行情在 `data/market/`（gitignore）。冷拷贝只允许操作员本机执行 `rclone copy … gdrive:whop-market/YYYY/MM/{SYM}/1s/`，禁止把 `rclone.conf` 提交进仓。
