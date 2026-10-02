---
name: zhao-spot-option
description: "Pick a read-only ATM option to lever a Zhao spot fill on slow names such as GLD or GOOGL. Use when the user gives Zhao's price and wants an expiry, strike, and limit. Not for order entry or ingest ops."
type: tool
lifecycle: active
---

慢票（GLD、GOOGL）上，用一张接近平值的期权跟现货仓，换资金利用率。GEX 只过滤墙，不决定多空。

## 红线

- 只打印建议。禁止下单、改 `AUTO_SUBMIT`、写 `trade_signals`。
- 方向来自用户或赵哥现货 side，不来自负 gamma。负 gamma ≠ 看空。
- `px_zhao` 是他的成交标签，不是我们的成交。现货偏离超过 0.5% 要写出来。
- GLD 不在 `tools/gex-sidecar/collect_futu.py` 的 OWNER 里。单独拉链，不要写进默认矩阵。

## 步骤

1. 收下标的、赵哥价、方向。缺方向时多单按 Call、空单按 Put，并标明是假设。
2. 本机有富途 OpenD（`127.0.0.1:11111`）就拉链：现货、未来到期、每个候选到期日的平值附近 bid/ask/delta/OI/gamma。链调用间隔 ≥ 3.5 秒。没有 OpenD 就用用户刚给的买卖价，不许编。
3. 跑 `python scripts/pick_option.py --ticker GLD --zhao-px 379.25 --spot 379.13 --demo` 核对规则；实盘把链写成 JSON 再 `--chain`。
4. 按下面输出。挂单价用脚本的 `limit_price`：价差 ≤ 0.30 挂 mid，更宽挂买一上方 35%，镍舍入，绝不追卖一。

## 选择

先硬筛，再打分。一张都不合格就输出「无合格合约」，不许把扣分后的坏合约当首选。

| 硬门槛 | 不过 |
|---|---|
| DTE 10–45 | 0DTE、当周余下不足 10 天、LEAP |
| \|delta\| 0.40–0.60 | 深虚值 |
| OI ≥ 100 且价差 ≤ 4% | 无买卖价、字符串字段未清洗 |
| 有 king_strike | 缺墙时只警告，不当作结构优势 |

窗口 King = 到期日不晚于候选合约的各到期 King 里，king_gex 最负的一档。坐在这档上只扣 6 分，不再加「King 在下方所以利多」的分。替换档仍要 OI ≥ 1000、价差 ≤ 3%。

挂单价：价差 ≤ 0.30 用 mid，否则买一上方 35%；向下取整到档位；3 美元以下 penny，否则 nickel；结果必须低于卖一。现货偏离赵哥价超过 0.5% 打 WARNING。`--today` 默认美东当天。`--chain` 必须带 `--spot`。

## 输出

```
首选：TICKER YYYY-MM-DD STRIKE CALL|PUT（US.TICKERYYMMDD C/P STRIKE）
只读筛选，不是下单。GEX 不作为方向。
赵哥 px / 现货 / 偏离 / 方向
挂限价（买/卖，不追卖一）
Delta · DTE · OI · 量
该到期 King / Floor · 硬伤
失效价
买不进换：…
do_not_use_as_order=true
```

失效：多单失守当日低点，或现货下方的 King；空单相反。
