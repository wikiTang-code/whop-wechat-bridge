# Ticker Timeline Spec v0.1

状态：`draft` · 2026-08-31  
不解冻 `pipeline_tasks.l2b_cut paused:2064` · 不跑 14B · 不写 `known_kids_registry.json` · 不进 exec

---

## 0. 用户原声（需求本身，不改写）

1. 基于标签树 / 时间树等资产，切一份**个股分析演进表**。
2. 以特斯拉为例：从 2025-10 到最近，按时间轴追索赵哥对该票的**分析与操作**。
3. 用户可随意查找任意个股、QQQ / SPY / SPX 等指数、ETF，看不同时期的规律、走势与适合打法。
4. **不能只有口播单**。讨论区 / 记录区答疑窗里的实时看法必须入轴。
5. 必须能**自动增量更新**，跟现有离线批次流水线接轨，不另起一套实时调模型。
6. 落地顺序：**先特斯拉族（TSLA + TSLL）成功一版** → 再覆盖全部标的、指数、板块（有色金属、币、石油等）。

---

## 1. 定位：view 层，不是新的 L2a / L2b 抽取

| 层 | 干什么 | 不干什么 |
|---|---|---|
| raw | 原消息 + 真图 | 不总结 |
| L2a | 某日某票 FILL / PLAN | 不升为「规律」 |
| L2b | 可复用口诀 | 不写成该票订单 |
| **ticker_timeline** | 按 canonical 标的把上面串成时间轴 | 不自动生成「适合打法」结论 |

「规律 / 适合打法」只能是：**该时段命中了哪条 L2b kid + 同期实际加减仓 + 答疑看法**。  
模型月度摘要 ≤40 字且必须挂 `event_id`，默认折叠。发现新规律必须先进 L2b `proposed`，不允许在时间轴页现现编。

---

## 2. 主键与别名

- 用户搜的是语义标的，库里是代码 / 中文 / 口误。
- TSLA 与 TSLL **分两条轴**，页面用「同标的族」跳转；正股 / 2x / 期权不合并。
- 一条消息可挂多个 canonical（「tsll 出一半 + 看 qqq 转弯」 → TSLL 轴 + QQQ 轴各一条）。
- 别名表：[`data/refs/ticker_aliases.json`](../refs/ticker_aliases.json)。v0.1 先锁特斯拉族 + 指数 + 常用票，全市场覆盖等样板过关。
- 扫描命中不到 canonical 的词 → `unresolved_mention`，**不上轴**。

---

## 3. 四路事件来源（答疑是主路之一）

| 来源 | 典型内容 | kind |
|---|---|---|
| L2a cleaned（1195 + incr） | 加了 / 出一半 | `FILL` / `PLAN` |
| **讨论区 / 记录区答疑** | 群友问「CONL 能拿长线吗」赵哥回「仓位可以了，3.9–3.8 再加均摊」 | `VIEW` / `LEVEL` |
| L2b hits + 20a/20b proposed + 公式区 | 一半回撤、二次握手、缺口只做一次 | `PLAYBOOK` |
| 真图帖 | K 线 + 同帖口播 | `CHART` |

答疑规则：

- 只收赵哥句；群友问句作 `prompt_span` 挂同一事件。
- 必须命中 canonical；抽不出不上轴。
- `VIEW` 允许没价格；出现价位 / 缺口 / 一半公式 → `LEVEL`。
- **禁止把答疑写成 FILL**。
- 扫 `messages` 用别名，**不限定买卖动词**，否则答疑会整段失踪。

---

## 4. 事件 schema

```json
{
  "event_id": "tl_TSLL_20260304_post_1CYiBio1Ki9rFfzqMidBh9",
  "canonical": "TSLL",
  "family": "TSLA",
  "et_date": "2026-03-04",
  "et_time": "09:19:08",
  "source": "qa_window | l2a_action | l2b_hit | formula | chart | raw_mention",
  "kind": "FILL | PLAN | VIEW | LEVEL | PLAYBOOK | CHART",
  "prompt_span": "群友问句，可空",
  "evidence_span": "赵哥原文连续子串",
  "statement": "可选，一句口诀，禁止加教辅词",
  "l2a": { "action": "SELL", "price": 17.55, "status": "planned" },
  "kid": "k_half_retrace_watch | pending_new | null",
  "cu_id": "",
  "post_id": "post_1CYiBio1Ki9rFfzqMidBh9",
  "feed_id": "",
  "image_path": null,
  "image_sha": null,
  "do_not_use_as_order": true
}
```

