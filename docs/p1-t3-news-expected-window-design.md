# T3 — 交易日 News 期望窗口设计与落地规范

> 对应任务：`docs/gemini-followup-task-split.md` 之 T3 任务。  
> 准则约束：**可观测 ≠ 业务闭环**；**禁止使用整天 `isOffMarketHours` 豁免**（避免误免工作日盘后）；**交易日缺 News 报 warn，周末报 ok（免检文案）**。

---

## 1. 背景与现状诊断

### 1.1 现状与痛点
1. **休市免检初版（Commit `2075832`）**：
   引入了 `isWeekendOrHoliday`，当美股处于周末或法定节假日时，将 News 的 `warn` 降级为 `ok`，避免了周末无交易导致 `/health` 报警。
2. **待解决的潜在风险**：
   - **不能用全天 `isOffMarketHours` 豁免**：美股常规盘为美东 09:30~16:00（北京时间 21:30~次日 04:00）。如果使用 `isOffMarketHours` 判定休市，则北京时间白天（04:00~21:30）整整 17.5 小时都会被判定为“休市豁免”。
   - **工作日盘后与盘前失察**：核心报告如“收盘回顾 (closing)”正是在北京时间 08:30 生成，“盘前速报 (briefing)”在 17:30 生成。若白天全盘豁免，一旦调度器或队列崩溃导致报告未生成，探针将完全失察。
   - **数据源偏离（重大发现）**：此前 `asset-freshness-probe.js` 仅查询 `reports` 表中的 `strategy = 'MARKET_NEWS_ANALYSIS'`，而系统内真正的 Auto News Scheduler（`news-engine.js` / `server.js`）是将报告写入 `news_summaries` 表。探针必须统一兼容 `news_summaries`，才能真实反映业务资产状态。

---

## 2. Auto News 调度时序与期望窗口模型

### 2.1 美东交易日与北京时间时序映射表（夏令时 EDT）

美股常规交易时段为美东时间周一至周五 09:30 ~ 16:00。换算为北京时间（HKT/CST，EDT 相差 12 小时）：

| 报告类型 | 覆盖时段（美东 ET） | 覆盖时段（北京时间 HKT） | 调度触发时间 (HKT) | SLA 交付死线 (HKT) | 适用交易日 |
|---|---|---|---|---|---|
| **盘前速报 (`briefing`)** | 前一日 20:00 ~ 当日 09:30 | 当日 08:00 ~ 21:30（夜盘/早盘） | **17:30** | **18:00** | 周一至周五 |
| **盘中总结 (`intraday`)** | 当日 09:30 ~ 13:30 | 当日 21:30 ~ 次日 01:30 | **次日 01:30** | **次日 02:00** | 周二至周六 |
| **收盘回顾 (`closing`)** | 当日 16:00 ~ 21:00 | 次日 04:00 ~ 09:00（含盘后） | **次日 08:30** | **次日 09:00** | 周二至周六 |

### 2.2 交易日三大检测阶段与容忍度划分

在**非周末且非法定节假日**的交易日，探针按照以下三个动态窗口判定最新新闻是否滞后：

```
[00:00 ── 02:00]  夜盘交易中，容忍上一交易日的资讯（SLA 窗口平稳过渡）
[02:00 ── 09:00]  阶段 A：当日盘中总结 (01:30) 应已生成；死线 02:00
[09:00 ── 18:00]  阶段 B：当日收盘回顾 (08:30) 应已生成；死线 09:00
[18:00 ── 24:00]  阶段 C：当日盘前速报 (17:30) 应已生成；死线 18:00
```

#### 特殊时段处理：
1. **周一白天（周一 00:00 ~ 18:00 HKT）**：
   - 周末刚过，美股周一常规盘尚未开启，早晨无收盘回顾。
   - 当天第一份报告是 17:30 的盘前速报。
   - **规则**：在周一 18:00 前，允许最新的新闻为上周五/周六生成的记录（容忍滞后达 72 小时）；在周一 18:00 之后，必须已有当天生成的盘前速报，否则告警。
2. **周六早晨（周六 00:00 ~ 09:30 HKT）**：
   - 对应美股周五美东常规盘的收盘与盘后结算。
   - 01:30 产出盘中总结，08:30 产出收盘回顾。
   - **规则**：在周六 09:30 之前，仍处于周五交易产出的 SLA 监控期内。周六 09:30 之后美股全面休市，正式进入周末免检期。

---

## 3. 探针算法设计与期望窗口落地

```javascript
/**
 * 判定交易日 News 期望窗口与新鲜度
 */
export function evaluateNewsFreshness({ latestNewsTs, now = new Date(), isMarketClosed = null }) {
  const { weekday, hour, minute } = getEasternTimeParts(now); // 1=Mon ... 7=Sun
  const nowMs = now.getTime();
  
  // 1. 周末与休市豁免判定
  const marketClosed = typeof isMarketClosed === 'boolean'
    ? isMarketClosed
    : isWeekendOrHoliday(now);

  // 周六 09:30 之后 或 周日全天，或美股法定节假日全天 -> 免检
  const isSaturdaySettled = (weekday === 'Sat' && (hour > 9 || (hour === 9 && minute >= 30)));
  const isSunday = (weekday === 'Sun');

  if (marketClosed && (isSunday || isSaturdaySettled || US_MARKET_HOLIDAYS_2026.has(...))) {
    return {
      status: 'ok',
      marketClosed: true,
      description: latestNewsTs ? `已滞后 ${lagHours} 小时（休市空窗免检）` : '休市空窗免检（未生成）'
    };
  }

  // 2. 交易日未生成任何记录
  if (!latestNewsTs) {
    return {
      status: 'warn',
      marketClosed: false,
      description: '未生成（交易日缺失资讯报告）'
    };
  }

  // 3. 交易日动态 SLA 判定
  // 避免全天 isOffMarketHours 误免：工作日白天 09:00~18:00 仍需检查 08:30 收盘回顾
  ...
}
```

---

## 4. 数据源双表合并兼容

探针在探测最新新闻时，采用双表聚合：
```sql
SELECT MAX(created_at) as latest_ts FROM (
  SELECT MAX(created_at) as created_at FROM news_summaries
  UNION ALL
  SELECT MAX(created_at) as created_at FROM reports WHERE strategy = 'MARKET_NEWS_ANALYSIS'
)
```
- 若 `news_summaries` 有最新生成记录，直接采纳；
- 若存在历史 `reports` 记录，兼容并蓄；
- 避免因查错表而产生假阳性未生成告警。
