# 三角色运行合同（跟单执行 · 参考播报 · 负对照）

> **CHG-051** · 2026-09-20 · 状态 `accepted`（定位合同；工程未完）  
> 账本：[`03-requirements.md`](./03-requirements.md) · 方法学反例：[`057-turning-point-microstructure-report.md`](./057-turning-point-microstructure-report.md) §6  
> 本页不是总进度，只冻结「现在有什么、没有什么、先做什么」。

---

## 1. 现在没有什么

没有可上柜的自主 alpha。CHG-050 测的是 5m 下轨 + 阳线 HL + 量能 + DIF 拐头，次根开、10bps、固定 2h。OOS 最大 n=16，三只 ExitA 为负，置换无一只 p<0.05。它不能当发令枪。

赵哥单是**成交后广播**，不是预告。`px_zhao` 是他的成交锚点（监督标签），**不是**我们的成交价。

两条链不能互相证明：跟单执行通了 ≠ 检测器有期望；检测器能出信号 ≠ 能成交在口播价。

---

## 2. 三个角色（禁止混名）

| 角色 | 何时动 | 输入 | 输出 | 进 exec？ |
|------|--------|------|------|:---------:|
| **跟单轨** | 赵哥开口才动 | 专属频道 + `sender_id` 硬锁 | Intent：`t_arrive, px_zhao, px_arrive, delta, exec_policy∈{A,B,C}` | HITL 后可以（Paper） |
| **周哥 QQQ 模拟仓** | 他工具箱持续播 | 「日内波段信号检测」等频道原文 | 短/中线模拟仓、买入卖出价、累计盈亏；L2b `hint_only` | **否**（可验证，不跟单、不进 L2a） |
| **自研参考轨** | 赵哥不开口也播 | 只许 OHLCV / 波动 / 量能 | `status=REFERENCE_ONLY` 卡片 | **否** |
| **GEX** | sidecar | `latest.json` | 结构加减分、WARN | **否**（不硬拦） |

周哥 QQQ 播报是**带模拟仓的参考频道**，不是口头多空。本机已有隔离回放：[`data/runs/mrzhou_strategy/QQQ_HINT_REPLAY.md`](../../data/runs/mrzhou_strategy/QQQ_HINT_REPLAY.md)（2026-04-21～06-26，88 笔已平，75/13，名义胜率 85.2%，同期 QQQ 买持 +9.7%——牛市窗，不能当全天候 alpha）。群里自报胜率/盈利率**可以、也应该对照这条频道账**，但 `trade_signals` 必须保持 0 条周哥单（硬隔离）。

自研参考轨学的是这个形态（持续播 + 模拟仓 + 可回测），不是学赵哥成交后广播。两本账仍分开：风格账（像不像赵哥）vs 频道账（播报自己有没有用）。

CHG-050 冻结参数是**负对照**，不再用同一网格刷正期望。黄金战法卡是 HITL 说明书，不是开仓公式。大V文本禁止写入检测器特征（红线 6）。

---

## 3. 停做什么

- 再调 38.2%、k、量能倍数把 PF 做正  
- 79% 宽窗或 OOS 单票正期望进 HUD / 雷达加权  
- 用回测代替 Paper `FILLED`  
- 口播价回测成交（红线 4）  
- 并行新战法叙事；滚动多折救 CHG-050（`REJ-011`）

---

## 4. 次序（写死）

```
FILLED + 持仓真源 + 对账
  → Intent 字段 + A/B/C（限价回抽 / 限滑追 / 弃单）
  → 跟单 delta 账本
  → 才决定参考轨是否升级；升级后仍是 PENDING_HITL / REFERENCE_ONLY
```

`FILLED` ≠ 柜台策略成立 ≠ alpha。

A：限价接回抽，短 TTL。B：滑点上限内追。C：`MISSED_DUE_TO_LATENCY`。

检验门槛（自主轨若以后还测）：OOS 多标的 ExitA 扣费后 CI 不跨零；置换 p 经多重检验仍显著；Paper 分源对账无造假。达不到就保持 HITL。目标改为「能否降低 C / 改善 A」，不是再报买端 PF。

---

## 5. 参考轨 v0（P3，零件已有，不新开叙事）

现成：`turning_detector.js`、梯子研究、CHG-050 检测器（标题必须带 holdout 负结果）、只读工作台。

卡片形如：`time, ticker, side, horizon, px_ref, setup_id, evidence[], score, source=autonomous, status=REFERENCE_ONLY`。

票池：近 60 天赵哥高频 IREN/SOXL/MU/CRWV/COHR + QQQ 对照。同一 Paper 账户若以后试纸面，必须 `source` 分账。默认不进 L2a 候选、禁止 `AUTO_SUBMIT`。
