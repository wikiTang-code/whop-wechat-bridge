# L2b 金标规范（2026-08-29）

当前任务 = **人工/Grok 可复核的金标种子**，不是 5807 窗夜跑，也不是已作废的 `l2b_knowledge_sample_20_strict.json`。

## 0. 现状（不要说图文已全）

- 清单 1289 ≠ 真图。唯一 SHA ≈ 80，其中大量 <15KB 占位图。
- 发布区 / 记录区几乎没有可用原图。
- 已作废：`sample_real_image_*` 循环模板、教辅腔 statement（10%、IV Crush、MACD、90 分位）。
- 金标 **只收**「赵哥原句是 evidence_span 的子串」的条目。

## 1. 一条金标必须有的字段

```json
{
  "gold_id": "g_zhao_001",
  "kid": "k_second_handshake",
  "status": "gold",
  "do_not_use_as_order": true,
  "source_message_ids": ["..."],
  "et_date": "YYYY-MM-DD",
  "channel_id": "forum_feed_... or chat_feed_...",
  "raw_text": "该窗完整原文",
  "evidence_span": "必须是 raw_text 的连续子串",
  "statement": "只用原文词汇改写成可复用纪律，禁止新增数字/指标名",
  "chart_notes": {
    "timeframe": "intraday|daily|unknown",
    "markers": "箭头/切线/无",
    "aligns_with_text": "match|partial|unreadable|no_image",
    "local_path": "有真图才填，占位图填 null"
  },
  "not": ["不得写成的 L2a 动作"]
}
```

`statement` 禁词（原文没出现就不得写）：`10%` `IV Crush` `Theta` `MACD` `90分位` `洗盘` `诱多` `多头排列`。

## 2. 已核种子（可进金标集；缺 message_id 的由工程从 messages 回填）

### G1 金样 A — 波动值定顶底（用户截图）
- 原文：「知道了波动值 卖在最高就根本不用慌」「底部区域心理有数了 急跌就有从容不迫又能接回」
- statement：先用波动值标出当日高/低；卖在已标定的最高附近，底区急跌才接。
- chart_notes：分时，箭头指冲高失败的尖（约 7512），现价约 7474，黄均线约 7495；`aligns_with_text=match`（有真图才算金标完成）。
- not：`SELL/BUY SPX`

### G2 金样 B — 尾盘 V 看期权盈亏（用户截图）
- 原文：「是不是今天强平的V多」「大多数期权都失败了才会3点50V多」「要看期权盈亏比例」
- statement：尾盘 V 不是无条件抄；要看期权是否大量作废/盈亏比；时间锚约 15:50。
- chart_notes：箭头指 V 最低折。
- not：`BUY SPX`、15:50 无条件多

### G3 急跌买回是纪律，成交是另一条 L2a
- 原文：「急跌急涨就 异动多出 急跌买回 像今天crwv急跌又是整数86就会买回来」
- 另句 L2a：「86.3加回了三分之一常规仓的crwv」（**不要**写成第二条 L2b 订单）
- statement：急涨急跌先看异动出；整数位急跌才买回。
- kid 建议：`k_dip_buy_round_number`（新 kid 先 proposed，点头再进 registry）

### G4 二次握手 + 没利润垫不留
- 原文：「主要hims就是今天财报二次握手博弈 没利润垫的就不要留了」
- statement：财报用二次握手做博弈；没有利润垫就不要留过夜/过事件。
- kid：`k_second_handshake`（已有）+ 利润垫只写原文「没利润垫」，禁止改成 10%。
- not：无价的 `SELL HIMS` 清仓单

### G5 被动减
- 原文证据 span 须含「被动减」（4-28 工作台已见：明天盘后大盘股财报、夜盘盘前被动减持、回踩低点）。
- statement：大盘股财报窗口，预期被动减，回踩不同板块低点再看，不要写成市价卖单。
- kid：`k_passive_redeem_then_rebuy`

### G6 期权走了（记录区真句）
- 原文：「meta期权也吃磨损了 开盘0.6都走了」
- L2a：`SELL META option @ 0.6 filled_speech`
- L2b statement：期权吃磨损就走，不要死拿。禁止补 Theta/到期日公式。

### G7 挂了点 = planned 不是金标买点公式
- 原文：「rddt 118.5挂了点」只进 L2a planned，不进 L2b「必须挂单」总则。

## 3. 工程如何「多加」金标（不要再生成 20 条散文）

从 `l2b_cu_20260829_know01.jsonl` 里筛：

- `xiaozhaolucky` +（二次握手|被动减|急跌买回|波动值|整数|利润垫|磨损|V多|期权盈亏）
- 有 `media.status=ok` 且文件 sha 不在占位图集合（0804573d / 5f4dd331）

每条只填：raw_text、evidence_span、拟 statement（不超过两句、只用原文词）、chart_notes.aligns_with_text。  
一次最多交 **5 条** 新 proposed，等 Grok/用户点头改 `status: gold` 再进 `known_kids_registry.json`。

## 4. 明确不做

- 用占位图或 `sample_real_image_*` 打标签
- statement 添加原文没有的阈值
- 把金标当 L2a 订单
- 5807 窗自动金标
- 周原子写入赵 gold
