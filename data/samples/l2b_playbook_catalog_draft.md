# L2b 战法知识库目录草稿 (l2b_playbook_catalog_draft.md)

> **严正声明**：
> 1. 本目录汇编自 **20a (首批) + 20b (第二批)** 严格核验后符合 **gold_text / proposed** 标准的战法条目，按**战法家族（形态 / 公式 / 资金窗 / 日内 / 仓位 / 节奏 / 总纲）**骨架归拢，绝不当成 25 套孤立策略；
> 2. **G4 / G5 / 公式金标**明确标记 `grade: gold_text`，其余建议条目维持 `grade: proposed`，全量 `status` 统一受控为 `proposed`；
> 3. 绝不写入 `known_kids_registry.json`，绝不解冻切窗流水线（保持 `paused: 2064`），绝不跑模型抽取。

---

## 📊 一、战法家族骨架概览（7 大核心家族）

```text
🏛️ 战法知识库家族骨架体系
├── 1. 形态族 (Pattern): 二次握手 (k_second_handshake)、九转序列 (k_nine_turn_sequence)、看转弯 (k_focus_on_inflection_turn)
├── 2. 公式族 (Formula): 一半回撤测算 (k_half_retrace_watch) —— 统一 kid，覆盖 CRWV/OKLO/太空/NBIS/HOOD/TSLL/AMZN 多票实例
├── 3. 资金窗族 (Liquidity Window): 被动减持与应对 (k_passive_redeem_then_rebuy 等) —— 涵盖被动减、分三份缺口买、减持高低切、去杠杆拉开价差
├── 4. 日内族 (Intraday): 水下与波段 (k_rubber_ball_dip_buy 等) —— 涵盖皮球理论、急跌买一份·6%出半、异动止盈急跌吸、缺口只做一次
├── 5. 仓位族 (Position): 风控纪律 (k_max_position_seventy_pct 等) —— 涵盖总仓≤7成留3成做T、分批只减最后补的一笔成本出
├── 6. 节奏族 (Pacing): 轮次与联动 (k_morning_long_afternoon_dip 等) —— 涵盖早多尾空、强势股看 QQQ 转弯、普跌吸普涨抛
└── 7. 总纲 (Philosophy): 主观交易总诀打油诗 —— 先行收录挂载，不当硬性执行规则
```

---

## 📋 二、战法家族结构化目录明细表 (Catalog Draft)

