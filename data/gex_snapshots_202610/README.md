# GEX 历史拉链数据归档 (2026-10-05 至 2026-10-12)

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
| **2026-10-13** (周二 批次1) | `snapshot_20261013_120530.json` | 2026-10-13 12:05:30 | 3 算力重仓标的 (NBIS, CIFR, CBRS) + 3 指数 0DTE | ~59 KB |
| **2026-10-13** (周二 批次2) | `snapshot_20261013_154016.json` | 2026-10-13 15:40:16 | 10 持仓补充标的 (RIOT, AEHR, NOK, PL, INTC, ONDS, WDC, GLW, AKAM, OKLO) | ~153 KB |
| **2026-10-13** (周二 全量合集) | `snapshot_20261013_combined.json` | 2026-10-13 15:40:16 | 13 组合全量标的合并视图 (含全部持仓与底层) | ~205 KB |

- **索引描述文件**：`manifest.json`（机器可读格式）
- **打包归档文件**：`gex_snapshots_20261005_20261012.zip`
- **最新参照基准**：`latest_snapshot_20261013.json`

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
