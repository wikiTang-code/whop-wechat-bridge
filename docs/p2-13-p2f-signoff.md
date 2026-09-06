# P2-13 联调签字清单（P2-13F）草稿

> **基线分支**：`feat/p1-attachments-and-ratelimiter` @ `91cf56d`  
> **联合执行**：Gemini ∥ Cursor  
> **依据**：`docs/p2-13-task-split-parallel.md` / `docs/p2-13-p2c-review.md` / `docs/p2-13-data-consistency-contract.md`  
> **日期**：2026-09-06  
> **状态**：Cursor 侧已预填；待 Gemini 完成 **P2-13E**（可选）或声明 skip 后双方终签。

---

## 1. 任务闭环

| 任务 ID | 内容 | Owner | Commit / 文件 | 结论 |
|---|---|---|---|---|
| **P2-13A** | 缺口清单 | Cursor | `be93353` `docs/p2-13-consistency-gap-checklist.md` | ✅ |
| **P2-13B** | 契约定稿 | Gemini | `37b431c` `docs/p2-13-data-consistency-contract.md` | ✅ 审过 |
| **P2-13C** | 只读探针 + 单测 | Gemini | `37b431c` `monitoring/data-consistency-probe.js` | ✅ 审过 |
| **P2-13D** | health/dashboard/monitoring 挂载 | Cursor | `91cf56d` | ✅ GCP 已验 |
| **P2-13E** | consistency_smoke.sh（可选） | Gemini | ⬜ 进行中 / skip | 待填 |
| **P2-13F** | 本签字清单 | 双方 | 本文件 | ✍️ 待终签 |

---

## 2. Cursor 已核验（生产抽样）

GCP @ `91cf56d`（2026-09-06）：

| 检查 | 结果 |
|---|---|
| `/health.subsystems.dataConsistency.status` | `ok` |
| `checked` / `mismatchCount` | `50` / `0` |
| overall 不因 consistency 单独 503 | ✅（契约：仅抬 warn） |
| `routeCoverage` / `tunnel` | `ok`；Tunnel URL 已刷新 |
| 重启瞬间 overall 可能短暂 `warn` | 已知瞬态，稳态恢复 `ok` |

本地回归（13D 合入时）：

```text
node test/test_data_consistency_probe.js   PASS
node test/test_dashboard_api.js            PASS（含 dataConsistency 键）
node test/test_monitoring_page.js          PASS（第 10 格 DOM）
```

---

## 3. 红线互签（预填）

| 红线 | 核验 | Cursor | Gemini |
|---|---|---|---|
| R2 无 pm2 restart | 探针/脚本静态审计 | ✅ | ⬜ |
| R3 只读开库 | `readonly: true` / 无 `getDb(` | ✅ | ⬜ |
| 软降级不 503 | health 聚合仅抬 warn | ✅ | ⬜ |
| 抽样非全盘 | LIMIT 50 + manifest 相交/尾部 20 | ✅ | ⬜ |

---

## 4. Gemini 补齐后勾选

- [ ] P2-13E 已合入 **或** 明确标注 `skip`（可选不做）
- [ ] 若有 smoke 脚本：dry-run 文档 + 无 pm2
- [ ] Gemini 在下方签字

---

## 5. 签字

- **Cursor**：同意就 13A–D 与 GCP 抽样结果签字 ✅（`91cf56d`）
- **Gemini**：⬜ 待 13E/skip 后签署
- **结论**：⬜ 待双方终签后归档 P2-13
