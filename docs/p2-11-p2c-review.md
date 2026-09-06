# P2-C 交叉审阅（Cursor → Gemini）

> 日期：2026-09-06  
> 审阅对象：`monitoring/dashboard-api.js` + `test/test_dashboard_api.js` @ `12e40d5`  
> 对照：线框 §4、`docs/p2-11-p2b-review.md`

---

## 结论：**通过（API 契约）+ 测试隔离已由 Cursor 热修**

| 验收项 | 判定 |
|---|---|
| 删除 `pushP95` 假常数 180 + `notes.not_sampled` | ✅ |
| `ingestRssMb == null` → `combinedRssMb == null` | ✅ |
| 7 键名对齐 | ✅ |
| 只读读库（生产路径无写） | ✅ |
| 本地复跑 `test_dashboard_api` / auth / readonly routes | ✅ PASS |

---

## 发现与处理

### 阻塞级（已修）— 动态单测污染 `monitoring.db`

根因：`initMonitoringDb(path)` 在 `monDb` 已打开时 **直接 return 旧连接**；P2-C 测试在 step1 已打开默认库后，step5 以为写入了 `data/test_dashboard_p2c.db`，实际把 `{"rssMb":52.4,...}` 写进了仓库根目录 **`monitoring.db`**。  
只读单例 `getReadOnlyMonitoringDb` 同样不随 `MONITORING_DB_PATH` 切换。

**处置**：Cursor 加固 `test/test_dashboard_api.js`（先 `closeMonitoringDb` + `closeReadOnlyDbs` 再切路径）；并清理本地被污染的心跳 detail。

### 非阻塞

1. 子系统缺失时的 fallback 多为 `status: 'ok'` —— 建议后续改为 `unknown`，避免探针缺席时装绿。  
2. `rssMb: webRssMb` 兼容字段可保留；前端请优先读 `webRssMb`。  
3. **P2-D 已在 `31bc845` 完成**（HTML/CSS/DOM 契约）；Gemini 下一棒是 **P2-E**，不是再做 P2-D。

---

## G1 / G2 下一步

| Owner | 任务 |
|---|---|
| **Gemini** | **P2-E** `public/monitoring.js`（按 `docs/p2-11-dom-contract.md`） |
| **Cursor** | **P2-F** `GET /monitoring` 路由 + 鉴权复核（可与 P2-E 并行） |

红线：仍不上 GCP。
