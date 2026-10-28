# GEX 历史拉链数据归档 (2026-10-05 至 2026-10-13)

> **临时分析目录**：本目录专为跨 Agent（Cursor / Gemini / Subagents）共享与离线多模态/策略分析设立，存放 2026 年 10 月 5 日以来的每日期权链 GEX 快照。

---

## 1. 包含快照列表

| 日期 | 对应文件 | 生成时刻 (ET/CST) | 标的覆盖 | 文件大小 |
| :--- | :--- | :--- | :--- | :--- |
| **2026-10-05** (周一) | `snapshot_20261005_210421.json` | 2026-10-05 21:00:05 | 9 矩阵标的 + 3 指数 0DTE | ~160 KB |
| **2026-10-06** (周二) | `snapshot_20261006_210422.json` | 2026-10-06 21:00:05 | 9 矩阵标的 + 3 指数 0DTE | ~163 KB |
| **2026-10-07** (周三) | `snapshot_20261007_210422.json` | 2026-10-07 21:00:07 | 9 矩阵标的 + 3 指数 0DTE | ~159 KB |
| **2026-10-08** (周四) | `snapshot_20261008_210421.json` | 2026-10-08 21:00:05 | 9 矩阵标的 + 3 指数 0DTE | ~162 KB |
| **2026-10-09** (周五) | `snapshot_20261009_210421.json` | 2026-10-09 21:00:05 | 9 矩阵标的 + 3 指数 0DTE | ~157 KB |
| **2026-10-12** (周一) | `snapshot_20261012_210423.json` | 2026-10-12 21:00:06 | 9 矩阵标的 + 3 指数 0DTE | ~160 KB |
| **2026-10-13** (周二 正式盘前) | `snapshot_20261013_210852.json` | 2026-10-13 21:00:03 | **全量 22 矩阵标的 (含全部云仓/持仓) + 3 指数 0DTE** | ~340 KB |
| **2026-10-13** (周二 盘前中间件) | `snapshot_20261013_combined.json` | 2026-10-13 15:40:16 | 13 组合新增标的合并中间件 | ~205 KB |
| **2026-10-15** (周四 正式盘前) | `snapshot_20261015_212716.json` | 2026-10-15 21:16:03 | **全量 22 矩阵标的 (OPRA 续期后全量重拉) + 3 指数 0DTE** | ~353 KB |
| **2026-10-16** (周五 正式盘前) | `snapshot_20261016_211054.json` | 2026-10-16 21:00:03 | **全量 22 矩阵标的 (日常盘前拉链) + 3 指数 0DTE** | ~354 KB |
| **2026-10-19** (周一 正式盘前) | `snapshot_20261019_210901.json` | 2026-10-19 21:00:08 | **全量 22 矩阵标的 (最新盘前拉链) + 3 指数 0DTE** | ~344 KB |
| **2026-10-20** (周二 提前拉链) | `snapshot_20261020_162337.json` | 2026-10-20 16:14:39 | **全量 22 矩阵标的 (体现 10/19 盘后清算与现货) + 3 指数 0DTE** | ~365 KB |
| **2026-10-21** (周三 早场拉链) | `snapshot_20261021_090901.json` | 2026-10-21 09:00:07 | **全量 22 矩阵标的 (10/20 盘后清算 OI 版) + 3 指数 0DTE** | ~369 KB |
| **2026-10-21** (周三 晚场拉链) | `snapshot_20261021_210859.json` | 2026-10-21 21:00:09 | **全量 22 矩阵标的 (10/21 美股盘前实时版) + 3 指数 0DTE** | ~371 KB |
| **2026-10-22** (morning_post_market) | `snapshot_20261022_090858.json` | 2026-10-22T09:00:07 | **全量 22 矩阵标的 + 3 0DTE** | ~365 KB |
| **2026-10-22** (evening_pre_open) | `snapshot_20261022_210857.json` | 2026-10-22T21:00:08 | **全量 22 矩阵标的 + 3 0DTE** | ~368 KB |
| **2026-10-23** (morning_post_market) | `snapshot_20261023_090856.json` | 2026-10-23T09:00:07 | **全量 22 矩阵标的 + 3 0DTE** | ~358 KB |
| **2026-10-23** (evening_pre_open) | `snapshot_20261023_210857.json` | 2026-10-23T21:00:07 | **全量 22 矩阵标的 + 3 0DTE** | ~364 KB |
| **2026-10-26** (evening_pre_open) | `snapshot_20261026_223919.json` | 2026-10-26T22:30:27 | **全量 22 矩阵标的 + 3 0DTE** | ~367 KB |
| **2026-10-27** (morning_post_market) | `snapshot_20261027_090851.json` | 2026-10-27T09:00:01 | **全量 22 矩阵标的 + 3 0DTE** | ~370 KB |
| **2026-10-27** (evening_pre_open) | `snapshot_20261027_210854.json` | 2026-10-27T21:00:05 | **全量 22 矩阵标的 + 3 0DTE** | ~366 KB |
| **2026-10-28** (morning_post_market) | `snapshot_20261028_090856.json` | 2026-10-28T09:00:05 | **全量 22 矩阵标的 + 3 0DTE** | ~370 KB |

- **索引描述文件**：`manifest.json`（机器可读格式）
- **打包归档文件**：`gex_snapshots_20261005_20261012.zip`
- **最新参照基准**：`latest_snapshot_20261021.json` (对应 10/21 晚场盘前全量拉链)

---

## 2. 标的矩阵覆盖范围

- **高频正股矩阵 (`matrix`)**：
  `TSLA`, `NVDA`, `COIN`, `MU`, `CRWV`, `SOXL`, `COHR`, `LITE`, `IREN`
- **0DTE 指数期权 (`zero_dte`)**：
  `SPY`, `QQQ`, `SPX`

---

## 3. Agent 读取示例 (Node.js / Python)

### Node.js:
```javascript
const fs = require('fs');
const path = require('path');

// 1. 读取指定日期的快照
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot_20261005_210421.json'), 'utf8'));
const tslaGex = snapshot.matrix.TSLA;
console.log('TSLA Call Wall:', tslaGex.call_wall, 'Put Wall:', tslaGex.put_wall);

// 2. 读取 manifest 遍历全周期
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
manifest.snapshots.forEach(s => {
  console.log(s.date, s.filename);
});
```

### Python:
```python
import json
from pathlib import Path

archive_dir = Path("data/gex_snapshots_202610")
with open(archive_dir / "snapshot_20261012_210423.json", "r", encoding="utf-8") as f:
    data = json.load(f)

nvda = data["matrix"]["NVDA"]
print("NVDA Net GEX:", nvda.get("net_gex"))
```