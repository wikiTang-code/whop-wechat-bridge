# P2-13 数据一致性巡检 — 任务拆分（Gemini ∥ Cursor）

> 日期：2026-09-06  
> 基线：P2-12 全阶段已互签归档（`4a4410d` / `docs/p2-12-p2h-signoff.md`）。  
> 依据：加固计划 §7 项 13（H：附件/manifest/磁盘/打标一致性）；红线 R2/R3/R5。  
> **本轮默认本地实现 + 单测；上 GCP / crontab 须操作员确认。**

---

## 0. 范围与红线

**做**
- 只读巡检：DB `messages.attachments` ↔ `media_manifest` ↔ 磁盘文件 三方偏差可发现  
- 探针快照进 `/health` 和/或 monitoring dashboard（显式 `null`/`note`，禁止假绿）  
- 可选外部 bash 冒烟（告警 only，无 pm2 restart）  
- 交叉审阅

**不做**
- 不自动删库/重下媒体/改水位  
- 不自动 `pm2 restart`  
- 不扩写主库 schema（除非已有列只读统计）  
- 不做 P2-14 RUM / P2-15 软降级钩子（另轮）

**已有可复用**
- `monitoring/asset-freshness-probe.js`（新鲜度 ≠ 一致性；勿混为一谈）  
- P1-5 attachments 回填路径；`data/media/zhao/media_manifest.json`

---

## 1. 并行分工

| ID | 任务 | Owner | 并行组 | 交叉审阅 | 依赖 |
|---|---|---|---|---|---|
| **P2-13A** | 一致性缺口清单（采样规则、表/文件路径、误报边界） | **Cursor** | G0 | Gemini | — |
| **P2-13B** | 线框/契约：`subsystems.dataConsistency` JSON 形状 | **Gemini** | G0 | Cursor | 可并行 |
| **P2-13C** | `monitoring/data-consistency-probe.js` 只读实现 + 单测 | **Gemini** | G1 | Cursor | ✅ `37b431c` |
| **P2-13D** | 挂入 `health.js` / dashboard-api + monitoring 小格 | **Cursor** | G1 | Gemini | ✅ 本提交 |
| **P2-13E** | （可选）`scripts/watchdog/consistency_smoke.sh` | **Gemini** | G2 | Cursor | 13C |
| **P2-13F** | 联调签字 | 双方 | G3 | 互签 | 13C/D |

```
G0: Cursor 13A  ║  Gemini 13B
G1: Gemini 13C  ║  Cursor 13D（先按契约草稿写 DOM/透传，后接真探针）
G2: Gemini 13E（可选）
G3: 互签 → 再议上机
```

---

## 2. 契约草稿（G0 交换，可修订）

### `subsystems.dataConsistency`

```json
{
  "status": "ok|warn|critical|unknown",
  "checkedAtMs": 0,
  "sampleSize": 0,
  "checked": 0,
  "mismatchCount": 0,
  "categories": {
    "dbHasAttachMissingFile": 0,
    "manifestMissingFile": 0,
    "orphanFileOptional": 0,
    "dbAttachParseError": 0
  },
  "examples": [
    { "messageId": "...", "issue": "dbHasAttachMissingFile", "path": "..." }
  ],
  "description": "human readable",
  "notes": "sampled_only|full_scan"
}
```

规则初稿（13A/13B 定稿为准）：
- 默认 **抽样**（如最近 N 条 has_image / 带 attachments 的消息），全盘扫描作离线脚本另议  
- `mismatchCount >= 1` → `warn`；`>= 阈值` 或关键路径全缺 → `critical`  
- 只抬 overall 到 **warn**，不单独 503（对齐 routeCoverage）  
- 例子数组上限 5，防打爆 `/health`

---

## 3. 文件所有权

| 文件 | Owner |
|---|---|
| `docs/p2-13-consistency-gap-checklist.md` | Cursor |
| `docs/p2-13-data-consistency-contract.md`（或写入线框） | Gemini |
| `monitoring/data-consistency-probe.js` | Gemini |
| `test/test_data_consistency_probe.js` | Gemini |
| `monitoring/health.js` / `dashboard-api.js` 薄挂载 | Cursor |
| `public/monitoring.{html,js}` 小格 | Cursor |
| `scripts/watchdog/consistency_smoke.sh` | Gemini（可选） |

---

## 4. 验收

- [x] 缺口清单可指导实现，无需再猜路径  
- [x] 探针单测：人为制造缺文件 → warn/critical  
- [x] `/health.subsystems.dataConsistency` 有真实字段  
- [x] monitoring 页可见该格  
- [x] 无自动修复/无 pm2 restart  
- [ ] 联调签字归档  

---

## 5. 给 Gemini 的即时指令

1. 拉 `feat/p1-attachments-and-ratelimiter` @ `4a4410d`+  
2. 先写 **P2-13B** 契约定稿（可基于上文草稿修订）  
3. 等 Cursor 合入 **P2-13A** 清单后实现 **P2-13C**  
4. 勿改 `route-coverage-probe.js` / `page_smoke.sh`  
5. 自检文档：`docs/p2-13-p2c-selfcheck.md`  
