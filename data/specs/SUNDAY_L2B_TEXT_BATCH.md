# 周日工单：历史文本 L2b 再抽 5 条（不依赖周一新图）

周一只验监听落盘。周日做历史文字。一次 5 条，`status=proposed`，`do_not_use_as_order=true`，不写 registry，不开 14B 全量，不跑 537，不开 CDP。

## 禁止重复的已有原句

不要再交这些 span：

- G4 `没利润垫的就不要留了`
- G5 `大陆这三天夜盘和盘前会被动减持`
- G6 `被动减每天股仓位一般分三份`
- G7 `注意 98 和90的位置`
- t_prop 6-26：`可以做2次` / `盘前半小时和开盘都会回踩` / `一般指数转弯 买些弹性大的` / `重点是转弯 低吸弹性股` / `遍历100个股票`
- g_img 口播原句（九转、675收盘、7339、法案轮廓、IREN 70跌46）

## 本批要换的主题与月份（各至少错开）

从 `messages` 搜赵哥 `xiaozhaolucky`，**日期不要全集中在 2026-06-26**。优先：

1. 二次握手 / 利润垫（G4 之外的另一天）
2. 被动减 / 缺口买一份（G5/G6 之外）
3. 周五 / 周末仓位（若原文有「周五」完整短语，不要单字命中）
4. 财报杀 / 盘后预期
5. 急跌买回 / 整数 / 异动多出（优先 2026-07 广播原文；找到则填 G3 的 message_id，把 G3 从 unlocated 拉起来）

找不到第 5 类就改抽「只看转弯 / 消息是阻碍」类，但不要与 g_img_002 同一句。

## 每条必填

```json
{
  "id": "t_prop_006",
  "kid": "k_snake_case_existing_or_new",
  "status": "proposed",
  "do_not_use_as_order": true,
  "source_message_ids": ["post_..."],
  "et_date": "YYYY-MM-DD",
  "channel_id": "forum_feed_... or chat_feed_...",
  "raw_text": "库内全文",
  "evidence_span": "raw_text 连续子串",
  "statement": "只用原文词，一两句",
  "chart_notes": { "aligns_with_text": "no_image", "local_path": null },
  "not": []
}
```

- kid 用 `k_`；能挂已有 kid 就挂（`k_second_handshake`、`k_passive_redeem_then_rebuy`、`k_turn_elasticity`），不要为同义再造一个。
- statement 禁：10%、IV、MACD、90分位、核心股票池、优先买入（原文没有就不要写）。
- 交 `data/samples/l2b_text_seeds_batch2_proposed.json`，一次最多 5 条。

## 验收

Grok 只看：span 是否子串、是否与已封原句重复、日期是否摊开、有无加戏。通过前保持 proposed。
