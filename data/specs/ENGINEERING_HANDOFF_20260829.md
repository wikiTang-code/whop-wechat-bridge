# 工程同步稿（2026-08-29）

> 对象：工程 agent + Grok 下一步分工  
> 范围：广播增量 8 月启动至今已冻结方案、工作台实机验收遗留、知识层未开工项  
> 原则：不重抽 1195；不改广播 pipeline 口径；Web 点击路径不调模型；fills 保持 exit 2

---

## 一、已落地（禁止改路径、禁止覆盖）

| 资产 | 路径 | 状态 |
|---|---|---|
| 基线 L2a | `data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl` | **只读封档** |
| 增量切窗 | `data/samples/l2a_cu_20260828_incr01.jsonl` | 246 CU，广播 only |
| 增量 raw / cleaned | `data/runs/l2a_raw_20260828_incr01.jsonl` / `l2a_cleaned_20260828_incr01.jsonl` | A–E 已跑完 |
| 增量 L2b 撞表 | `data/runs/l2b_hits_20260828_incr01.jsonl` | 5 条，附属 |
| 指针 | `data/runs/l2a_incr_latest.json` | `has_incremental: true`，`latest_date: 2026-08-28` |
| 水印 | `data/runs/l2a_watermark.json` | `2026-08-28T16:47:24.129Z` |
| 总控 | `scratch/run_l2a_pipeline.js` | `--dry-cut` / `--full-run` / `--limit` |
| 规范 | `data/specs/L2A_OFFLINE_PIPELINE.md` | 五段 A–E |
| 工作台 | `/review_workbench.html` | reload 只读盘，禁止调 8080 |

广播口径（以后 dry-cut 必须保持）：

- 频道：`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`
- 时区：`America/New_York`
- `cu_id`：`cu_incr_{run_id}_{seq}`，禁止复用 `cu_trade_*`
- 说话人：`user_4yeplXgbguTu4`（不要只靠 `LIKE %赵哥%`）
- `--limit` **不得**写水印/指针；仅全量 parse 齐了才阶段 E
- LM：`127.0.0.1:8080` + prompt v3（system + user JSON），温度 0
- 清洗与 1195 同表：`TSLA` 仅当原文含 `tsll` 才 → `TSLL`；2x 锁定 `etf_2x`；`可以/挂` → `planned`；正股→2x 仅当原文出现杠杆名

246 看板口径：`parse_ok` 246/246 只表示 JSON 合法，**不宣称语义 100% PASS**。606 笔、567 filled / 35 planned、40 空窗。filled 偏多。00054 已手修进本批，禁止再堆 `fix_xxxxx.js`。

下次广播增量（水印之后）：

```bash
node scratch/run_l2a_pipeline.js --dry-cut --run-id YYYYMMDD_incr01
node scratch/run_l2a_pipeline.js --run-id YYYYMMDD_incr01 --full-run --limit 20   # 不推水印
# 抽检后再无 limit full-run，最后才 E
```

---

## 二、分层（名称不要混）

```
L0 messages
 → L1 CU
    → L2a envelope：候选动作（广播实盘口播），默认不可下单
    → L2b atom：战法/纪律（无下单价）
         赵 kid + 周 18 原子（周 hint_only）
 → exec：跟/不跟/仓位（规格有，产线无）
 → view：工作台必须能回到原文
```

- 广播 L2a = 跟单原料。246 就是这个。
- L2b ≠ 全频道 L2a。全频道切窗抽动作仍叫 L2a；抽可复用纪律才叫 L2b。
- exec = 闸门，不是 K 线回测引擎。
- 主站旧 Tab（画像、万字日报、7 大战法、模拟仓、「实时跟单同步」）不读 cleaned jsonl。「实时跟单同步」文案不得写触发下单。

---

## 三、硬性：L2a / L2b 都必须挂原文 + 后台映射

后续无论抽 L2a 还是 L2b，**每条结构化记录必须能跳回完整原文**（含图）。只留 `condition` 短句不算交付。

### 3.1 后台映射（必须落库或落盘索引）

每条 L2a action / L2b hit 至少含：

| 字段 | 含义 |
|---|---|
| `cu_id` | 窗 |
| `source_message_ids[]` | 该动作/原子用到的 `messages.id` |
| `raw_text` | 该 CU 全文（可与 CU 文件重复，接口必须返回） |
| `evidence_span` | 触发抽取的连续片段 |
| `media[]` | `{ message_id, local_path, sha256 }`，缺图标 `media_missing` |

建议表：`asset_source_map(asset_kind, asset_id, cu_id, message_id, span_start, span_end)`  
便于纠错：改一条映射或标 `human_corrected`，不必重跑整批 14B。

### 3.2 工作台展示

- L2a 左列 / 待审卡：折叠「原文」，默认可见前 200 字，展开全文。
- L2b 徽章：点开即 `evidence_span` + 所属 CU 原文，禁止只显示 kid 名。
- 点左列卡片：展开原文 + `GET /api/l2b/gates?cu_id=`；默认禁止灌全局 25 条。
- 消息流坏图（`?` 占位）按知识层下载规范修，不在点击路径调模型。

