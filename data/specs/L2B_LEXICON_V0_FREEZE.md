# L2b 词表 / 槽 / topic 冻结版 v0（2026-08-30）

文档层规则打标用。不是 kid 注册表。`known_kids_registry.json` 不因本表写入。

## 1. 输出槽（每条 span）

| 字段 | 闭集 / 形状 | 说明 |
|---|---|---|
| `acts` | `lesson\|qa\|fill\|watch\|news\|chat` 可多值 | 每窗并集后至少 1 个；禁止 `qa_lesson` 这种新枚举 |
| `topic` | 下表强词触发，否则 `null` | 一条可 1 个主 topic，其余进 `cues` |
| `timing` | 数组，可空 | 时段，不是战法 |
| `cues` | 弱词命中列表 | 只备查，不定 topic、不升手册 |
| `l2_lane` | `l2a\|l2b\|both\|neither` | fill→l2a；can_ascend→l2b |
| `l2_family` | 仅旧锚或 `null` | 见 §5 |
| `can_ascend` | bool | 见 §4 |

切 span：换行 / `。` / `？` / `！`；切不出则整条消息一个 span。

## 2. timing（强，只进 timing[]）

夜盘、盘前、盘中、盘尾、尾盘、盘后、收盘

## 3. topic 强词

命中下列整词/短语才写 `topic`。同一句多强词：按专指优先  
`block_print` > `index_turn` > `settlement` > `options` > `supply_unlock` > `position_limit` > 其余。

| topic | 强词（整词） |
|---|---|
| `block_print` | 大单、盘口大单、异动的大单、大单入场、大单检测、资金介入 |
| `manual_bid` | 人工介入、人工介入回吸 |
| `index_turn` | 拐弯、转弯、心电图；QQQ/SPY/大盘 + 转弯/拐弯 |
| `scan` | 预警、扫描；「检测」仅当未命中大单 |
| `quant_tape` | 量化、上下扫 |
| `settlement` | 结算 |
| `options` | iv、IV、期权、杀call、杀 Call、双杀 |
| `supply_unlock` | 减持、解禁、减持公告 |
| `flow` | 资金、抛售、量化抛售、扫货 |
| `institution` | 机构、做空机构 |
| `valuation` | 估值、目标价 |
| `pnl_state` | 利润垫；（盈利/亏损见弱词，不单独定 topic） |
| `t_trade` | 做T、做t、正T |
| `event` | 会议、事件、销量、预期、冲突、政府、利率 |
| `structure` | 底部、轮次、多空、回流 |
| `levels` | 支撑、阻力 |
| `mean_revert` | 抄底 |
| `tape_stat` | 成交额 |
| `position_limit` | 总仓位不要超过7成、7成死拿、7成持仓、6-7成、3成做T、3成机动 |
| `gap` | 缺口、只做一次日内、缺口连续补 |
| `handshake` | 二次握手、不破第一轮低点、日内低点不破 |
| `half_retrace` | 反弹一半、回撤一半、`(a+b)/2` 公式 |
| `shoe` | 靴子落地 |

## 4. can_ascend

默认 false。为 true 仅当：

- `acts` 含 `lesson`，或 `qa` 且含机制词：因为 / 就是 / 记住 / 相当于 / 机制 / 一般；且
- 不是「有价 + 出/加/买/卖」的纯 fill；且
- 不要仅因弱词命中。

`fill` / `news` / `chat` 永不升。  
`watch` 默认不升。  
`介入一半` `XX介入` `可以介入` 不当 `block_print`，走 fill/planned。

## 5. l2_family（v0 仅此白名单）

`k_second_handshake` `k_gap_intraday_once` `k_position_control_70_pct`  
`k_half_retrace_watch` `k_shoe_drops_settlement_rebound`  
`k_passive_redeem` `k_dip_action` `k_cut_in_half_100` `k_cost_exit_last_batch`  
对不上则 `null`。禁止为 大单/转弯/减持/期权 新开 family。

## 6. 弱词（只进 cues[]）

扫、上下、个股、仓位、结果、回调、吸、拉升、直线、追加、入场、  
短线、反弹、低点、波动、振幅、点位、指标、先行、震荡、操作、  
高点、价格、强、弱、止盈、盈利、亏损、  
轮询（库内 0 次，预留不强匹配）

「先行指标」整词可进 cues 强匹配。

## 7. 禁止单独当关键字

`出` `v` `V` `扫`（须「上下扫」「扫货」）  
裸 `介入`（须「资金介入」「人工介入」或当进场口令）

小V / V反 / 量化V / 等QQQ V → cues 或并入 `index_turn`/`quant_tape`，不要匹配单字母 v。

## 8. fill 优先

同时出现 ≥1 个 `x.x` 价 + 出/加/买/卖/出一半/加了，且无「比如/要素/口诀/记住/一般到缺口」→ `acts=["fill"]`，topic 可空，can_ascend=false。  
抄底+价+标的同样 fill 优先。

## 9. 本版成功标准

- 窗 act 覆盖 100%
- family 仍只挂 §5
- 重跑交付：各强 topic 计数 + `index_turn`/`block_print`/`options`/`supply_unlock`/`settlement`/`t_trade` 各 8 条样例
- 不升 registry，不跑 14B