硬锁：

- 每条 `do_not_use_as_order: true`。
- 时间轴页**没有 ack 下单**；ack 仍只在 L2a 待审池。
- `evidence_span` 必须是 `messages.content` 连续子串。
- 幂等键：`canonical + post_id + kind`（同帖多 ticker 允许多行）。

---

## 5. 时间树呈现

按美东交易日聚合，不按 CU。

```
TSLL
  2025-10
    LEVEL   18.8≈第一轮 19.2 分批回吸
    VIEW    周末跳涨按周五盘后低点回买
  2025-12
    PLAYBOOK  (23.18+14.81)/2 一半位置
    PLAYBOOK  盘后总仓≤7 成
  2026-03
    LEVEL    (13.55+23.6)/2=18.55，派息后 17.55 出一半
  2026-07+
    FILL/PLAN 来自 L2a 增量
    VIEW      答疑窗实时看法
```

页面三块：

1. 本期结构：最近 20 个交易日操作 / 口诀 / 答疑 / 关键价
2. 历史轨迹：月 → 日展开，每条可展 raw
3. 命中打法：去重 kid 列表，点开跳首次原文

「适合打法」写成：

> 2026-03 公式区对 TSLL 用的是一半回撤；2026-07 整数急跌买回出现在 CRWV，不是 TSLL。

禁止写「TSLL 应该用急跌买回」。

路由（样板过关后）：`/ticker_timeline.html?symbol=TSLL`  
不塞进当前 L2a 三列工作台。

---

## 6. 增量：挂 L2a 阶段 E，不新开模型夜跑

```
Whop 新消息入库
    → L2a 增量批次（广播跟单切窗 + 14B + 清洗）     → FILL/PLAN
    → L2b 知识增量（全量仍暂停）                         → PLAYBOOK
    → ticker_index_incr                                        → 本层
         输入：本批次新 messages + 本批 L2a cleaned + 本批 L2b hits
         输出：data/runs/ticker_timeline/incr_{run_id}.jsonl
         合并：canonical+post_id+kind 幂等 upsert
    → Web「同步到最新离线批次」同时 reload 时间轴缓存
```

约束：

- Web 按钮 **不调模型**。
- 答疑增量 = 新 messages 别名扫描 + 赵哥句切片，**默认规则抽取，不上 14B**。
- 水印与 `l2a_watermark` / `l2a_incr_latest` **共用**，禁止第三套时间戳。
- 1195 基线只读；7–8 月跟 `20260828_incr01` 一起建第一版轴。
- 某批 L2a 未跑完：时间轴仍可先吃 raw + 答疑；FILL 等清洗后补，页面标 `actions_pending_batch`。

---

## 7. 落盘路径

```
data/refs/ticker_aliases.json
data/runs/ticker_timeline/
  baseline_scan.jsonl          # 历史 messages 一次扫描（含答疑）
  from_l2a.jsonl
  from_l2b.jsonl
  merged/TSLL.jsonl
  merged/TSLA.jsonl
  incr_{run_id}.jsonl
  coverage_tsla_family.md      # 答疑条数 vs 口播条数
```

---

## 8. v0.1 只做特斯拉族

扫描器必须通用（换 canonical 就能出轴），但 **本阶段只交**：

- `merged/TSLA.jsonl` + `merged/TSLL.jsonl`
- 时间跨度：2025-10-01 → 当前水印
- 覆盖报告必须分列：`qa_view` 条数、`l2a_fill/plan` 条数、`playbook` 条数、`unresolved` 条数

验收两行：

1. TSLL 轴上 **答疑 VIEW/LEVEL > 0**（不能只有出货单）。
2. 轴的最新 `et_date` 与工作台「基础库存截止 / 增量批次」日期徽章一致。

未过关不开 QQQ 全量，不开有色 / 币 / 石油板块。

---

## 9. 后续覆盖顺序（样板通过后）

1. QQQ / SPY / SPX
2. 常用跟单票：NVDL / HOOD / CRWV / CONL / BULL / LITE / GOOGL
3. 板块桶：有色金属、币（COIN/CONL/MSTR）、石油、半导体、储存 — 桶是检索别名，不是把多票合成一条轴
4. 别名表扩展只增 JSON，不改扫描器

---

## 10. 工程禁停

- 不解冻 2064 L2b 全量
- 不为时间轴跑 14B
- 不写 registry
- 不进 exec / 不改券商 exit code 2
- 不把 skip 战法卡的单票算例从时间轴删掉（它们仍是该票历史看法）
