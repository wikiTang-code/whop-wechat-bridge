# L2b kid 撞表人工审计 (against 831be98)

Scope: `data/runs/l2b_zhao_kid_hits.jsonl` (32) + `data/runs/candidates_kids.json` (116).
Rule: token 「周五」 ≠ `k_friday_last_hour_v`. Evidence must be a contiguous KOL span that states the playbook.

## A. 32 hits — keep / remap / drop

### Keep as-is (0)
None of the 32 evidence_spans quote the registry statement. Do not promote this file into L2b inventory.

### Remap (keyword right-ish, kid wrong)

| cu_id | current kid | should be | why |
|---|---|---|---|
| cu_trade_00033 | k_friday_last_hour_v | k_friday_long_then_short | 周五冲高卖出，回买2:30/7:30，不是尾盘最后一小时找 V |
| cu_trade_00274 | k_friday_last_hour_v | k_friday_long_then_short | 「今天周五 空方先开上半场」 |
| cu_trade_00376 | k_friday_last_hour_v | k_friday_long_then_short | 「周五就是你知道要双杀 指数高点就出 低点回吸」 |
| cu_trade_00470 | k_friday_last_hour_v | k_friday_long_then_short | 「周五会多空双杀」 |
| cu_trade_00577 | k_friday_last_hour_v | k_friday_long_then_short | 周五双杀，开盘冲高出，收盘吸 |
| cu_trade_00811 | k_friday_last_hour_v | k_friday_long_then_short | 「明天周五还是多空轮次」 |
| cu_trade_00891 | k_friday_last_hour_v | k_friday_last_hour_v (弱) | 唯一提到「尾盘最后一小时…强平」；同句又说今天可能不买 |

### Drop — false positive (token only)

cu_trade_00046, 00060, 00080, 00082, 00115, 00147, 00249, 00260, 00316, 00425, 00430, 00444, 00478, 00483, 00492, 00835, 00857, 00859, 00870, 00918, 00921, 00974

Typical fail: 「上周五」「比周五多」「回踩周五收盘价」「周五成本」.

### Drop — wrong kid entirely

| cu_id | current | why |
|---|---|---|
| cu_trade_00582 | k_msci_delete_cascade | 只是旁及「msci和周末讲话」，不是剔除生效日踩踏 |
| cu_trade_01098 | k_rubber_ball_after_gap_fill | snippet 是 10:30 急涨机制，不是补缺口皮球 |

**Score: 32 → keep 0, remap 7, drop 25.**

## B. 116 unmatched — missed registry hits

These should have matched if the matcher used phrases, not single tokens.

### k_second_handshake
- cu_trade_00036 「盘中还有次二次握手确认」
- cu_trade_00143 「尾盘强平…19.3出现二次握手」
- cu_trade_00152 「二次回踩确认再加仓」
- cu_trade_00199 「盘中再看有没有二次握手」
- cu_trade_00280 「尾盘是二次确认低点」
- cu_trade_01137 「二次探底」 (弱，近义)

### k_a_share_red_then_cut_us_overnight
- cu_trade_00227 「上证指数的翻红程序对美股夜盘反弹做对应减仓」  ← strongest
- cu_trade_00084 A 股港股持续流出 → 夜盘量化抛售
- cu_trade_01112 韩国低开，夜盘又有机会

### k_half_retrace_watch
- cu_trade_00361 「(23.18+14.81)/2=18.995」跌一半

### k_earnings_fade_batch
- cu_trade_00436 「美光盘后先涨…和博通一样要先出后面会杀多」
- cu_trade_00982 财报不超预期，盘后出数据时最高点
- cu_trade_00397 财报好/坏的杀多再吸

### k_passive_redeem_then_rebuy
- cu_trade_00877 夜盘出一半 → A 股收盘再卖 → 3 点强平再吸，循环 4 天

### k_stagger_adds_use_close / tail-window sizing
- cu_trade_00025 3:30–4:00 买支撑、不跌破当日低点
- cu_trade_00114 / 00120 尾盘才吸
- cu_trade_00655 收盘附近吸 / 夜盘盘前出

### k_half_now_half_daily_low
- cu_trade_00392 「3 点前有回踩昨天最低附近就吸一半」

### k_close_auction_and_overnight
- cu_trade_00028 周四尾盘 QQQ V，夜盘盘前找高点做 T 出

### k_raise_cash_before_friday_double
- cu_trade_01121 成本附近减出现金周一备用

### Do not invent kids from these (leave unmatched / noise)
00010 会议日程, 00042 Truth Social paste, 00056/00061 当日口播, 00517 大陆房价, 00689/00928 纯图, 00748 财报日历, 01122 `82.6出82hood` ← this is L2a not L2b.

## C. Phrase table engineering should implement

```
二次握手|二次回踩|二次确认     -> k_second_handshake
最后一小时.{0,12}找?V|尾盘强平.{0,20}V -> k_friday_last_hour_v
周五.{0,20}双杀|周五.{0,20}先多后空 -> k_friday_long_then_short
上证.{0,30}翻红.{0,30}夜盘.{0,20}减 -> k_a_share_red_then_cut_us_overnight
(高.+低).{0,8}/\s*2|一半位置             -> k_half_retrace_watch
财报.{0,20}(先出|杀多|分批出)       -> k_earnings_fade_batch
被动减                       -> k_passive_redeem_then_rebuy
```

Ban as sole trigger: `周五` `msci` `补缺口` `最后一小时`.

## D. What not to write next

- Do not copy the 32-row file into gold / atom store.
- `candidates_kids.json` stays a leftover bin until 10 rows are rewritten as `{proposed_kid,type,statement,evidence_span}`.
- L2a inventory unchanged except the already-accepted 00955/01174 fills.
