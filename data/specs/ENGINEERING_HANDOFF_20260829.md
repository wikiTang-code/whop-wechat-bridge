# 工程同步稿（2026-08-29）补丁：知识层范围纠正

> 本文是对同文件第五节的**覆盖性纠正**。工程 agent 以本节为准，不要再执行「去掉已进 L2a 的广播窗」。

---

## 纠正 1：广播频道要抽 L2b，不是排除

「不要把讨论区再跑一遍 L2a 动作模型」≠「广播原文不再做知识抽取」。

同一段广播可以同时产出两种资产：

| 句子 | 资产 |
|---|---|
| 「86.3加回了三分之一常规仓的 crwv」 | L2a `BUY CRWV @ 86.3 filled_speech`（已有） |
| 「急跌急涨就异动多出、急跌买回，整数 86 就会买回来」 | **L2b 纪律**（现在缺的） |

因此：

- **原料 = 赵哥全频道**，含 `forum_feed_1CTr7SqVMzFfuFiiRJLEHN`。
- 已进 L2a 的是「动作层结果」，**不删除这些消息，也不禁止再切知识窗**。
- 禁止的是：对讨论区套 L2a 动作 schema、或把 L2b statement 再送进待审池当 planned。

去重键是 `(kid, statement)`，不是 `message_id` 黑名单。

---

## 纠正 2：知识开窗 ≠ L2a 开窗

L2a 广播规则（同日同 session、gap≤20min、≤8 条）是为了拆买卖单，会把「规则句」和「成交句」拆开（CRWV 失真就是这样）。知识窗必须把 **判断 + 配图 + 紧挨着的成交口播** 留在同一窗里当上下文。

建议两套切法，都写 `cu_know_{run_id}_{seq}`：

**K-广播（知识用，不是替换 1195/246）**

- 锚点：赵哥消息，含图、或含判断/答疑口吻（急跌买回、被动减、波动值、V 多、握手…），不要求有买卖动词。
- 上下文：同频道、同 ET 日、同 session，锚点前 3 + 后 2（可含他自己的成交句）。
- 目的：金样 A/B、「急跌买回」+「86.3加了」同窗。

**K-讨论区**

- 锚点同样是 `user_4yeplXgbguTu4`。
- 前 3 + 后 2（可含群友问句），同日同 session。

不要复用 `cu_incr_*` / `cu_trade_*` 当知识主键；可在知识 CU 上写 `related_l2a_cu_ids[]` 方便对照。

---

## 纠正 3：图必须全量落地（本批硬交付）

凡进入任一知识 CU 的消息，正文里的 `[IMAGE:url]` / Whop 图：**全部下载**，缺一记 `media_missing`。

- 路径：`data/media/zhao/{et_date}/{message_id}_{i}.jpg`
- CU.media[]：`message_id, url_original, local_path, sha256, status=ok|missing`
- 过期链走现有 cookie / `/api/proxy-image` 同源刷新后再下；失败不得用 OCR 字符串冒充已看图。
- `--dry-cut` 看板必出：应下张数 / 成功 / missing。missing 高则先修下载，不准开多模态抽取。
- 广播 1195+246 里已有的图也要补下（工作台展开原文要能看图），不限于讨论区。

---

## dry-cut 命令（替换此前错误指令）

```bash
node scratch/run_l2b_knowledge_pipeline.js --dry-cut --run-id 20260829_know01
```

产出：

- `data/samples/l2b_cu_20260829_know01.jsonl`（禁止出现 BUY/SELL 动作字段）
- `data/media/zhao/**`
- 控制台：消息数、K-广播 CU、K-讨论 CU、图应下/成功/missing、日期跨度

不写 L2a cleaned、不推 `l2a_watermark`、不调 8080。

20 窗图齐（尽量含金样 A/B 与 CRWV「急跌买回」类）后再开多模态 L2b。
