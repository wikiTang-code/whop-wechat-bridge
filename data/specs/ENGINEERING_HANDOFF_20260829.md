# 工程同步稿（2026-08-29）

> 对象：工程 agent + Grok  
> 原则：不重抽 1195；不改广播 L2a pipeline 口径；Web 不调模型；fills exit 2

---

## 一、已落地

| 资产 | 路径 | 状态 |
|---|---|---|
| 基线 L2a | `data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl` | 只读 |
| 增量 L2a | `data/runs/l2a_cleaned_20260828_incr01.jsonl`（246 CU） | 已进工作台 |
| 增量 L2b 短语 | `data/runs/l2b_hits_20260828_incr01.jsonl` | W8 已合并进 gates |
| 指针/水印 | `l2a_incr_latest.json` / `l2a_watermark.json` | 截止 2026-08-28 |
| 工作台 | `/review_workbench.html` | W1–W8 已部署；用户实机见 §4 |

---

## 二、分层

L2a = 候选动作（默认不可下单）。L2b = 战法原子。exec = 闸门（无产线）。  
**同一段原文可以同时有 L2a 和 L2b。** 窗数 ≠ 动作笔数 ≠ 战法命中数。

---

## 三、原文 + 看图 + 金样

L2a/L2b 记录必须回指 `raw_text`、`source_message_ids`、原图。  
知识抽取输入 = 口播全文 + **原图像素**，禁止只 OCR。`chart_notes` 不上订单。  
金样 A：SPX 箭头指冲高失败 +「卖在最高/底区再接」→ L2b，禁止 SELL/BUY SPX。  
金样 B：箭头指 V 底 +「3:50 V 多看期权盈亏」→ L2b，禁止无条件抄底。

---

## 四、工作台验收（已收）

W2/W3/W5 实机过（7-01 CRWV 计划单被 86.3 成交覆盖；展开原文；当日 CU 徽章）。  
W4：4-28 全天 1 条被动减；点 CONL 成交卡右列变 0（战法不在该窗）。  
W7/W8：工程已推空窗灰卡 + 合并 incr hits + 徽章反跳；用户称手机已验。  
W1 未在有黄卡的日子复测，不挡知识层。

口径：4-28 的 `CU:5 / 动作窗3 / 空窗2` + 左列 5 笔 = 3 窗拆出 5 单；空窗 ≠ 战法条数。

---

## 五、知识层（以本节为准，覆盖此前「去掉广播窗」的错误说法）

### 5.1 广播也要抽原子

不要排除广播原消息。已进 L2a 只表示动作层有了，知识层仍要扫这些话。

例：同一段广播  
- 「86.3加回了三分之一…crwv」= L2a filled（已有）  
- 「急跌买回，整数 86 就会买回来」= L2b 纪律（要补）

禁止：讨论区套 L2a 动作 schema；L2b statement 进待审池。  
去重：`(kid, statement)`，不是把广播 `message_id` 拉黑。

### 5.2 开窗与 L2a 不同

L2a：gap≤20min / ≤8 条，为拆买卖，会拆开规则句和成交句。  
知识窗：判断 + 配图 + 紧挨的成交口播必须同窗。主键 `cu_know_{run_id}_{seq}`，可写 `related_l2a_cu_ids[]`。

- **K-广播**：锚点 = 赵哥含图或判断/答疑口吻的消息；同频道同日同 session，前 3 + 后 2（可含成交句）。
- **K-讨论**：锚点 `user_4yeplXgbguTu4`；前 3 + 后 2（可含群友问句）；同日同 session。

### 5.3 图全量下载（本批硬交付）

知识 CU 内所有 Whop 图 + 已有 L2a 窗里的图都要落到  
`data/media/zhao/{et_date}/{message_id}_{i}.jpg`。  
`media[]`：`local_path, sha256, status=ok|missing`。过期链刷新后再下。  
`--dry-cut` 必报应下/成功/missing。missing 高则先修下载，不准开模型。

### 5.4 命令

```bash
node scratch/run_l2b_knowledge_pipeline.js --dry-cut --run-id 20260829_know01
```

产出：`data/samples/l2b_cu_20260829_know01.jsonl`（禁止 BUY/SELL 字段）+ `data/media/zhao/**`。  
不写 L2a cleaned、不推 l2a 水印、不调 8080。  
看板：K-广播 CU 数、K-讨论 CU 数、图成功/缺失。20 窗图齐（尽量含金样 A/B 与 CRWV 急跌买回）再多模态抽 L2b。

---

## 六、不做

点击路径调模型；覆盖 1195；讨论区 L2a 夜跑；看图直接下单；OCR 冒充看盘；把广播从知识层剔除。

---

## 七、现在就做

工程：`run_l2b_knowledge_pipeline.js` + 全量下图 + `--dry-cut` 看板。  
Grok：审切窗口径与缺图率。  
用户：等看板数字，暂不必点工作台。