| 家族分类 | 序号 | 建议/正式 kid | 权威定级 (`grade`) | 真实 post_id | 来源 CU 编号 | 原文连续子串 (`statement` / 证据) | 配图核验 | 状态 |
|:---|:---:|:---|:---:|:---|:---|:---|:---:|:---:|
| **形态族** | **01** | `k_second_handshake` | **🥇 gold_text** | `post_1CUmhoAGUop4SppGjvML7p` | `cu_l2b_drycut_20260830_00001` (G4) | **在二次握手吸 盘后才预期 多的时候出** | `no_image` | `proposed` |
| **形态族** | **02** | `k_second_handshake` | **🥈 proposed** | `post_1CayBBJeexEDaiEveHEmGa` | `cu_l2b_drycut_20260830_00005` (g_img_003) | 看二次握手用 SPX 图更精确。 | 🖼️ SPX真图 (3张) | `proposed` |
| **形态族** | **03** | `k_nine_turn_sequence` | **🥈 proposed** | `post_1CXYCpXPkLs5VVnU5aBkJe` | `cu_l2b_drycut_20260830_00003` (g_img_001) | 九转序列是默认的数学公式计算曲率，反弹看红1-9，回调看绿1-9。 | 🖼️ 九转真图 (2张) | `proposed` |
| **形态族** | **04** | `k_focus_on_inflection_turn` | **🥈 proposed** | `post_1CYDwHo9hVfbwciyfsR9sa` | `cu_l2b_drycut_20260830_00004` (g_img_002) | 每天只需要看转弯，真金白银是真，消息都是阻碍你。 | 🖼️ 转弯真图 (2张) | `proposed` |
| **公式族** | **05** | `k_half_retrace_watch` | **🥇 gold_text** | `post_1CWLuUbwbhS7EvhKs97CBG` | `cu_l2b_drycut_20260830_00008` (公式01) | 第一轮计算公式（137.75+65.11）/2=101.43，是一半位置出一半。 (CRWV) | `no_image` | `proposed` |
| **公式族** | **06** | `k_half_retrace_watch` | **🥇 gold_text** | `post_1CWLw66PRrtK3gy33HJ4nP` | `cu_l2b_drycut_20260830_00009` (公式02) | （135+79）/2=107，到了一半位置出一半。 (OKLO) | `no_image` | `proposed` |
| **公式族** | **07** | `k_half_retrace_watch` | **🥇 gold_text** | `post_1CVkJTMPBDiPHpvx618Da4` | `cu_l2b_drycut_20260830_00018` (公式03) | 太空板块往反弹一半的方向走：rklb（66.35+37.57）/2=51.96，asts (49.31+83.31)/2=66.31。 | `no_image` | `proposed` |
| **公式族** | **08** | `k_half_retrace_watch` | **🥈 proposed** | `post_1CWLwrA3b6TrT7GJopo379` | `cu_l2b_drycut_20260831_00001` (20b-01) | （134+78.21）/2=106.1，这轮（103.84+75.25）/2=89.54，一半这个保守位置。 (NBIS) | `no_image` | `proposed` |
| **公式族** | **09** | `k_half_retrace_watch` | **🥈 proposed** | `post_1CYiBfdotsxGAhV6Kk1zvK` | `cu_l2b_drycut_20260831_00003` (20b-03) | hood一半位置在（109+70）/2=89，89附近。 (HOOD) | `no_image` | `proposed` |
| **公式族** | **10** | `k_half_retrace_watch` | **🥈 proposed** | `post_1CYiBio1Ki9rFfzqMidBh9` | `cu_l2b_drycut_20260831_00004` (20b-04) | （13.55+23.6）/2=18.55，-1元派息，17.55一半位置再出一半。 (TSLL) | `no_image` | `proposed` |
| **公式族** | **11** | `k_half_retrace_watch` | **🥈 proposed** | `post_1CYiFXPvHbtarByzwWzVFF` | `cu_l2b_drycut_20260831_00005` (20b-05) | 亚马逊（244+196）除2等于220，到一半位置附近时候再减一半。 (AMZN) | `no_image` | `proposed` |
| **资金窗族** | **12** | `k_passive_redeem_then_rebuy` | **🥇 gold_text** | `post_1CaWLMfYvJsZHjS9ugtaPj` | `cu_l2b_drycut_20260830_00002` (G5) | 大盘股财报窗口预期被动减持，回踩不同板块个股低点分开观察。 | `no_image` | `proposed` |
| **资金窗族** | **13** | `k_three_parts_gap_scaling` | **🥈 proposed** | `post_1CbAPabncHPXk44npRESnx` | `cu_l2b_drycut_20260830_00020` (20a-20) | 被动减每天股仓位一般分三份，每跌一个缺口买一份。 | `no_image` | `proposed` |
| **资金窗族** | **14** | `k_unlock_flow_high_low_cut` | **🥈 proposed** | `post_1CeEB4X4yrtEZKnUbGXKTt` | `cu_l2b_drycut_20260831_00010` (20b-10) | 减持回流量相对大的两天会急跌急涨锯齿多，有些急涨的就一半出，再调入急跌的高低切。 | 🖼️ 减持真图 (1张) | `proposed` |
| **资金窗族** | **15** | `k_margin_unwind_spread_dip` | **🥈 proposed** | `post_1Cdft7zNeDDcKbwk4jStAG` | `cu_l2b_drycut_20260831_00020` (20b-20) | 杠杆去化与减持回流期间，每天拉开价差分批次低吸。 | `no_image` | `proposed` |
| **日内族** | **16** | `k_rubber_ball_dip_buy` | **🥈 proposed** | `post_1Cbwt9woNwEzibuyrHM7bb` | `cu_l2b_drycut_20260830_00014` (20a-14) | 皮球理论就是水下急跌埋伏，异动出。 | `no_image` | `proposed` |
| **日内族** | **17** | `k_dip_buy_one_gain_sell_half` | **🥈 proposed** | `post_1Cdhz9mecyHJEKvKPaqa4o` | `cu_l2b_drycut_20260831_00018` (20b-18) | 急跌了根据自己仓位买一份，异动多出一半（如6%出一半再涨6%出一半），横盘不操作。 | `no_image` | `proposed` |
| **日内族** | **18** | `k_gain_take_and_dip_collect` | **🥈 proposed** | `post_1CePoYLbFYk8eQPPTAW6QZ` | `cu_l2b_drycut_20260831_00008` (20b-08) | 每天要维持有异动涨幅可以止盈，急跌了都收集低位筹码吸。 | `no_image` | `proposed` |
| **日内族** | **19** | `k_gap_single_intraday_discipline` | **🥈 proposed** | `post_1CbASmAPtdCknnaHcfBcAo` | `cu_l2b_drycut_20260830_00016` (20a-16) | 每次到缺口只做一次日内，跌破等待下方缺口。 | `no_image` | `proposed` |
| **仓位族** | **20** | `k_max_position_seventy_pct` | **🥈 proposed** | `post_1CW3UCsAesy8CkMKzSDzA7` | `cu_l2b_drycut_20260830_00017` (20a-17) | 盘后总仓位不超过7成，保留3成做T资金。 | `no_image` | `proposed` |
| **仓位族** | **21** | `k_cost_exit_last_batch` | **🥈 proposed** | `post_1CUovuqHikTdzgQiiS7ENA` | `cu_l2b_drycut_20260830_00013` (20a-13) | 分批只减自己最后补的那笔，反弹至成本先成本出。 | `no_image` | `proposed` |
| **节奏族** | **22** | `k_morning_long_afternoon_dip` | **🥈 proposed** | `post_1CdoV7EK8jmBHuuWUZjRgy` | `cu_l2b_drycut_20260831_00016` (20b-16) | 开盘是多的轮次，等尾盘空的轮次低吸的时候再吸点最低点出来的和急跌的。 | `no_image` | `proposed` |
| **节奏族** | **23** | `k_strong_stock_qqq_turn_dip` | **🥈 proposed** | `post_1CeDwfoHoe5Zs5fsKV9ddL` | `cu_l2b_drycut_20260831_00011` (20b-11) | 回流都有t+2的时差效应，强势股主要看qqq的转弯去低吸。 | 🖼️ 转弯真图 (1张) | `proposed` |
| **节奏族** | **24** | `k_general_drop_buy_peak_sell` | **🥈 proposed** | `post_1CeCAEHUWqBakCEAPXJk8N` | `cu_l2b_drycut_20260831_00012` (20b-12) | 都普跌时候他也急跌买了占仓位，指数都普涨看顶点了抛。 | `no_image` | `proposed` |
| **总纲** | **25** | `k_playbook_master_poem` | **🥈 proposed** | `post_1CWoRBJvkuBQgdN2Cq7Mci` | `cu_l2b_drycut_20260830_00010` (20a-10) | 主观交易总诀：普跌同沉不用慌，普涨我跌要提防，事件来临莫急闯，靴子落地迎反弹。 | `no_image` | `proposed` |

---

## 🔒 三、冻结红线核验

- [x] **不写入 `config/channel_registry.json` 或 `known_kids_registry.json`**；
- [x] **`pipeline_tasks.l2b_cut` 严格维持 `paused: 2064`**；
- [x] **绝不上 14B 跑抽取，不再扩充第三批 20 窗战法表**；
- [x] **工程主线全面聚焦于 TSLA/TSLL 时间轴资产**。
