# P2-13A：数据一致性缺口清单（Cursor）

> 给 Gemini **P2-13B/C** 直接落地用。  
> 范围：附件 / manifest / 磁盘；不做新鲜度（已有 `asset-freshness-probe.js`）。

---

## 1. 权威数据面

| 面 | 路径 / 来源 | 备注 |
|---|---|---|
| DB | `whop_archive.db` → `messages` | 列：`id`, `attachments`（JSON 文本或 null）, 可能有 content 内 `[IMAGE:…]` |
| Manifest | `data/media/zhao/media_manifest.json` | 数组；字段常见 `raw_url`, `local_path`, `message_id`, `sha` 等（以实现时读样例为准） |
| 磁盘 | `data/media/zhao/**` | 真图；亦有 `data/media/general/`（本轮可先只扫 zhao，general 标 optional） |
| 只读打开 | `getReadOnlyArchiveDb()` / 探针内 readonly better-sqlite3 | **禁止**可写 `getDb()` |

---

## 2. 应对齐的「不一致」类别

| ID | 定义 | 建议 severity |
|---|---|---|
| **C1** `dbHasAttachMissingFile` | `attachments` 解析后有本地路径或可映射到 manifest，但磁盘文件不存在 / size=0 | warn（单条）/ critical（抽样内 ≥3 或比例高） |
| **C2** `manifestMissingFile` | manifest 条目 `local_path` 指向不存在文件 | warn |
| **C3** `dbAttachParseError` | `attachments` 非空但 JSON 解析失败 | warn |
| **C4** `hasImageFlagOrphan`（可选） | UDF/标记暗示有图，但 attachments 空且 content 无图链（需确认现有列/UDF，不确定则 13B 标 `deferred`） | deferred |
| **C5** `orphanFileOnDisk`（可选） | 磁盘有文件但不在 manifest；全盘贵，默认 **不做** 或离线脚本 | deferred / offline |

**本轮必须实现：C1 + C2 + C3。** C4/C5 可 `notes` 标明未扫。

---

## 3. 抽样策略（防 958MB 机打满盘）

推荐默认：

1. SQL：最近带附件的消息（`attachments IS NOT NULL AND attachments != '' AND attachments != '[]'`）`ORDER BY created_at DESC LIMIT 50`（N 可配置，默认 50）。  
2. Manifest：全量读 JSON 后，对抽样涉及的 `message_id` / `local_path` 做存在性检查；若 manifest 极大，可只检查与抽样相交的条目 + 再随机抽 20 条 manifest 行做 C2。  
3. **禁止**默认递归扫全部 `data/media/zhao` 百万级文件。  
4. `notes: "sampled_only"`；全量模式仅 `CONSISTENCY_FULL_SCAN=1` 或独立 offline 脚本。

---

## 4. 路径解析规则（实现时注意）

- `attachments` 可能是：URL 数组、对象数组、`{url, local_path}` 混合——实现需 **宽容解析**，解析失败记 C3，不抛垮探针。  
- 本地路径可能是相对仓库根、或已是绝对路径；统一 `path.resolve(projectRoot, …)`。  
- Windows/本地单测 vs Linux GCP：单测用临时夹具目录，勿写死盘符。  
- URL-only 附件且从未下载：可记 `skipped_remote_only` 计数，**不**算 C1（避免假阳）。

---

## 5. 与 `/health` / 看板

- 字段名：`subsystems.dataConsistency`（见 `docs/p2-13-task-split-parallel.md` §2）。  
- overall：仅抬 **warn**，不单独 503。  
- monitoring 第 10 格：`data-subsystem="dataConsistency"`（Cursor 13D）。  
- 告警：优先复用 Supervisor / alert-sink 边沿；外部 bash 可选（13E）。

---

## 6. 误报边界（必须写进契约）

| 场景 | 期望 |
|---|---|
| 休市 / 无新图 | `ok`，`checked=0` 或仅历史样本仍一致 |
| 正在下载中的媒体 | 允许短窗口不一致；TTL 缓存 ≥60s 降低抖 |
| manifest 文件缺失 | `warn` + description，勿 critical 除非同时大量 C1 |
| READONLY / DB 打不开 | `unknown` 或 `warn`，description 说明，不抛 500 打挂 `/health` |

---

## 7. 验收（给 13C）

- [ ] 夹具：造 1 条 DB 附件指向不存在文件 → status≥warn，categories.C1≥1  
- [ ] 夹具：manifest 指不存在路径 → C2≥1  
- [ ] 夹具：坏 JSON attachments → C3≥1  
- [ ] 默认抽样不扫全盘（单测断言未调用全树 walk，或超时预算）  
- [ ] 零写库、零 pm2  

---

## 8. 非本轮

- Persona/L2a/News **新鲜度**（已有）  
- 水位单调性（可进 P2-13+）  
- 自动回填/重下图片  
