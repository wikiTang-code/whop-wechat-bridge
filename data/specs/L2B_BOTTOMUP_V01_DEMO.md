# L2b bottom-up v0.1 示范（Grok，2026-08-30）

对照工程 `data/runs/l2b_bottomup_v0.json`（attached=19、similarity=1 撞原句）。
本示范：**字 2-3gram Jaccard 贴 9 个锚点**，同一 footer 只计 1 模板。不是神经 embedding，不是 14B。

## 口径

- 语料 `zhao_messages_export.jsonl` N=12124
- L2a 丢掉：同时有 ≥2 个小数价 + 出/加/买/卖，且没有 比如/要素/口诀/握手/靴子/被动减/总仓/腰斩/高低切/只做一次/整数
- 吸附阈值 Jaccard≥0.10（相对短锚点文本，不是 0.82 embedding）
- 离群：剩余句按去数字/代码后的 footer 去重，再 Jaccard≥0.30 聚模板

## 和工程 v0 的差别

| | 工程 v0 | 本示范 |
|---|---|---|
| attached | 19（几乎全是 14 条原文复制） | **183 条不同消息** 贴上锚点 |
| 握手 | 只撞到原帖 | 15 条 |
| 一半/高低切 | 未扩 | 134（**过宽**：「一半」单字把出一半成交吸进去） |
| 离群 | 同一 footer 复制当 19 条新课 | 模板去重后再看 |

## 吸附条数

- k_half_retrace_watch 134 ← 过宽，仅作反例
- k_second_handshake 15
- k_passive_redeem 13
- k_dip_action 8
- k_cut_in_half_100 4
- k_gap_intraday_once 4
- k_cost_exit_last_batch 3
- k_shoe_drops_settlement_rebound 2

## 真盲区：7 成仓位（从库检索，36 命中 / ~22 模板）

1. `7成要低位配置拿开门后反弹 3成尾盘买夜盘出做T` (2025-11-07 `post_1CUtztEbZQsmwc6nqyKT4e`)
2. `维持7成死拿开门 3成做T` / `激进可以9成死拿 1成机动` (11-07)
3. `盘后所有股票加起来总仓位不要超过7成 周一万一有回踩还要有做T资金` (2025-12-12，多标末尾同句，**只算 1 课**)
4. `本金减1-3成 维持7成还没到成本的` (2026-03-23)
5. `可以6-7成 要3成防止26底再压` (2026-06-24 `post_1CcNYQvyww34jJhRmjAuhv`)

可进地图 L3，不要按 ticker 复制 kid。

## 工程下一版

1. attached 必须远大于种子条数；similarity 全是 1.0 = 只撞了原句
2. 同 footer 复制 N 标的 → size=1
3. 新簋只交 1 条代表句 + template_copies
4. 锚点别用孤立「一半」
5. 不要为离群簋起正式 kid