---

## 四、工作台实机验收（2026-08-29）遗留 — 工程下一步优先

用户已确认：reload 成功，日期到 8-28，增量 +246，左列可见 `cu_incr_*`，券商条仍为 exit 2。

| ID | 问题 | 验收标准 |
|---|---|---|
| W1 | `GET /api/review/queue` 不读 ack 日志。7-02 点「核准确认」变灰（文案 human_verified / 零实盘打单），**刷新后卡片回来** | queue 排除 `l2a_human_verified_actions.jsonl` 里已有的 `review_id`；刷新 7-02 不再出现已 ack 卡 |
| W2 | 待审卡只有 `condition` 短句。7-01 CRWV `planned`「急跌买回86」把「86.3加了三分之一」的解释句收成待跟单 | 卡上带完整 `raw_text`；同日同标的已有 filled 且价格接近（86 vs 86.3）→ planned **不进池** 或标「已被口播成交覆盖」 |
| W3 | 左列不可点、不展开原文、不联动右列。所谓「点急涨急跌看是否串出 LITE」当前 UI 做不到 | 点击 `cu_id` → 原文 + gates 过滤 |
| W4 | 右列恒为「赵哥战法徽章 (25)」全局列表，不随日期/CU 变 | 无选中 CU 时可显示当日 hits；选中后只显示该 `cu_id` |
| W5 | 8-10 左列 0 可以是真无广播窗，但页面无「当日 CU 数 / 空窗数」 | 日期旁显示：该日 incr+base 的 CU 数、有动作数、空窗数，避免当成抽失败 |
| W6 | 正股/2x 映射 | `NVDA→NVDL` 等仅当原文出现杠杆名时再生效，抽检写入 changelog |

不要为 W1–W5 重跑 246 的 14B。只改路由、queue 规则、前端。

纠错工作流（有了 3.1 映射之后）：

1. 用户在卡上标「失真 / 覆盖」；
2. 写 `data/runs/l2a_human_corrections.jsonl`（`review_id`, `cu_id`, `reason`, `decision`）；
3. 清洗或 queue 规则下次跑批读取该文件（幂等）。

---

## 五、知识层（工作台 W1–W3 补完后再开）

目标：全频道赵哥的**判断 / 答疑 / 日历纪律** + 配图，形成可回测框架。  
**禁止**对讨论区再跑 L2a 动作 schema。

周哥自称来自赵：只做对照附录，低优先级。对得上给赵 kid 打 `also_seen_in: mrzhou`；对不上 `zhao_unattested`。禁止把周的 PCR/VIX/±15% 写进赵 statement。

1. 新脚本 `scratch/run_l2b_knowledge_pipeline.js`，勿改广播 `run_l2a_pipeline.js`。
2. 切窗：全频道减去已进 L2a 的广播窗；锚点 `user_4yeplXgbguTu4`；前 3 + 后 2；同日同 session；`cu_id=cu_know_{run_id}_{seq}`。先 `--dry-cut` 报窗数。
3. 图：`data/media/zhao/{et_date}/{message_id}_{i}.jpg`，CU 写 `media[]`。dry-cut 抽 20 窗，文件数 ≈ `[IMAGE:]` 数。缺图标 `media_missing`，禁止脑补图上的价。OCR 仅检索辅文。
4. 抽取：`knowledge_atom_extract_prompt`；输出 kid / statement / evidence_span / source_message_ids / `do_not_use_as_order: true`。先撞已封 25 条；未命中进 `candidates_kids.json`，人工点头才进 registry。先 20 窗。
5. 只有能写成价/时间/持仓条件的 statement 才进 `strategies/` 用 K 线回测；否则只读 L2b。回测与周隔离目录分开。跟单一致性 ≠ 账户曲线。

「整数位急跌买回」= L2b 纪律；「86.3加了三分之一」= L2a filled。禁止再把前者单独送进待审池。

---

## 六、明确不做

- Web 点击路径调 8080 / 1234
- 覆盖 1195 文件
- 讨论区 L2a 动作夜跑
- 未人工放行 `place_order`；fills exit 2
- 90s TTL 挂历史库存
- 用周参数补全赵没说过的公式
- 并行战法看板 2.0 / 把日报当策略层
- 每窗一个 `fix_xxxxx.js`

---

## 七、分工顺序

**工程先做（本文件第四节 W1–W5 + 第三节原文映射）：**

1. queue 扣除已核 `review_id`；
2. L2a/L2b API 返回 `raw_text` + `source_message_ids`；待审卡 / 徽章可展开原文；
3. 同日同标的 filled 覆盖 planned；
4. 左列点击联动 `cu_id`；右列默认不灌 25 条；
5. 正股/2x 映射收紧并提交。

**用户再验：** 刷新 7-01（CRWV 待审应降级并可见 86.3 原文）、7-02（已 ack 不再出现）。

**Grok：** 工作台补丁审 diff；知识层脚本出现后再审 dry-cut 与 20 窗 L2b。

**双方暂缓：** exec 产线、券商、全频道 14B、周映证全表。
