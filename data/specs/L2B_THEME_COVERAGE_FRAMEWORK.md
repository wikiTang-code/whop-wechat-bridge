# L2b 主题覆盖框架 v0（先出骨架，边扫边改检索式）

目标：全年赵哥 `messages` 按主题穷尽候选，不一次写完所有 statement，不训模型。

作者范围：`xiaozhaolucky` / 显示名含赵。频道：发布 forum、记录区、讨论区、期权、讨论区股票记录。7–8 月无图的纯文本同样扫。

## 产出（本轮只要这个）

1. `data/runs/l2b_theme_coverage_summary.json`
2. 每主题 `data/runs/l2b_theme_hits/{theme_id}.jsonl`（可先只写 summary + 每主题最多 30 条 sample）

summary 每行：

```json
{
  "theme_id": "passive_redeem",
  "queries": ["被动减"],
  "hit_count": 0,
  "date_min": null,
  "date_max": null,
  "already_seeded": ["g_zhao_005"],
  "sample_ids": []
}
```

jsonl 每行：`message_id, et_date, channel_id, hit_span, raw_text_excerpt(<=300字)`。不要 statement、不要新 kid。

## 主题目录 v0（可在扫完后增删）

| theme_id | 检索（AND 用空格表示文档说明；实现用正则） | 已有种子 |
|---|---|---|
| passive_redeem | 被动减 / 被动减持 | G5 G6 t_prop_006/007 |
| second_handshake | 二次握手 | G4 g_img_003 |
| profit_cushion | 利润垫 | G4 |
| gap | 缺口 | G7 t_prop_001 g_img_005 |
| turn | 转弯 | t_prop_003/004 g_img_002 |
| elasticity | 弹性股\|弹性大 | t_prop_003/004 |
| pullback_open | 盘前半小时\|开盘都会回踩\|回踩 | t_prop_002 |
| dip_buy | 急跌买回\|异动多出 | G3 unlocated |
| round_number | 整数.{0,8}(买\|接\|关注) | G3 g_img_005 |
| friday | 周五.{0,12}(多\|空\|仓\|平) 禁止单字周五 | 旧 registry |
| earnings | 财报 | G4 |
| option_theta | 磨损\|期权盈亏\|3点50\|V多 | G2 META |
| wave_value | 波动值 | G1 |
| nine_turn | 九转 | g_img_001 |
| half_retrace | 回撤一半\|一半回撤\|\\( .* \\+ .* \\)/2 | 旧 00361 |
| a_share_overnight | 上证.{0,20}(减\|夜盘)\|A股.{0,12}翻红 | 旧 00227 |
| look_turns_not_news | 消息都是阻碍\|到处找新闻\|只看转弯 | g_img_002 |
| second_confirm | 二次确认\|二次握手 已单列 | |
| ball | 皮球 | |
| quant_flow | 量化.{0,20}(大单\|遍历) | t_prop_005 |
| holiday_vol | 节前\|节后\|1\\.5倍 | t_prop_010 |
| wear_number | 磨损值 | t_prop_009 |

扫的时候若命中 >200 或 =0，把该查询记入 `query_notes`，下一轮改正则。禁止为了凑数放宽成单字。

## 明确不做

- 不写 statement、不进 registry、不开 14B、不跑 537、不开 CDP
- 不覆盖 `l2b_text_seeds_5_proposed.json` / `batch2`
- 成交句（出了/接了 @ 价）标 `looks_like_l2a` 可跳过，不进 hits 主表也可另存

## 下一拍（summary 出来之后）

按 hit_count 从高到低，每主题送审 5 条 sample。边审边改目录：该并的并，该删的删。
