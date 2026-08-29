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
 → view：工作台必须能回到原文+原图
```

- 广播 L2a = 跟单原料。246 就是这个。
- L2b ≠ 全频道 L2a。全频道切窗抽动作仍叫 L2a；抽可复用纪律才叫 L2b。
- exec = 闸门，不是 K 线回测引擎。
- 主站旧 Tab 不读 cleaned jsonl。「实时跟单同步」文案不得写触发下单。

---

## 三、硬性：L2a / L2b 都必须挂原文 + 后台映射

后续无论抽 L2a 还是 L2b，**每条结构化记录必须能跳回完整原文与原图**。只留 `condition` 短句或只 OCR 出的字不算交付。

### 3.1 后台映射

| 字段 | 含义 |
|---|---|
| `cu_id` | 窗 |
| `source_message_ids[]` | 该动作/原子用到的 `messages.id` |
| `raw_text` | 该 CU 全文，接口必须返回 |
| `evidence_span` | 触发抽取的连续文本 |
| `media[]` | `{ message_id, local_path, sha256, chart_notes? }` |

建议表：`asset_source_map(asset_kind, asset_id, cu_id, message_id, span_start, span_end)`。纠错标 `human_corrected`，不必重跑整批 14B。

### 3.2 工作台展示

- L2a 左列 / 待审卡：折叠「原文」，默认前 200 字，展开全文 + 缩略图。
- L2b 徽章：`evidence_span` + CU 原文 + 该窗图片。
- 点左列：展开原文/图 + `GET /api/l2b/gates?cu_id=`；默认禁止灌全局 25 条。

### 3.3 配图必须「看盘」而不是只读字（知识层硬约束）

赵哥常用截图+箭头说明判断。OCR 只能扫到部分数字/标题，**读不到**：

- K 线形态（上影、吞没、缺口、均线缠绕）
- 手绘箭头 / 圈 / 切线 / 支撑压力
- 多图对比（日K vs 30m vs 盘口）
- 图上标的价与口播价是否同一件事

抽取规则：

1. 图先落盘再抽：`data/media/zhao/{et_date}/{message_id}_{i}.jpg`。缺图标 `media_missing`，该条证据降权。
2. 知识抽取输入 = **口播全文 + 原图像素**（多模态），禁止「只把 OCR 字符串塞进 14B 文本模型」。
3. 模型输出结构化 `chart_notes`（不上订单）：`timeframe` / `markers` / `levels_on_chart` / `aligns_with_text`（match|partial|conflict|unreadable）。
4. 口播与图冲突：`statement` 降为 `proposed`，禁止用图脑补 L2a BUY/SELL。
5. 工作台点开 CU 必须能看原图，不能只渲染 `[IMAGE:]` 或坏链 `?`。

14B 文本夜跑（当前广播 L2a）维持纯文本；**知识层必须多模态或「人工看图+模型填表」**，不得宣称 OCR 等于看懂盘。

### 3.4 金样（用户 2026-08-29 提供，知识层 20 窗抽检必测）

两例都是「图上箭头 + 口播判断」，抽成 L2b 纪律，**禁止**抽成 SPX 买卖单。

**金样 A — 波动区间：卖在箭头指的最高，底区再接**

- 图：`.SPX` 分时，现价约 7474.48（+0.23%），黄均线约 7495.5；红箭头指在冲高失败的尖（约 7512），随后砸到 7474。
- 口播：「知道了波动值 卖在最高就根本不用慌」「底部区域心理有数了 急跌就有从容不迫又能接回」。
- 应产出 L2b：先用波动值标定当日顶/底；箭头标出的高点才是「最高」；顶附近出、底区急跌才接。
- `chart_notes` 最低要求：`timeframe=intraday`，`markers=arrow_at_failed_high`，`levels_on_chart≈7512/7495/7474`，`aligns_with_text=match`。
- **禁止** L2a：`SELL SPX @ 7512` / `BUY SPX @ 7474`（没有「出了/加了」）。

**金样 B — 尾盘 V 要和期权作废/强平一起看**

- 图：`.SPX` 大跌日（截图可见 7529.82 -0.56% 量级），红箭头指在分时 V 的最低折；旁为期权/成分面板。
- 口播：「是不是今天强平的V多」「大多数期权都失败了才会3点50V多」「要看期权盈亏比例」。
- 应产出 L2b：尾盘 V 不是无条件抄底；需同时看期权盈亏比例/是否大量作废；时间锚约 15:50。
- `chart_notes` 最低要求：`markers=arrow_at_v_low`，`aligns_with_text=match`。
- **禁止** L2a：`BUY SPX` 或「15:50 无条件做多」。

工作台点开对应 CU：左文右图（或上文下图），原图保留箭头；statement 挂在旁边。这两张作为 `candidates` 金样写入抽检集，不必先有正式 kid 名。

---

## 四、工作台实机验收遗留 — 工程下一步优先

用户已确认：reload 成功，日期到 8-28，增量 +246，左列可见 `cu_incr_*`，券商条仍为 exit 2。

| ID | 问题 | 验收标准 |
|---|---|---|
| W1 | 7-02 ack 变灰，刷新卡片回来 | queue 排除已写日志的 `review_id` |
| W2 | 7-01 CRWV planned「急跌买回86」把「86.3加了」收成待跟单 | 卡上全文；同日同标的接近价 filled 覆盖 planned |
| W3 | 左列不可点、无原文 | 点击展开原文+图，gates 按 `cu_id` |
| W4 | 右列恒 25 条全局徽章 | 选中 CU 后只显示该窗 |
| W5 | 8-10 左列 0 无解释 | 日期旁显示当日 CU / 有动作 / 空窗数 |
| W6 | 正股/2x 映射过宽 | 仅原文出现杠杆名才映射 |

不要为 W1–W5 重跑 246 的 14B。

---

## 五、知识层（W1–W3 补完后再开）

目标：全频道判断/答疑/日历纪律 + **看图互证**。禁止讨论区套 L2a 动作 schema。

周对照附录低优先级：`also_seen_in: mrzhou` / `zhao_unattested`。禁止把周阈值写入赵 statement。

1. 新脚本 `scratch/run_l2b_knowledge_pipeline.js`，勿改广播 pipeline。
2. 切窗：全频道减已进 L2a 的广播；锚点 `user_4yeplXgbguTu4`；前 3 + 后 2；同日同 session；`cu_know_{run_id}_{seq}`。先 `--dry-cut`。
3. 下图 + §3.3/§3.4。20 窗验收：图文件数 ≈ `[IMAGE:]` 数；金样 A/B 必须在抽检集里，箭头与口播对齐。
4. 多模态抽取：kid / statement / evidence_span / source_message_ids / chart_notes / `do_not_use_as_order`。先撞 25 条；未命中进 `candidates_kids.json`。
5. 能写成价/时间/持仓条件的才进 `strategies/` 回测。跟单一致性 ≠ 账户曲线。

「整数位急跌买回」= L2b；「86.3加了三分之一」= L2a filled。

---

## 六、明确不做

- Web 点击路径调 8080 / 1234
- 覆盖 1195；讨论区 L2a 动作夜跑
- 未放行 `place_order`；fills exit 2；90s TTL 挂历史库存
- 只用 OCR 冒充看懂 K 线/箭头；看图直接生成 L2a 订单
- 金样 A/B 抽成 SPX 市价单
- 用周参数补全赵没说过的公式
- 每窗 `fix_xxxxx.js`

---

## 七、分工顺序

**工程先做：** W1–W5 + 3.1/3.2 原文映射（图先能打开）。金样 A/B 收入知识层抽检清单，不在本轮工作台补丁里抽模型。

**用户再验：** 7-01 CRWV 降级并可见 86.3 原文；7-02 已 ack 不回潮。

**Grok：** 审工作台 diff；知识层 dry-cut 与带图 20 窗（含金样 A/B）。

**暂缓：** exec、券商、全频道 14B 文本盲抽、周映证全表。
