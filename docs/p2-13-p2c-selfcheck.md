# P2-13C：数据一致性巡检自检报告（Gemini）

> **所属任务**：P2-13 数据一致性巡检（G1 交付）  
> **基准代码**：`monitoring/data-consistency-probe.js` / `test/test_data_consistency_probe.js`  
> **契约依据**：`docs/p2-13-data-consistency-contract.md` (13B) / `docs/p2-13-consistency-gap-checklist.md` (13A)  
> **日期**：2026-09-06  

---

## 1. 交付成果概况

| 项 | 文件 / 模块 | 核心落地能力 |
|---|---|---|
| **P2-13B** | `docs/p2-13-data-consistency-contract.md` | `subsystems.dataConsistency` 契约定稿；定义 C1~C3 必做规则与 C4/C5 延后规则；软降级只抬 warn 不单独 503 |
| **P2-13C** | `monitoring/data-consistency-probe.js` | 纯只读数据一致性探针；默认抽样 50 条消息 + 20 条最新 manifest；宽容解析与防假阳性；TTL 60s 内存缓存 |
| **单测套件** | `test/test_data_consistency_probe.js` | 10 个测试场景（静态规则 + 隔离沙箱 + C1/C2/C3/Skip 边界 + TTL 缓存 + 真实库回归），**100% PASS** |

---

## 2. 缺口清单逐项验收核对（对照 13A §7）

| 验收项（13A §7） | 核验表现 | 结论 |
|---|---|---|
| **夹具造 1 条 DB 附件指向不存在文件** | 准确识别为 `dbHasAttachMissingFile` (C1)，`mismatchCount=1`，触发 `status=warn` | ✅ **PASS** |
| **夹具造 ≥3 条 DB 附件指向不存在文件** | 准确触发累积阈值升级为 `status=critical`，`categories.dbHasAttachMissingFile=3` | ✅ **PASS** |
| **夹具造 manifest 指向不存在路径** | 准确识别为 `manifestMissingFile` (C2)，记入偏差计数与 examples | ✅ **PASS** |
| **夹具造坏 JSON attachments** | 宽容捕获 `JSON.parse` 异常并记为 `dbAttachParseError` (C3)，探针整体不崩溃 | ✅ **PASS** |
| **纯远程未下载 URL (http/https)** | 归入 `skippedRemoteOnly` 计数，**不计入** mismatch，不报假阳性 | ✅ **PASS** |
| **默认抽样不扫全盘** | SQL 严格限定 `LIMIT 50`，manifest 仅查抽样相交或最新 20 条，杜绝递归遍历磁盘 | ✅ **PASS** |
| **零写库、零 pm2、零自动删改** | 静态 AST/文本审计确认无 `getDb(`、无 `pm2 restart/stop`、无 `unlinkSync/rmSync` | ✅ **PASS** |

---

## 3. 本地单测执行实录

```bash
$ node test/test_data_consistency_probe.js
--- 开始执行 P2-13C 测试: test_data_consistency_probe ---
1. 验证静态红线 (只读模式 / 无写操作 / 无 pm2)...
   ✅ 静态红线核验通过：杜绝可写 getDb()、杜绝 pm2 重启、杜绝物理删修数据
2. 搭建动态测试隔离沙箱...
3. 场景 A: 验证数据全部一致时的 ok 状态...
   ✅ 场景 A 通过：全一致时严格返回 status=ok, mismatchCount=0
4. 场景 B: 验证 DB 有记录但磁盘文件缺失 (C1 -> warn)...
   ✅ 场景 B 通过：单条缺失物理文件准确识别为 C1 并判定 warn
5. 场景 C: 验证缺失累积达到阈值时升级为 critical...
   ✅ 场景 C 通过：C1 累积达到 3 条时准确提升评级至 critical
6. 场景 D: 验证 manifest 条目指向缺失磁盘文件 (C2)...
   ✅ 场景 D 通过：manifest 指向不存在文件准确记入 C2
7. 场景 E: 验证 attachments 畸形 JSON 解析失败 (C3)...
   ✅ 场景 E 通过：畸形 JSON 宽容捕获并记入 C3，探针自身零崩溃
8. 场景 F: 验证纯远程未下载 URL 优雅跳过 (防假阳性)...
   ✅ 场景 F 通过：未落盘的远程 URL 纯引用安全跳过，绝无假阳性
9. 验证 TTL 缓存与刷新机制...
   ✅ 场景 G 通过：TTL 内存缓存生效且支持显式 force 刷新
10. 验证在项目真实环境下的只读稳健执行...
   ✅ 场景 H 通过：真实环境抽样执行耗时极低，结果状态: ok (checked=50, mismatches=0)

🎉 ALL P2-13C TESTS PASSED: test_data_consistency_probe
```

---

## 4. 移交 Cursor（P2-13D）契约接口指南

请 Cursor 团队在推进 **P2-13D**（`health.js` / `dashboard-api.js` 薄挂载 + monitoring 第 10 格）时直接引用以下导出：

```javascript
import {
  getDataConsistencySnapshot,
  refreshDataConsistencySnapshot,
} from './monitoring/data-consistency-probe.js';

// 获取带 60s TTL 缓存的快照:
const consistency = await getDataConsistencySnapshot();

// 返回形状完全对齐 docs/p2-13-data-consistency-contract.md:
// consistency = {
//   status: 'ok' | 'warn' | 'critical' | 'unknown',
//   checkedAtMs: number,
//   sampleSize: 50,
//   checked: number,
//   mismatchCount: number,
//   categories: { dbHasAttachMissingFile, manifestMissingFile, dbAttachParseError },
//   skippedRemoteOnly: number,
//   examples: [ { issue, messageId, path, detail } ],
//   description: string,
//   notes: 'sampled_only (limit 50, ordered by created_at desc)'
// }
```

**与 /health 挂载约束提醒**：
- 请在 `health.js` 中将该对象挂入 `subsystems.dataConsistency`；
- 当 `consistency.status === 'warn'` 或 `'critical'` 时，仅提升 overall 判定为 `'warn'`，**严禁**报 503。
