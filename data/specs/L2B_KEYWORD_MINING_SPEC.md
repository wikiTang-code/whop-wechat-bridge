# L2b 关键词挖掘（先词表，再抽课）

语料：作者=赵哥，约 12687 条。不要用打油诗当 query。

## 抽词

- 中文：2～6 字连续串 + 已有词典（二次握手、被动减持、高低切、成本出、靴子落地、急跌买回…）
- 丢掉：纯数字、价格、ticker（2–5 位大写）、日期、单字、`的了是在和就`
- 同时统计：词频 `tf`；与动作词共现 `吸|出|减|加|回踩|低吸|开仓|平仓|做T` 的次数 `act`
- 动作句占比高的标 `looks_like_l2a`，降权当策略词

## 策略置信度（0–1，启发式）

```
score = 0.35*log(1+tf) + 0.35*log(1+act) + 0.2*is_phrase + 0.1*multi_month - 0.3*is_l2a_heavy
```

`is_phrase`：长度≥3 或已在种子/地图里。  
`multi_month`：出现月份≥3。  
`is_l2a_heavy`：同句带明确成交价的比例 >0.5。

人工标签（工程先自动再可改）：`regime` 周期 / `ruler` 尺子 / `sector` 板块仓 / `nature` 股性 / `gate` 执行闸 / `calendar` 日历 / `noise`。

## 产出

`data/runs/l2b_keyword_rank.json` 按 score 降序，前 200：

`term, tf, act, n_months, looks_like_l2a_ratio, score, bucket, example_message_id, example_span`

另附 `query_notes`：被丢掉的超高频噪声（如「今天」「盘后」）。

## 下一拍

Grok 按 score 前 30 里 bucket≠noise 的词，指定下一包抽哪 5 个词。每个词最多 5 条课，不写 registry。
