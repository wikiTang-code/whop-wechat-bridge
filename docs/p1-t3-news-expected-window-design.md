# T3 — 交易日 News 期望窗口设计与落地规范

> 对应任务：`docs/gemini-followup-task-split.md` 之 T3。  
> **实现状态（2026-09-05）**：已落地 `monitoring/news-freshness.js` + 探针接线 + `test/test_news_freshness.js`（不再仅是设计稿）。

---

## 1. 背景与现状诊断

### 1.1 痛点
1. 休市免检初版避免周末误黄，但需避免全天 `isOffMarketHours` 误免工作日盘后。
2. 探针曾只查 `reports.MARKET_NEWS_ANALYSIS`，真实 Auto News 写入 **`news_summaries`** → 已双表兼容。
3. 周六上午仍应对齐周五收盘回顾 SLA；周六北京 09:30 后进入周末免检。

---

## 2. Auto News 调度时序（北京时间）

| 类型 | 触发 (HKT) | SLA 死线 | 适用 |
|---|---|---|---|
| briefing | 17:30 | 18:00 | 周一至周五 |
| intraday | 01:30 | 02:00 | 周二至周六 |
| closing | 08:30 | 09:00 | 周二至周六 |

动态滞后天数上限（实现）：`00–02→14h` / `02–09→10h` / `09–18→11h` / `18–24→9h`；周一 18:00 前额外容忍 72h。

---

## 3. 实现入口

- `evaluateNewsFreshness` / `isNewsMarketClosed` → `monitoring/news-freshness.js`
- `getBeijingTimeParts` → `monitoring/market-calendar.js`
- `checkAssetFreshness` 调用上述纯函数；数据源：`news_summaries` 优先，否则 `reports`

---

## 4. 数据源

优先 `news_summaries` 最新 `created_at`；若无则回退 `reports` 中 `strategy = 'MARKET_NEWS_ANALYSIS'`。
