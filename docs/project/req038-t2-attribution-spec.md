# REQ-038-T2 — TSLA/TSLL 子集归因口径（冻结）

> 上级：[`03-requirements.md`](./03-requirements.md) REQ-038 · 抽审 07 置顶门禁 #8  
> **本文件先于代码**。改口径必须改本页，禁止脚本里悄悄换窗口。

Sprint 1 **只做子集实验**。不写 `trade_signals`、不进 L2a、不生成 BUY/SELL、不跑 1995 张全量。

---

## 1. 入选

| 条件 | 规则 |
|------|------|
| 标的 | **标题 / 触发 / 源消息正文** 出现独立词 **TSLA 或 TSLL**（大小写不敏感）。**不**凭 `tickers_json` 入选（防 NVDL 卡误打 TSLL） |
| 发送者硬锁（CHG-033） | 源消息 `messages.sender_id` **必须** = `user_4yeplXgbguTu4`（赵哥）；否则 `skipped_non_zhao`。禁模糊名匹配；周哥参考卡不得进 T2 胜率样本 |
| 点位 vs 入场 | 抽出点位 / `entry` Adj Close ∈ **[0.4, 2.5]**，否则 `skipped_level_mismatch`（防 128 打在 ~19 的 TSLL 上） |
| 卡类 | `pattern` / `asset_memory` / `risk_rule` / **`level`**（多模态 VL 点位卡，CHG-030 增量消费；排除纯 `macro` / 无点位的 `market_structure`） |
| 明确点位 | **正文** = 卡片字段 ∪ 首条源消息 `messages.content` ∪ `schema_json` 文本；若仍抽不出，用同源 `message_vision_meta.support_resistance_json`（VL `ticker` 空或与计价标的相同；拒 100.5/120 测试 fixture）。能抽出 **一个**价位。Yahoo **只打**过了点位门 **且** 方向非 mixed 的子集 |
| CLI 计数 | `with_level` = 抽出点位（含 `unscored_mixed`）；`yahoo_eligible` = 可打分（非 mixed / 非缺方向） |
| VL gaps（CHG-031） | `card_attribution_cli.js --gaps` → `data/runtime/req038-t2-vl-gaps.json`：列出 TSLA/TSLL `status=ok` 但无可用 SR 的行，供 T1 优先回填 |
| 价位范围 | TSLA ∈ [50, 900]；TSLL ∈ [1, 200]（滤掉「30分钟」「14B」「概率 36.7%」等） |
| 点位优先 | 优先标的词邻域内的 `支撑位`/`压力位`/`关键区间`/`短线`；线索词命中若紧邻 `%`/`概率` 丢弃；价位旁出现 UPST/CONL 等异标的且无本标的则丢弃 |
| 方向 | 先读结论行（`先说主结论`/`先说结论`/`结论`/`方向判断`）：区间震荡→无方向；偏弱回落→bearish；偏多→bullish。无结论再关键词计数；强弱 ≥2× 取一侧，否则 `unscored_mixed` |
| 时间 | 源消息 `messages.created_at` 可解析；否则 `skipped_no_t0` |

**计价标的**：文中优先 TSLL，否则 TSLA（杠杆卡不对齐正股）。

**方向启发式**

- 结论行优先（CHG-028）：`区间震荡`/`观望` → 无方向；`偏弱`/`回落` → bearish；`偏多`/`上涨为主` → bullish  
- bullish 词：突破 / 回踩 / 支撑 / 低吸 / 加仓 / 做多 / 反弹 / 企稳 / 不破  
- bearish 词：止损 / 跌破 / 降仓 / 减仓 / 砍仓 / 阻力 / 做空 / 弱势  
- 双边命中时：一侧计数 ≥ 另一侧 2× 则取强侧，否则 `unscored_mixed`  

`risk_rule` 且含止损/降仓 → 强制 bearish。  
`level` 卡：标题/形态含 `V型反弹`/`底部V` → bullish；`单边下跌` 且无反弹 → bearish。

---

## 2. 行情与时钟

- 交易日日历：**美东** `America/New_York`。`t0` = 源消息美东日历日。  
- **入场价 `entry`**：`t0` 之后 **下一根日线** 的 **Adj Close**（消息当日收盘后才交易；盘中发言不偷当日已走完的涨跌）。  
- 窗口：入场后再数 **3 / 5 个交易日**（不是自然日）。  
- 价格：**前复权 Adj Close**；高低用同期 raw high/low 相对 adj 因子缩放：`adjHigh = high * (adjClose/close)`。缺 adj 则退回 close（`px_basis=raw`）。  
- 来源：Yahoo chart `interval=1d`（与现网 `kline.js` 同源）；单测注入 fixture，禁止测试打网。

---

## 3. 指标（每张入选卡）

相对 `entry`：

| 字段 | 定义 |
|------|------|
| `close_ret_{3,5}d` | 窗口末日 Adj Close / entry − 1 |
| `max_gain_{3,5}d` | 窗口内 adjHigh 最高 / entry − 1 |
| `max_dd_{3,5}d` | 窗口内 adjLow 最低 / entry − 1（通常 ≤ 0） |

**命中 `hit_5d`（主指标；`hit_3d` 同期披露）**

- bullish：`close_ret_5d > 0`  
- bearish：`close_ret_5d < 0`  
- 等于 0 → 未命中  

**Confidence**（仅历史跟穿，**不是**下单建议）

- 命中：`0.55 + min(0.30, |close_ret_5d| / 0.20)` 再 clip 到 `[0, 1]`  
- 未命中：`0.45 - min(0.30, |close_ret_5d| / 0.20)` 再 clip 到 `[0, 1]`  

---

## 4. 事件日剔除

入场日相对 **前一交易日** Adj Close 涨跌绝对值 **> 15%** → `excluded_event`（拆分/财报跳空代理）。不进胜率分母。

K 线不足 1+5 根 → `skipped_no_bars`。

---

## 5. 汇总（报告）

仅 `status=scored`：

- `n`、`hit_rate_5d`、`hit_rate_3d`  
- 分方向、分标的（TSLA vs TSLL）计数  

**禁止**把 `confidence` 写进跟单/signal；可写入隔离表 `ontology_card_attribution` 或 JSON 报告。

---

## 6. 非目标（Sprint 1）

- 全量 1995 卡、分钟线、DPO、共振推送、VL 字段依赖。
