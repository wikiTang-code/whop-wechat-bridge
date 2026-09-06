# P2-13B：数据一致性巡检契约（定稿）

> **所属阶段**：P2-13 数据一致性巡检（G0 契约定稿）  
> **责任方**：Gemini（起草并定稿）∥ Cursor（交叉审阅并消费）  
> **依据**：`docs/p2-13-task-split-parallel.md` / `docs/p2-13-consistency-gap-checklist.md`  
> **日期**：2026-09-06  

---

## 1. 契约范围与权威数据面

本探针巡检三方权威数据面的一致性偏差：
1. **DB 消息表**：`whop_archive.db` 的 `messages` 表（重点列：`id`, `attachments`, `created_at`）；
2. **媒体清单**：`data/media/zhao/media_manifest.json`（本地落盘索引，条目含 `message_id`, `local_path`, `raw_url`, `status`）；
3. **磁盘实体**：`data/media/zhao/**` 下的实际二进制文件。

**只读铁律约束**：
- 探针只使用 `getReadOnlyArchiveDb()` 或以只读模式（`readonly: true`）打开 SQLite 数据库；
- **严禁**调用可写 `getDb()`；严禁修改任何数据、严禁自动删除或重新下载文件。

---

## 2. 偏差类别定义（Categories）

| 类别 Key | 标识 | 定义 | 触发判定 |
|---|---|---|---|
| `dbHasAttachMissingFile` | **C1** | `attachments` 中声明了本地落盘路径（`local_path`），但对应磁盘文件不存在或 `size === 0` | 存在时计入 mismatch；≥1 → warn，≥3 → critical |
| `manifestMissingFile` | **C2** | `media_manifest.json` 中的 `local_path` 指向不存在的磁盘文件 | 存在时计入 mismatch；≥1 → warn |
| `dbAttachParseError` | **C3** | `attachments` 列非空（非 `null`, `''`, `'[]'`），但 JSON 语法解析失败 | 存在时计入 mismatch；≥1 → warn |
| `skippedRemoteOnly` | **Skip** | 仅含远程 URL（`http(s)://`）且未分配 `local_path`，属于未下载或纯远程引用 | **不计入 mismatch**（避免假阳性） |
| `hasImageFlagOrphan` | **C4** | 标记暗示有图但 attachments 空且正文无图 | *本轮 Deferred（标记于 notes）* |
| `orphanFileOnDisk` | **C5** | 磁盘存在孤儿图片但未被 manifest 索引 | *本轮 Deferred（避免百万文件全盘扫描）* |

---

## 3. `/health` 与 Dashboard 契约 JSON 格式

挂载路径：`subsystems.dataConsistency`

```json
{
  "status": "ok",
  "checkedAtMs": 1757142000000,
  "sampleSize": 50,
  "checked": 50,
  "mismatchCount": 0,
  "categories": {
    "dbHasAttachMissingFile": 0,
    "manifestMissingFile": 0,
    "dbAttachParseError": 0
  },
  "skippedRemoteOnly": 0,
  "examples": [
    {
      "issue": "dbHasAttachMissingFile",
      "messageId": "msg_sample_123",
      "path": "data/media/zhao/2026-08-28/sample.jpg",
      "detail": "File not found on disk"
    }
  ],
  "description": "All 50 sampled messages and manifest entries consistent with disk",
  "notes": "sampled_only (limit 50, ordered by created_at desc)"
}
```

### 字段说明：
- `status`: `"ok" | "warn" | "critical" | "unknown"`。
- `sampleSize`: 本次抽样配置的上限（默认 50）。
- `checked`: 实际核验的带附件消息记录数。
- `mismatchCount`: `categories.dbHasAttachMissingFile + categories.manifestMissingFile + categories.dbAttachParseError` 之和。
- `examples`: 偏差样例数组，**上限截断为 5 条**，防止大体积 JSON 撑爆 `/health` 或看板。
- `notes`: 固定说明模式，默认 `"sampled_only"`。

---

## 4. 判定规则与健康降级语义

### 4.1 探针自身状态判定
- **`ok`**: `mismatchCount === 0`，抽样样本中所有声明的本地路径均物理存在且大小 > 0。
- **`warn`**: `mismatchCount >= 1`，但 `dbHasAttachMissingFile < 3`。
- **`critical`**: `dbHasAttachMissingFile >= 3`（表明存在系统性丢图风险）或探针执行发生不可预期异常（如数据库物理损坏）。
- **`unknown`**: 归档库不存在或无法读取（如开发全新环境且尚未产生数据）。

### 4.2 `/health` 整体聚合影响（软降级）
- 遵循 P2-12 / R2 软降级原则：
  - 当 `dataConsistency.status === 'warn'` 或 `'critical'` 时，仅将 `/health.status` 提升至 `'warn'`，**HTTP 状态码保持 200**；
  - **绝不**单独因为一致性偏差触发 HTTP 503，避免引发外部看门狗误杀服务。

---

## 5. 抽样与性能保障策略

1. **SQL 抽样**：
   ```sql
   SELECT id, attachments, created_at
   FROM messages
   WHERE attachments IS NOT NULL 
     AND attachments != '' 
     AND attachments != '[]'
   ORDER BY created_at DESC
   LIMIT 50;
   ```
2. **Manifest 抽样检查**：
   - 检查上述 50 条消息命中的 manifest 条目；
   - 额外对 manifest 数组末尾（最新）抽取至多 20 条执行磁盘检查。
3. **严格禁止全盘扫**：
   - 默认禁止 `fs.readdir` 递归整棵 `data/media` 目录树，单次巡检耗时必须控制在 50ms 以内（958MB 内存安全）。
4. **TTL 缓存机制**：
   - 默认缓存时间 `DEFAULT_TTL_MS = 60_000`（60秒）；
   - `/health` 频繁轮询时命中内存缓存，杜绝重复磁盘 I/O。

---

## 6. 宽容解析规范

在解析 `messages.attachments` 列时：
1. **字符串化 JSON 数组**：最常见格式，尝试 `JSON.parse(attachments)`；
2. **数组元素形态**：
   - 若元素为字符串且为 `http(s)://`，无 `local_path`：`skippedRemoteOnly++`；
   - 若元素为对象 `{ local_path, url, ... }`：
     - 若 `local_path` 存在且非空：检查 `fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).size > 0`；
     - 若仅有 `url` 且 `!local_path`：`skippedRemoteOnly++`；
3. **路径解析**：
   - 统一通过 `path.resolve(projectRoot, item.local_path)` 规范化为跨平台绝对路径，避免 Windows / Linux 路径斜杠混淆。
